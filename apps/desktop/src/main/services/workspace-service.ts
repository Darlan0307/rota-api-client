import { basename, join } from 'node:path';
import {
  createSecretStore,
  defaultWorkspaceDir,
  HistoryStore,
  type WorkspaceState as LocalState,
  loadWorkspaceState,
  normalizeWorkspacePath,
  saveWorkspaceState,
  Trash,
  type VariableTarget,
  WorkspaceStore,
  type WorkspaceWatcher,
  watchWorkspace,
  workspaceLocalDir,
} from '@rota/core';
import type { CommandResult, WorkspaceCommand, WorkspaceState } from '../../shared/ipc';

/**
 * Mantém o workspace aberto: store, watcher de arquivos e estado local
 * (ambiente ativo). Notifica o renderer a cada mudança.
 */
export class WorkspaceService {
  private store: WorkspaceStore | undefined;
  private watcher: WorkspaceWatcher | undefined;
  private local: LocalState = { activeEnvironmentId: null };
  private root = '';
  private historyStore: HistoryStore | undefined;
  private trashStore: Trash | undefined;

  constructor(
    private readonly notify: (state: WorkspaceState) => void,
    private readonly notifyTrash: () => void = () => undefined,
  ) {}

  /** Lixeira do workspace aberto (fica em %APPDATA%, fora do Git). */
  get trash(): Trash {
    if (!this.trashStore) throw new Error('Nenhum workspace aberto.');
    return this.trashStore;
  }

  get rootPath(): string {
    return this.root;
  }

  get current(): WorkspaceStore {
    if (!this.store) throw new Error('Nenhum workspace aberto.');
    return this.store;
  }

  /** Histórico de envios do workspace aberto (fica em %APPDATA%, fora do Git). */
  get history(): HistoryStore {
    if (!this.historyStore) throw new Error('Nenhum workspace aberto.');
    return this.historyStore;
  }

  get localDir(): string {
    return workspaceLocalDir(this.root);
  }

  get isDefault(): boolean {
    return normalizeWorkspacePath(this.root) === normalizeWorkspacePath(defaultWorkspaceDir());
  }

  /** Abre um workspace (null = workspace principal em %APPDATA%). */
  async open(root: string | null): Promise<WorkspaceState> {
    // Abre o novo antes de fechar o atual: se falhar (pasta inacessível,
    // sem permissão...), o workspace que estava aberto continua funcionando.
    const path = root ?? defaultWorkspaceDir();
    const localDir = workspaceLocalDir(path);
    const store = await WorkspaceStore.open(path, {
      secrets: createSecretStore(localDir),
      defaultName: root ? basename(path) : 'Workspace principal',
    });
    const local = await loadWorkspaceState(path);

    await this.close();
    this.root = path;
    this.store = store;
    this.local = local;
    this.historyStore = new HistoryStore(localDir);
    this.trashStore = new Trash(join(localDir, 'trash'), store);
    this.watcher = watchWorkspace(path, () => void this.reloadFromDisk());
    return this.state();
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    this.watcher = undefined;
    this.store = undefined;
  }

  state(): WorkspaceState {
    const snapshot = this.current.snapshot();
    const activeId = this.local.activeEnvironmentId;
    return {
      snapshot,
      // Ambiente ativo que deixou de existir vira "sem ambiente".
      activeEnvironmentId: snapshot.environments.some((e) => e.id === activeId) ? activeId : null,
      isDefault: this.isDefault,
    };
  }

  get activeEnvironmentId(): string | null {
    return this.state().activeEnvironmentId;
  }

  async setActiveEnvironment(id: string | null): Promise<void> {
    this.local = { ...this.local, activeEnvironmentId: id };
    await saveWorkspaceState(this.root, this.local);
    this.emit();
  }

  revealSecret(target: VariableTarget, key: string): string | null {
    return this.current.revealSecret(target, key) ?? null;
  }

  async command(command: WorkspaceCommand): Promise<CommandResult> {
    const store = this.current;
    let id: string | undefined;
    switch (command.type) {
      case 'createCollection':
        id = await store.createCollection(command.name);
        break;
      case 'createFolder':
        id = await store.createFolder(command.parentId, command.name, opt({ index: command.index }));
        break;
      case 'createRequest':
        id = await store.createRequest(
          command.parentId,
          command.name,
          command.data ?? {},
          opt({ index: command.index }),
        );
        break;
      case 'updateRequest':
        await store.updateRequest(command.id, command.data);
        break;
      case 'updateCollection':
        await store.updateCollection(
          command.id,
          opt({
            auth: command.auth,
            description: command.description,
            variables: command.variables,
            scripts: command.scripts,
          }),
        );
        break;
      case 'updateFolder':
        await store.updateFolder(
          command.id,
          opt({ auth: command.auth, description: command.description, scripts: command.scripts }),
        );
        break;
      case 'rename':
        await store.rename(command.id, command.name);
        break;
      case 'move':
        await store.move(command.id, command.parentId, command.index);
        break;
      case 'duplicate':
        id = await store.duplicate(command.id);
        break;
      case 'remove':
        // Excluir sempre passa pela lixeira (pode ser restaurado).
        // O id devolvido é o da entrada na lixeira (para desfazer).
        id = (await this.trash.moveToTrash(command.id)).id;
        this.notifyTrash();
        break;
      case 'reorderCollections':
        await store.reorderCollections(command.order);
        break;
      case 'createEnvironment':
        id = await store.createEnvironment(command.name);
        break;
      case 'updateEnvironment':
        await store.updateEnvironment(command.id, command.variables);
        break;
      case 'updateGlobals':
        await store.updateGlobals(command.variables);
        break;
      case 'setVariable':
        await store.setVariable(command.target, command.key, command.value);
        break;
    }
    this.emit();
    return id ? { id } : {};
  }

  /** Relê o estado local (ambiente ativo), alterado pelo MCP. */
  async reloadLocalState(): Promise<void> {
    if (!this.store) return;
    this.local = await loadWorkspaceState(this.root);
    this.emit();
  }

  /** Chamado pelo watcher quando algo muda fora do app (editor, git, MCP). */
  private async reloadFromDisk(): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.reload();
      this.local = await loadWorkspaceState(this.root);
      this.emit();
    } catch {
      // Uma leitura no meio de uma gravação externa pode falhar; o próximo evento corrige.
    }
  }

  emit(): void {
    if (this.store) this.notify(this.state());
  }
}

/** Remove chaves `undefined` (compatível com exactOptionalPropertyTypes). */
function opt<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as never;
}
