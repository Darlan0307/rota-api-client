import { randomUUID } from 'node:crypto';
import { type BridgeServer, type ConfirmRequest, type ConfirmResponse, startBridgeServer } from '@rota/core';
import { BrowserWindow } from 'electron';
import type { WorkspaceService } from './workspace-service';

const CONFIRM_TIMEOUT_MS = 110_000;

/**
 * Lado do app da ponte com o servidor MCP: mostra as confirmações pedidas
 * pelo Claude e repassa os avisos de mudanças para a interface.
 */
export class McpBridge {
  private server: BridgeServer | undefined;
  private readonly pending = new Map<string, (response: ConfirmResponse) => void>();

  constructor(private readonly workspace: WorkspaceService) {}

  async start(): Promise<void> {
    this.server = await startBridgeServer({
      confirm: (request) => this.confirm(request),
      notify: (notice) => {
        const win = this.window();
        switch (notice.kind) {
          case 'changed':
            if (notice.message) win?.webContents.send('mcp:notice', { message: notice.message });
            break;
          case 'state':
            void this.workspace.reloadLocalState();
            break;
          case 'history':
            this.workspace.history.invalidate();
            win?.webContents.send('history:changed', null);
            break;
          case 'trash':
            win?.webContents.send('trash:changed', null);
            break;
        }
      },
    });
  }

  async stop(): Promise<void> {
    for (const resolve of this.pending.values()) resolve({ approved: false, reason: 'o app foi fechado' });
    this.pending.clear();
    await this.server?.close();
  }

  /** Resposta do usuário vinda do renderer. */
  respond(id: string, approved: boolean): void {
    const resolve = this.pending.get(id);
    if (!resolve) return;
    this.pending.delete(id);
    resolve(approved ? { approved: true } : { approved: false, reason: 'negado pelo usuário' });
  }

  private window(): BrowserWindow | undefined {
    return BrowserWindow.getAllWindows()[0];
  }

  private confirm(request: ConfirmRequest): Promise<ConfirmResponse> {
    const win = this.window();
    if (!win) return Promise.resolve({ approved: false, reason: 'a janela do app não está aberta' });

    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        win.webContents.send('mcp:confirm-timeout', { id });
        resolve({ approved: false, reason: 'sem resposta do usuário a tempo' });
      }, CONFIRM_TIMEOUT_MS);
      this.pending.set(id, (response) => {
        clearTimeout(timer);
        resolve(response);
      });

      // Traz o app para frente: a decisão precisa ser vista.
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.flashFrame(true);
      win.webContents.send('mcp:confirm', { id, ...request });
    });
  }
}
