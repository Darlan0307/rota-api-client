import { type ChildProcess, spawn } from 'node:child_process';

/**
 * "Quick tunnel" do cloudflared: cria uma URL https://<aleatório>.trycloudflare.com
 * que entrega as chamadas numa porta local. Gratuito e sem conta; a URL muda a
 * cada início.
 */

export function cloudflaredDownloadUrl(arch: string = process.arch): string {
  const file = arch === 'arm64' ? 'cloudflared-windows-arm64.exe' : 'cloudflared-windows-amd64.exe';
  return `https://github.com/cloudflare/cloudflared/releases/latest/download/${file}`;
}

export function quickTunnelArgs(localPort: number): string[] {
  return ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${localPort}`];
}

const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

export function parseQuickTunnelUrl(line: string): string | null {
  return URL_PATTERN.exec(line)?.[0] ?? null;
}

/** A conexão com a Cloudflare foi registrada: a URL já responde. */
export function isConnectedLine(line: string): boolean {
  return /Registered tunnel connection/i.test(line);
}

/** Explica, em português, as falhas mais comuns a partir do log. */
export function describeCloudflaredFailure(logs: readonly string[]): string {
  const text = logs.join('\n');
  if (/failed to request quick Tunnel|429|Too Many Requests/i.test(text))
    return 'A Cloudflare não criou o túnel agora (limite de uso ou instabilidade). Tente de novo em alguns segundos.';
  if (/config.*(yml|yaml)|configuration file/i.test(text))
    return 'Há um arquivo de configuração do cloudflared em %USERPROFILE%\\.cloudflared que impede o túnel rápido. Renomeie-o e tente de novo.';
  if (/no such host|dial tcp|i\/o timeout|network is unreachable|failed to dial/i.test(text))
    return 'Sem conexão com a Cloudflare. Verifique a internet, VPN ou firewall da rede.';
  const lastError = [...logs].reverse().find((l) => /ERR|error/i.test(l));
  return lastError ? `O cloudflared parou: ${lastError}` : 'O cloudflared parou sem informar o motivo.';
}

export interface QuickTunnelOptions {
  binary: string;
  localPort: number;
  /** Cada linha do log (stdout/stderr). */
  onLog?: (line: string) => void;
  /** O processo terminou depois de iniciado (queda, parada). */
  onExit?: (code: number | null, logs: string[]) => void;
  /** Tempo máximo até a URL aparecer (padrão 45 s). */
  timeoutMs?: number;
  /** Depois da URL, quanto esperar pela conexão antes de considerar pronto (padrão 15 s). */
  connectGraceMs?: number;
  /** Para testes. */
  args?: string[];
}

export class QuickTunnel {
  private child: ChildProcess | null = null;
  private readonly logs: string[] = [];
  private stopping = false;

  /** Inicia e resolve com a URL pública quando ela já está aceitando chamadas. */
  start(options: QuickTunnelOptions): Promise<string> {
    const child = spawn(options.binary, options.args ?? quickTunnelArgs(options.localPort), {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;

    return new Promise<string>((resolve, reject) => {
      let url: string | null = null;
      let settled = false;
      let grace: NodeJS.Timeout | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearTimeout(grace);
        if (error) reject(error);
        else resolve(url as string);
      };
      const timeout = setTimeout(() => {
        finish(
          new Error(
            describeCloudflaredFailure(this.logs) || 'O cloudflared demorou demais para criar a URL.',
          ),
        );
        this.stop();
      }, options.timeoutMs ?? 45_000);

      let buffer = '';
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;
          this.logs.push(line);
          if (this.logs.length > 200) this.logs.shift();
          options.onLog?.(line);
          url ??= parseQuickTunnelUrl(line);
          if (url && !grace) grace = setTimeout(() => finish(), options.connectGraceMs ?? 15_000);
          if (url && isConnectedLine(line)) finish();
        }
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);

      child.on('error', (error: NodeJS.ErrnoException) => {
        finish(
          new Error(
            error.code === 'ENOENT'
              ? 'O cloudflared não foi encontrado. Baixe-o de novo na tela de túneis.'
              : `Não foi possível iniciar o cloudflared: ${error.message}`,
          ),
        );
      });
      child.on('exit', (code) => {
        this.child = null;
        if (!settled)
          finish(new Error(this.stopping ? 'Túnel parado.' : describeCloudflaredFailure(this.logs)));
        else if (!this.stopping) options.onExit?.(code, [...this.logs]);
      });
    });
  }

  /** PID do processo (para encerrar sobras se o app for morto à força). */
  get pid(): number | undefined {
    return this.child?.pid;
  }

  get running(): boolean {
    return this.child !== null;
  }

  recentLogs(): string[] {
    return [...this.logs];
  }

  stop(): void {
    this.stopping = true;
    this.child?.kill();
    this.child = null;
  }
}
