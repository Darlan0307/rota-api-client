import { randomUUID } from 'node:crypto';
import {
  autoApproves,
  type BridgeServer,
  type ConfirmRequest,
  type ConfirmResponse,
  isAutoApprovable,
  type McpActionCategory,
  type McpAutoApprovable,
  startBridgeServer,
} from '@rota/core';
import { BrowserWindow } from 'electron';
import type { SettingsService } from './settings-service';
import type { WorkspaceService } from './workspace-service';

const CONFIRM_TIMEOUT_MS = 110_000;

interface Pending {
  category: McpActionCategory;
  resolve: (response: ConfirmResponse) => void;
}

/**
 * Lado do app da ponte com o servidor MCP: mostra as confirmações pedidas
 * pelo Claude e repassa os avisos de mudanças para a interface.
 *
 * A decisão de liberar sem perguntar fica aqui, e não no servidor MCP: o
 * Claude não tem como mudar essas regras.
 */
export class McpBridge {
  private server: BridgeServer | undefined;
  private readonly pending = new Map<string, Pending>();
  /** Categorias liberadas pelo usuário até fechar o app. */
  private readonly sessionApproved = new Set<McpAutoApprovable>();

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly settings: SettingsService,
  ) {}

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
    for (const { resolve } of this.pending.values())
      resolve({ approved: false, reason: 'o app foi fechado' });
    this.pending.clear();
    await this.server?.close();
  }

  /**
   * Resposta do usuário vinda do renderer. Com `rememberForSession`, a
   * categoria passa sem perguntar até fechar o app, inclusive as que já
   * estavam na fila.
   */
  respond(id: string, approved: boolean, rememberForSession = false): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    entry.resolve(approved ? { approved: true } : { approved: false, reason: 'negado pelo usuário' });
    if (!approved || !rememberForSession || !isAutoApprovable(entry.category)) return;

    this.sessionApproved.add(entry.category);
    for (const [otherId, other] of this.pending) {
      if (other.category !== entry.category) continue;
      this.pending.delete(otherId);
      other.resolve({ approved: true });
      this.window()?.webContents.send('mcp:confirm-closed', { id: otherId });
    }
  }

  sessionApprovals(): McpAutoApprovable[] {
    return [...this.sessionApproved];
  }

  clearSessionApprovals(): void {
    this.sessionApproved.clear();
  }

  private window(): BrowserWindow | undefined {
    return BrowserWindow.getAllWindows()[0];
  }

  private confirm(request: ConfirmRequest): Promise<ConfirmResponse> {
    const win = this.window();
    if (autoApproves(request.category, this.settings.get().mcpAutoApprove, this.sessionApproved)) {
      // Organizar, editar e excluir já viram um aviso pelo notify; o envio não.
      if (request.category === 'send')
        win?.webContents.send('mcp:auto-approved', { description: request.description });
      return Promise.resolve({ approved: true });
    }
    if (!win) return Promise.resolve({ approved: false, reason: 'a janela do app não está aberta' });

    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        win.webContents.send('mcp:confirm-timeout', { id });
        resolve({ approved: false, reason: 'sem resposta do usuário a tempo' });
      }, CONFIRM_TIMEOUT_MS);
      this.pending.set(id, {
        category: request.category,
        resolve: (response) => {
          clearTimeout(timer);
          resolve(response);
        },
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
