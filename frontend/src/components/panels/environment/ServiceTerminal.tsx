import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface ServiceTerminalProps {
  containerName?: string;
}

export function ServiceTerminal({ containerName }: ServiceTerminalProps) {
  const { t } = useTranslation('tasks');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerName || !containerRef.current) {
      return;
    }

    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily: 'var(--font-mono)',
      theme: {
        background: '#0a0a0a',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const socket = new WebSocket(
      `${protocol}//${host}/api/containers/${encodeURIComponent(containerName)}/shell/ws`
    );
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    term.writeln(t('environment.terminal.connecting'));

    socket.onopen = () => {
      term.writeln(t('environment.terminal.ready'));
    };

    socket.onmessage = (event) => {
      if (typeof event.data === 'string') {
        term.write(event.data);
      } else {
        term.write(decoder.decode(event.data));
      }
    };

    socket.onclose = () => {
      term.writeln(`\r\n${t('environment.terminal.closed')}`);
    };

    socket.onerror = () => {
      term.writeln(`\r\n${t('environment.terminal.error')}`);
    };

    term.onData((chunk) => {
      if (chunk === '\r') {
        term.write('\r\n');
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(encoder.encode('\n'));
        }
        return;
      }

      term.write(chunk);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(encoder.encode(chunk));
      }
    });

    const handleResize = () => {
      try {
        fitAddon.fit();
      } catch (err) {
        console.warn('Failed to resize terminal', err);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      socketRef.current?.close();
      socketRef.current = null;
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [containerName, t]);

  if (!containerName) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('environment.terminal.selectService')}
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden rounded-md border border-border bg-black">
      <div ref={containerRef} className="h-full" aria-label="Container shell" />
    </div>
  );
}
