use std::{path::Path as FsPath, process::Stdio, sync::Arc};

use anyhow::anyhow;
use axum::{
    Router,
    extract::{
        Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::{IntoResponse, Json as ResponseJson},
    routing::get,
};
use db::models::task_attempt::TaskAttempt;
use deployment::Deployment;
use futures_util::{SinkExt, StreamExt};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::{io::AsyncWriteExt, process::Command, sync::Mutex};
use tokio_util::codec::{FramedRead, LinesCodec};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Serialize, TS)]
pub struct ContainerInfo {
    pub attempt_id: Uuid,
    pub task_id: Uuid,
    pub project_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct ContainerQuery {
    #[serde(rename = "ref")]
    pub container_ref: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContainerServiceInfo {
    pub container_id: String,
    pub container_name: String,
    pub service: String,
    pub state: String,
    pub status: String,
    pub image: String,
    pub ports: Vec<String>,
    pub compose_project: String,
    pub browser_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DockerPsRow {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Names")]
    names: String,
    #[serde(rename = "State")]
    state: String,
    #[serde(rename = "Status")]
    status: String,
    #[serde(rename = "Image")]
    image: String,
    #[serde(rename = "Ports")]
    ports: String,
}

pub async fn get_container_info(
    Query(query): Query<ContainerQuery>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<ContainerInfo>>, ApiError> {
    let pool = &deployment.db().pool;

    let (attempt_id, task_id, project_id) =
        TaskAttempt::resolve_container_ref(pool, &query.container_ref)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => ApiError::Database(e),
                _ => ApiError::Database(e),
            })?;

    let container_info = ContainerInfo {
        attempt_id,
        task_id,
        project_id,
    };

    Ok(ResponseJson(ApiResponse::success(container_info)))
}

pub async fn get_container_services(
    Path(attempt_id): Path<Uuid>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<ContainerServiceInfo>>>, ApiError> {
    let pool = &deployment.db().pool;
    let attempt = TaskAttempt::find_by_id(pool, attempt_id)
        .await?
        .ok_or_else(|| ApiError::Conflict("Task attempt not found.".into()))?;
    let container_ref = attempt.container_ref.ok_or_else(|| {
        ApiError::Conflict("This attempt does not have a container reference yet.".into())
    })?;
    let compose_project = resolve_compose_project(&container_ref)?;
    let services = fetch_compose_services(&compose_project).await?;
    Ok(ResponseJson(ApiResponse::success(services)))
}

pub async fn stream_container_logs_ws(
    ws: WebSocketUpgrade,
    Path(container_name): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let container_name = sanitize_identifier(&container_name)?;
    Ok(ws.on_upgrade(move |socket| async move {
        if let Err(err) = handle_container_logs_ws(socket, container_name).await {
            tracing::warn!("container logs websocket closed: {err}");
        }
    }))
}

pub async fn stream_container_shell_ws(
    ws: WebSocketUpgrade,
    Path(container_name): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let container_name = sanitize_identifier(&container_name)?;
    Ok(ws.on_upgrade(move |socket| async move {
        if let Err(err) = handle_container_shell_ws(socket, container_name).await {
            tracing::warn!("container shell websocket closed: {err}");
        }
    }))
}

pub fn router(_deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    Router::new()
        .route("/containers/info", get(get_container_info))
        .route(
            "/containers/{attempt_id}/services",
            get(get_container_services),
        )
        .route(
            "/containers/{container}/logs/ws",
            get(stream_container_logs_ws),
        )
        .route(
            "/containers/{container}/shell/ws",
            get(stream_container_shell_ws),
        )
}

async fn handle_container_logs_ws(socket: WebSocket, container_name: String) -> anyhow::Result<()> {
    let mut child = Command::new("docker")
        .args(["logs", "--follow", "--tail", "400", &container_name])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("Missing stdout for docker logs process"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("Missing stderr for docker logs process"))?;

    let mut stdout_lines =
        FramedRead::new(stdout, LinesCodec::new()).map(|line| line.map(|l| ("stdout", l)));
    let mut stderr_lines =
        FramedRead::new(stderr, LinesCodec::new()).map(|line| line.map(|l| ("stderr", l)));

    let (mut sender, mut receiver) = socket.split();

    loop {
        tokio::select! {
            line = stdout_lines.next() => {
                match line {
                    Some(Ok((channel, content))) => {
                        send_log_frame(&mut sender, channel, content).await?;
                    }
                    Some(Err(err)) => {
                        tracing::warn!("Failed to read container stdout: {err}");
                        break;
                    }
                    None => break,
                }
            }
            line = stderr_lines.next() => {
                match line {
                    Some(Ok((channel, content))) => {
                        send_log_frame(&mut sender, channel, content).await?;
                    }
                    Some(Err(err)) => {
                        tracing::warn!("Failed to read container stderr: {err}");
                        break;
                    }
                    None => break,
                }
            }
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => {
                        break;
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        let _ = sender.send(Message::Pong(payload)).await;
                    }
                    Some(Ok(_)) => {
                        // Ignore any other incoming messages
                    }
                    Some(Err(err)) => {
                        tracing::warn!("WebSocket receive error: {err}");
                        break;
                    }
                }
            }
        }
    }

    let _ = child.start_kill();
    let _ = child.wait().await;
    Ok(())
}

async fn handle_container_shell_ws(
    socket: WebSocket,
    container_name: String,
) -> anyhow::Result<()> {
    let mut child = Command::new("docker")
        .args(["exec", "-i", &container_name, "sh", "-i"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("Missing stdin for docker exec process"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("Missing stdout for docker exec process"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("Missing stderr for docker exec process"))?;

    let (sender, mut receiver) = socket.split();
    let sender = Arc::new(Mutex::new(sender));

    let stdout_task = {
        let sender = Arc::clone(&sender);
        tokio::spawn(async move {
            let mut reader = tokio_util::io::ReaderStream::new(stdout);
            while let Some(chunk) = reader.next().await {
                match chunk {
                    Ok(bytes) => {
                        if sender
                            .lock()
                            .await
                            .send(Message::Binary(bytes))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(err) => {
                        tracing::warn!("Failed to read stdout from docker exec: {err}");
                        break;
                    }
                }
            }
        })
    };

    let stderr_task = {
        let sender = Arc::clone(&sender);
        tokio::spawn(async move {
            let mut reader = tokio_util::io::ReaderStream::new(stderr);
            while let Some(chunk) = reader.next().await {
                match chunk {
                    Ok(bytes) => {
                        if sender
                            .lock()
                            .await
                            .send(Message::Binary(bytes))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(err) => {
                        tracing::warn!("Failed to read stderr from docker exec: {err}");
                        break;
                    }
                }
            }
        })
    };

    while let Some(message) = receiver.next().await {
        match message {
            Ok(Message::Binary(data)) => {
                stdin.write_all(&data).await?;
            }
            Ok(Message::Text(text)) => {
                stdin.write_all(text.as_bytes()).await?;
            }
            Ok(Message::Close(_)) | Err(_) => {
                break;
            }
            Ok(Message::Ping(payload)) => {
                let _ = sender.lock().await.send(Message::Pong(payload)).await;
            }
            Ok(Message::Pong(_)) => {}
        }
    }

    let _ = child.start_kill();
    let _ = child.wait().await;
    let _ = stdout_task.abort();
    let _ = stderr_task.abort();
    Ok(())
}

async fn send_log_frame(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    channel: &str,
    content: String,
) -> anyhow::Result<()> {
    let payload = json!({
        "channel": channel,
        "content": content,
    });
    sender
        .send(Message::Text(payload.to_string().into()))
        .await?;
    Ok(())
}

fn resolve_compose_project(container_ref: &str) -> Result<String, ApiError> {
    let trimmed = container_ref.trim();
    if trimmed.is_empty() {
        return Err(ApiError::Conflict(
            "Container reference is empty; run the attempt once to provision it.".into(),
        ));
    }

    if trimmed.contains('/') || trimmed.contains('\\') {
        if let Some(name) = FsPath::new(trimmed).file_name().and_then(|os| os.to_str()) {
            sanitize_identifier(name)
        } else {
            Err(ApiError::Conflict(
                "Failed to derive compose project from container reference.".into(),
            ))
        }
    } else {
        sanitize_identifier(trimmed)
    }
}

async fn fetch_compose_services(project: &str) -> Result<Vec<ContainerServiceInfo>, ApiError> {
    let filter = format!("label=com.docker.compose.project={project}");
    let output = Command::new("docker")
        .args(["ps", "--filter", &filter, "--format", "{{json .}}"])
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ApiError::Conflict(format!("docker ps failed: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut services = Vec::new();
    for line in stdout.lines().filter(|line| !line.trim().is_empty()) {
        match serde_json::from_str::<DockerPsRow>(line) {
            Ok(row) => services.push(map_row_to_service(row, project)),
            Err(err) => tracing::warn!("Failed to parse docker row: {err} ({line})"),
        }
    }

    Ok(services)
}

fn map_row_to_service(row: DockerPsRow, project: &str) -> ContainerServiceInfo {
    let service = derive_service_name(&row.names, project);
    let browser_url = if service.is_empty() {
        None
    } else {
    Some(format!("http://{service}.{project}.orb.local"))
    };

    let ports = row
        .ports
        .split(',')
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>();

    ContainerServiceInfo {
        container_id: row.id,
        container_name: row.names.clone(),
        service: if service.is_empty() {
            row.names
                .strip_prefix(project)
                .unwrap_or(&row.names)
                .trim_matches('-')
                .to_string()
        } else {
            service
        },
        state: row.state,
        status: row.status,
        image: row.image,
        ports,
        compose_project: project.to_string(),
        browser_url,
    }
}

fn derive_service_name(container_name: &str, project: &str) -> String {
    let prefix = format!("{project}-");
    let trimmed = container_name
        .strip_prefix(&prefix)
        .unwrap_or(container_name);
    if let Some((service, last)) = trimmed.rsplit_once('-') {
        if last.chars().all(|c| c.is_ascii_digit()) {
            return service.to_string();
        }
    }
    trimmed.to_string()
}

fn sanitize_identifier(value: &str) -> Result<String, ApiError> {
    let re = Regex::new(r"^[A-Za-z0-9._-]+$").expect("valid regex");
    if value.is_empty() || !re.is_match(value) {
        return Err(ApiError::Conflict(format!(
            "Identifier '{value}' contains unsupported characters."
        )));
    }
    Ok(value.to_string())
}
