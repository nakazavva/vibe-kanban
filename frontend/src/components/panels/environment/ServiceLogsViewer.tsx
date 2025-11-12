import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProcessLogsViewerContent } from '@/components/tasks/TaskDetails/ProcessLogsViewer';
import type { PatchType } from 'shared/types';

const MAX_LOG_LINES = 500;

type LogEntry = Extract<PatchType, { type: 'STDOUT' } | { type: 'STDERR' }>;

type UseContainerLogsResult = {
  logs: LogEntry[];
  error: string | null;
  isActive: boolean;
};

const useContainerLogs = (containerName?: string): UseContainerLogsResult => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!containerName) {
      setLogs([]);
      setError(null);
      setIsActive(false);
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const ws = new WebSocket(
      `${protocol}//${host}/api/containers/${encodeURIComponent(containerName)}/logs/ws`
    );
    wsRef.current = ws;
    setIsActive(true);

    ws.onopen = () => {
      setLogs([]);
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data?.content) return;
        const channel = data.channel === 'stderr' ? 'STDERR' : 'STDOUT';
        setLogs((prev) => {
          const next = [...prev, { type: channel, content: data.content } as LogEntry];
          if (next.length > MAX_LOG_LINES) {
            return next.slice(next.length - MAX_LOG_LINES);
          }
          return next;
        });
      } catch (err) {
        console.error('Failed to parse container log entry', err);
      }
    };

    ws.onerror = () => {
      setError('connection');
    };

    ws.onclose = () => {
      setIsActive(false);
    };

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [containerName]);

  return { logs, error, isActive };
};

interface ServiceLogsViewerProps {
  containerName?: string;
}

export function ServiceLogsViewer({ containerName }: ServiceLogsViewerProps) {
  const { t } = useTranslation('tasks');
  const { logs, error, isActive } = useContainerLogs(containerName);

  if (!containerName) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('environment.logs.selectService')}
      </div>
    );
  }

  if (!isActive && !logs.length) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('environment.logs.waiting')}
      </div>
    );
  }

  return <ProcessLogsViewerContent logs={logs} error={error} />;
}
