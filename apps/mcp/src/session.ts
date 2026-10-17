import { basename, join } from 'node:path';
import {
  appDataDir,
  BridgeClient,
  type ConfirmRequest,
  createSecretStore,
  defaultWorkspaceDir,
  HistoryStore,
  loadAppSettings,
  loadWorkspaceState,
  normalizeWorkspacePath,
  type SecretStore,
  Trash,
  WorkspaceStore,
  workspaceLocalDir,
} from '@rota/core';

/** Erro de negócio mostrado ao Claude como resultado de ferramenta (isError). */
export class ToolError extends Error {}

export interface SessionOptions {
  dataDir?: string;
  /** Para testes: injeta o cofre de segredos (padrão: Credential Manager + arquivo cifrado). */
  secretsFactory?: (localDir: string) => SecretStore;
}

/**
 * Estado do servidor MCP: qual workspace está em uso (por padrão o mesmo que
 * está aberto no app) e os serviços do core para ele.
 */
export class McpSession {
  readonly dataDir: string;
  readonly bridge: BridgeClient;
  private root: string | null = null;
  private storeInstance: WorkspaceStore | undefined;
  private historyInstance: HistoryStore | undefined;
  private trashInstance: Trash | undefined;

  constructor(private readonly options: SessionOptions = {}) {
    this.dataDir = options.dataDir ?? appDataDir();
    this.bridge = new BridgeClient(this.dataDir);
  }

  /** Abre o workspace atual do app (ou o indicado) na primeira chamada. */
  async store(): Promise<WorkspaceStore> {
    if (!this.storeInstance) {
      const settings = await loadAppSettings(this.dataDir);
      await this.open(settings.currentWorkspace);
    }
    const store = this.storeInstance as WorkspaceStore;
    // O app (ou o usuário) pode ter mudado arquivos desde a última chamada.
    await store.reload();
    return store;
  }

  async open(root: string | null): Promise<WorkspaceStore> {
    const path = root ?? defaultWorkspaceDir(this.dataDir);
    const localDir = workspaceLocalDir(path, this.dataDir);
    const secrets = this.options.secretsFactory?.(localDir) ?? createSecretStore(localDir);
    this.storeInstance = await WorkspaceStore.open(path, {
      secrets,
      defaultName: root ? basename(path) : 'Workspace padrão',
    });
    this.root = path;
    this.historyInstance = new HistoryStore(localDir);
    this.trashInstance = new Trash(join(localDir, 'trash'), this.storeInstance);
    return this.storeInstance;
  }

  /** Valores secretos do workspace aberto (para mascarar as saídas). */
  secretValues(): string[] {
    return this.storeInstance?.allSecretValues() ?? [];
  }

  get rootPath(): string {
    if (!this.root) throw new ToolError('Nenhum workspace aberto.');
    return this.root;
  }

  get isDefault(): boolean {
    return (
      normalizeWorkspacePath(this.rootPath) === normalizeWorkspacePath(defaultWorkspaceDir(this.dataDir))
    );
  }

  async history(): Promise<HistoryStore> {
    await this.store();
    const history = this.historyInstance as HistoryStore;
    history.invalidate();
    return history;
  }

  async trash(): Promise<Trash> {
    await this.store();
    return this.trashInstance as Trash;
  }

  async activeEnvironmentId(): Promise<string | null> {
    const store = await this.store();
    const { activeEnvironmentId } = await loadWorkspaceState(this.rootPath, this.dataDir);
    return store.snapshot().environments.some((e) => e.id === activeEnvironmentId)
      ? activeEnvironmentId
      : null;
  }

  /**
   * Pede confirmação ao usuário no app. Sem app aberto, ou se o usuário negar,
   * lança um erro com a explicação para o Claude.
   */
  async confirm(request: ConfirmRequest): Promise<void> {
    const response = await this.bridge.confirm(request).catch((error: unknown) => {
      throw new ToolError(error instanceof Error ? error.message : String(error));
    });
    if (!response.approved) {
      throw new ToolError(
        `O usuário não autorizou esta ação no app (${response.reason ?? 'negado'}). Não tente de novo sem que ele peça.`,
      );
    }
  }

  /** Avisa o app que algo mudou (mensagem aparece como aviso discreto). */
  async notifyChanged(message: string): Promise<void> {
    await this.bridge.notify({ kind: 'changed', message });
  }
}
