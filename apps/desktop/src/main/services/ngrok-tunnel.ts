import type { Listener, Session } from '@ngrok/ngrok';
import { describeNgrokError } from '@rota/core';

export interface NgrokStartOptions {
  authtoken: string;
  /** Vazio = o domínio que a conta tiver (o grátis vem atribuído). */
  domain: string;
  localPort: number;
  /** Versão do app (vai no User-Agent do agente, aparece no painel do ngrok). */
  appVersion: string;
  onLog?: (line: string) => void;
  timeoutMs?: number;
}

/**
 * Túnel do ngrok pelo SDK oficial: roda dentro do próprio processo do app
 * (não sobra ngrok.exe se o Rota for morto à força) e reconecta sozinho
 * depois de quedas de rede, mantendo a mesma URL.
 */
export class NgrokTunnel {
  private session: Session | null = null;
  private listener: Listener | null = null;
  private stopped = false;

  async start(options: NgrokStartOptions): Promise<string> {
    const log = (line: string) => options.onLog?.(line);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(new Error('O ngrok demorou demais para responder. Verifique a internet e tente de novo.')),
        options.timeoutMs ?? 30_000,
      ).unref(),
    );
    try {
      const ngrok = await import('@ngrok/ngrok');
      log('Conectando ao ngrok…');
      const session = await Promise.race([
        new ngrok.SessionBuilder()
          .authtoken(options.authtoken)
          .clientInfo('rota', options.appVersion)
          .handleDisconnection((_addr, error) => {
            log(`Conexão com o ngrok caiu (${error}); reconectando…`);
            // true = o SDK tenta de novo; a URL continua a mesma.
            return !this.stopped;
          })
          .connect(),
        timeout,
      ]);
      this.session = session;
      if (this.stopped) throw new Error('Túnel parado.');
      const builder = session.httpEndpoint();
      if (options.domain) builder.domain(options.domain);
      const listener = await Promise.race([
        builder.listenAndForward(`http://127.0.0.1:${options.localPort}`),
        timeout,
      ]);
      this.listener = listener;
      const url = listener.url();
      if (!url) throw new Error('O ngrok não informou a URL do túnel.');
      log(`Túnel ativo: ${url}`);
      return url;
    } catch (error) {
      await this.stop();
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'Túnel parado.' || message.startsWith('O ngrok demorou')) throw error;
      throw new Error(describeNgrokError(message));
    }
  }

  get running(): boolean {
    return this.listener !== null;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const { listener, session } = this;
    this.listener = null;
    this.session = null;
    await listener?.close().catch(() => undefined);
    await session?.close().catch(() => undefined);
  }
}
