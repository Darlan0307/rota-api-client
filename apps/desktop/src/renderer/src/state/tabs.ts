import {
  type Auth,
  describeAuth,
  diffLines,
  diffRequestData,
  diffVariables,
  type ExampleFile,
  type FieldChange,
  findNode,
  type LoadTestConfig,
  type LoadTestResult,
  type LoadTestStats,
  type RequestData,
  RequestDataSchema,
  type RunResult,
  type Scripts,
  type VariableView,
  type WorkspaceSnapshot,
  walkTree,
} from '@rota/core/shared';
import { create } from 'zustand';
import { deepEqual } from '../lib/equal';
import { draftsFromViews, emptyDraft, type VariableDraft, variablesDirty } from './variable-drafts';

// ---------------------------------------------------------------------------
// Tipos

export type RequestSection = 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'settings';
export type ResponseSection = 'body' | 'headers' | 'tests' | 'console' | 'timeline' | 'contract' | 'compare';

export interface RunState {
  runId: string;
  status: 'sending' | 'done';
  startedAt: number;
  result?: RunResult;
}

export type Conflict = { type: 'changed'; incoming: unknown; changes: FieldChange[] } | { type: 'deleted' };

interface TabCommon {
  id: string;
  title: string;
  /** Item salvo correspondente (null = requisição nova ainda não salva). */
  itemId: string | null;
  conflict: Conflict | null;
  /** Fixada: fica no início da barra e não fecha por Ctrl+W, clique do meio ou "Fechar todas". */
  pinned?: true;
}

export interface RequestTab extends TabCommon {
  kind: 'request';
  /** Onde a requisição nova será criada por padrão / contexto de herança. */
  parentId: string | null;
  draft: RequestData;
  base: RequestData | null;
  run: RunState | null;
  section: RequestSection;
  responseSection: ResponseSection;
}

export interface VariablesTab extends TabCommon {
  kind: 'environment' | 'globals';
  draft: VariableDraft[];
  base: VariableView[];
}

export interface CollectionDraft {
  auth: Auth;
  description: string;
  variables: VariableDraft[];
  scripts: Scripts;
}

export interface CollectionTab extends TabCommon {
  kind: 'collection';
  draft: CollectionDraft;
  base: { auth: Auth; description: string; variables: VariableView[]; scripts: Scripts };
  section: 'variables' | 'auth' | 'scripts' | 'description';
}

export interface FolderTab extends TabCommon {
  kind: 'folder';
  draft: { auth: Auth; description: string; scripts: Scripts };
  base: { auth: Auth; description: string; scripts: Scripts };
  section: 'auth' | 'scripts' | 'description';
}

/** Exemplo salvo de uma requisição (somente leitura). */
export interface ExampleTab extends TabCommon {
  kind: 'example';
  requestId: string;
  draft: ExampleFile;
  base: ExampleFile;
}

/** Teste de carga de uma requisição (cópia da requisição no momento em que foi aberto). */
export interface LoadTestTab extends TabCommon {
  kind: 'loadtest';
  requestId: string | null;
  parentId: string | null;
  data: RequestData;
  config: LoadTestConfig;
  runId: string | null;
  status: 'idle' | 'running' | 'done';
  stats: LoadTestStats | null;
  result: LoadTestResult | null;
  error: string | null;
}

/** Túnel público (itemId = id do túnel; o estado vem do processo principal). */
export interface TunnelTab extends TabCommon {
  kind: 'tunnel';
}

/** Banco de dados (itemId = id da conexão; consulta e resultado ficam na própria aba). */
export interface DatabaseTab extends TabCommon {
  kind: 'database';
}

export type Tab =
  | RequestTab
  | VariablesTab
  | CollectionTab
  | FolderTab
  | ExampleTab
  | LoadTestTab
  | TunnelTab
  | DatabaseTab;

/** Localiza um exemplo e a requisição dona. */
export function findExample(snapshot: WorkspaceSnapshot, id: string) {
  for (const node of walkTree(snapshot.collections)) {
    if (node.kind !== 'request') continue;
    const example = node.examples.find((e) => e.id === id);
    if (example) return { example, request: node };
  }
  return undefined;
}
export type TabKind = Tab['kind'];

// ---------------------------------------------------------------------------
// Leitura do snapshot por tipo de aba

const NOT_FOUND = Symbol('not-found');

function readIncoming(
  tab: Tab,
  snapshot: WorkspaceSnapshot,
): { title: string; value: unknown } | typeof NOT_FOUND {
  if (tab.kind === 'globals') return { title: 'Variáveis globais', value: snapshot.globals };
  if (!tab.itemId) return NOT_FOUND;
  if (tab.kind === 'environment') {
    const env = snapshot.environments.find((e) => e.id === tab.itemId);
    return env ? { title: env.name, value: env.variables } : NOT_FOUND;
  }
  if (tab.kind === 'example') {
    const found = findExample(snapshot, tab.itemId);
    return found ? { title: found.example.name, value: found.example } : NOT_FOUND;
  }
  const node = findNode(snapshot, tab.itemId);
  if (!node || node.kind !== tab.kind) return NOT_FOUND;
  switch (node.kind) {
    case 'request':
      return { title: node.name, value: node.data };
    case 'collection':
      return {
        title: node.name,
        value: {
          auth: node.auth,
          description: node.description ?? '',
          variables: node.variables,
          scripts: node.scripts,
        },
      };
    case 'folder':
      return {
        title: node.name,
        value: { auth: node.auth, description: node.description ?? '', scripts: node.scripts },
      };
  }
}

export function isDirty(tab: Tab): boolean {
  switch (tab.kind) {
    case 'request':
      return tab.base === null ? true : !deepEqual(tab.draft, tab.base);
    case 'environment':
    case 'globals':
      return variablesDirty(tab.draft, tab.base);
    case 'collection':
      return (
        !deepEqual(tab.draft.auth, tab.base.auth) ||
        tab.draft.description !== tab.base.description ||
        !deepEqual(tab.draft.scripts, tab.base.scripts) ||
        variablesDirty(tab.draft.variables, tab.base.variables)
      );
    case 'folder':
      return !deepEqual(tab.draft, tab.base);
    case 'example':
    case 'loadtest':
    case 'tunnel':
    case 'database':
      return false;
  }
}

/** Aplica a versão do disco à aba (descarta o rascunho). */
function withIncoming(tab: Tab, value: unknown): Tab {
  switch (tab.kind) {
    case 'request': {
      const data = value as RequestData;
      return { ...tab, base: data, draft: structuredClone(data), conflict: null };
    }
    case 'environment':
    case 'globals': {
      const views = value as VariableView[];
      return { ...tab, base: views, draft: [...draftsFromViews(views), emptyDraft()], conflict: null };
    }
    case 'collection': {
      const v = value as CollectionTab['base'];
      return {
        ...tab,
        base: v,
        draft: {
          auth: structuredClone(v.auth),
          description: v.description,
          variables: [...draftsFromViews(v.variables), emptyDraft()],
          scripts: structuredClone(v.scripts),
        },
        conflict: null,
      };
    }
    case 'folder': {
      const v = value as FolderTab['base'];
      return { ...tab, base: v, draft: structuredClone(v), conflict: null };
    }
    case 'example': {
      const v = value as ExampleFile;
      return { ...tab, base: v, draft: v, conflict: null };
    }
    case 'loadtest':
    case 'tunnel':
    case 'database':
      return tab;
  }
}

/** Mantém o rascunho, mas passa a considerar a versão do disco como base. */
function keepMine(tab: Tab, value: unknown): Tab {
  return { ...tab, base: value, conflict: null } as Tab;
}

function describeChanges(tab: Tab, incoming: unknown): FieldChange[] {
  switch (tab.kind) {
    case 'request':
      return tab.base ? diffRequestData(tab.base, incoming as RequestData) : [];
    case 'environment':
    case 'globals':
      return diffVariables(tab.base, incoming as VariableView[]);
    case 'collection': {
      const inc = incoming as CollectionTab['base'];
      return [
        ...authChange(tab.base.auth, inc.auth),
        ...descriptionChange(tab.base.description, inc.description),
        ...scriptsChange(tab.base.scripts, inc.scripts),
        ...diffVariables(tab.base.variables, inc.variables),
      ];
    }
    case 'folder': {
      const inc = incoming as FolderTab['base'];
      return [
        ...authChange(tab.base.auth, inc.auth),
        ...descriptionChange(tab.base.description, inc.description),
        ...scriptsChange(tab.base.scripts, inc.scripts),
      ];
    }
    case 'example':
    case 'loadtest':
    case 'tunnel':
    case 'database':
      return [];
  }
}

function authChange(before: Auth, after: Auth): FieldChange[] {
  return deepEqual(before, after)
    ? []
    : [{ field: 'Autenticação', before: describeAuth(before), after: describeAuth(after) }];
}

function scriptsChange(before: Scripts | undefined, after: Scripts | undefined): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [key, label] of [
    ['preRequest', 'Script de pré-requisição'],
    ['postResponse', 'Script de pós-resposta'],
  ] as const) {
    const a = before?.[key] ?? '';
    const b = after?.[key] ?? '';
    if (a !== b) changes.push({ field: label, lines: diffLines(a, b) });
  }
  return changes;
}

function descriptionChange(before: string, after: string): FieldChange[] {
  return before === after ? [] : [{ field: 'Descrição', lines: diffLines(before, after) }];
}

/** O rascunho já é igual ao que chegou do disco (ex.: o próprio salvamento). */
function draftMatches(tab: Tab, incoming: unknown): boolean {
  const probe = withIncoming(tab, incoming);
  switch (tab.kind) {
    case 'request':
      return deepEqual(tab.draft, incoming);
    case 'environment':
    case 'globals':
      return !variablesDirty(tab.draft, incoming as VariableView[]);
    case 'collection':
      return !isDirty({ ...tab, base: (probe as CollectionTab).base });
    case 'folder':
      return deepEqual(tab.draft, incoming);
    case 'example':
    case 'loadtest':
    case 'tunnel':
    case 'database':
      return true;
  }
}

// ---------------------------------------------------------------------------
// Store

interface TabsState {
  tabs: Tab[];
  activeId: string | null;
  /** Workspace ao qual as abas pertencem (para persistir por workspace). */
  workspaceRoot: string | null;

  openItem(
    kind: 'request' | 'collection' | 'folder' | 'environment' | 'example',
    itemId: string,
    snapshot: WorkspaceSnapshot,
  ): void;
  openGlobals(snapshot: WorkspaceSnapshot): void;
  openLoadTest(source: RequestTab): void;
  /** Abre (ou ativa) a aba de um túnel. */
  openTunnel(id: string, title: string): void;
  /** Abre (ou ativa) a aba de uma conexão de banco. */
  openDatabase(id: string, title: string): void;
  openNewRequest(options?: {
    parentId?: string | null;
    data?: Partial<RequestData>;
    title?: string;
    run?: RunState | null;
  }): string;
  close(id: string): void;
  closeOthers(id: string): void;
  /** Fixa ou desafixa; as fixadas ficam sempre antes das outras. */
  togglePin(id: string): void;
  setActive(id: string): void;
  activateRelative(delta: number): void;
  move(id: string, toIndex: number): void;
  update<T extends Tab>(id: string, change: (tab: T) => T): void;
  /** Após salvar: o rascunho vira a nova base. */
  /** `saved`: conteúdo efetivamente gravado (o rascunho pode ter mudado durante o salvamento). */
  markSaved(
    id: string,
    patch?: { itemId?: string; parentId?: string | null; title?: string },
    saved?: RequestData,
  ): void;
  resolveConflict(id: string, choice: 'reload' | 'keep'): void;
  reconcile(snapshot: WorkspaceSnapshot): void;
  loadForWorkspace(root: string, snapshot: WorkspaceSnapshot): void;
}

let tabCounter = 0;
function tabId(): string {
  tabCounter += 1;
  return `t${Date.now().toString(36)}${tabCounter}`;
}

const EMPTY_SCRIPTS: Scripts = { preRequest: '', postResponse: '' };

export function newRequestData(partial: Partial<RequestData> = {}): RequestData {
  return RequestDataSchema.parse(partial);
}

function createTab(
  kind: 'request' | 'collection' | 'folder' | 'environment' | 'globals' | 'example',
  itemId: string | null,
  incoming: { title: string; value: unknown },
): Tab {
  const common = { id: tabId(), itemId, title: incoming.title, conflict: null };
  switch (kind) {
    case 'request':
      return withIncoming(
        {
          ...common,
          kind,
          parentId: null,
          draft: newRequestData(),
          base: null,
          run: null,
          section: 'params',
          responseSection: 'body',
        },
        incoming.value,
      );
    case 'environment':
    case 'globals':
      return withIncoming({ ...common, kind, draft: [], base: [] }, incoming.value);
    case 'collection':
      return withIncoming(
        {
          ...common,
          kind,
          draft: { auth: { type: 'none' }, description: '', variables: [], scripts: EMPTY_SCRIPTS },
          base: { auth: { type: 'none' }, description: '', variables: [], scripts: EMPTY_SCRIPTS },
          section: 'variables',
        },
        incoming.value,
      );
    case 'folder':
      return withIncoming(
        {
          ...common,
          kind,
          draft: { auth: { type: 'inherit' }, description: '', scripts: EMPTY_SCRIPTS },
          base: { auth: { type: 'inherit' }, description: '', scripts: EMPTY_SCRIPTS },
          section: 'auth',
        },
        incoming.value,
      );
    case 'example': {
      const example = incoming.value as ExampleFile;
      return { ...common, kind, requestId: '', draft: example, base: example };
    }
  }
}

export const useTabs = create<TabsState>()((set, get) => ({
  tabs: [],
  activeId: null,
  workspaceRoot: null,

  openItem(kind, itemId, snapshot) {
    const existing = get().tabs.find((t) => t.kind === kind && t.itemId === itemId);
    if (existing) {
      set({ activeId: existing.id });
      return;
    }
    const probe = { kind, itemId } as Tab;
    const incoming = readIncoming(probe, snapshot);
    if (incoming === NOT_FOUND) return;
    const tab = createTab(kind, itemId, incoming);
    if (tab.kind === 'request' && kind === 'request') {
      const node = findNode(snapshot, itemId);
      if (node?.kind === 'request') tab.parentId = node.parentId;
    }
    if (tab.kind === 'example') tab.requestId = findExample(snapshot, itemId)?.request.id ?? '';
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },

  openGlobals(snapshot) {
    const existing = get().tabs.find((t) => t.kind === 'globals');
    if (existing) {
      set({ activeId: existing.id });
      return;
    }
    const tab = createTab('globals', null, { title: 'Variáveis globais', value: snapshot.globals });
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },

  openLoadTest(source) {
    const tab: LoadTestTab = {
      id: tabId(),
      kind: 'loadtest',
      title: `Carga · ${source.title}`,
      itemId: null,
      conflict: null,
      requestId: source.itemId,
      parentId: source.parentId,
      data: structuredClone(source.draft),
      config: { mode: 'count', total: 100, durationSec: 30, concurrency: 10 },
      runId: null,
      status: 'idle',
      stats: null,
      result: null,
      error: null,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },

  openTunnel(id, title) {
    const existing = get().tabs.find((t) => t.kind === 'tunnel' && t.itemId === id);
    if (existing) {
      set({ activeId: existing.id });
      return;
    }
    const tab: TunnelTab = { id: tabId(), kind: 'tunnel', title, itemId: id, conflict: null };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },

  openDatabase(id, title) {
    const existing = get().tabs.find((t) => t.kind === 'database' && t.itemId === id);
    if (existing) {
      set({ activeId: existing.id });
      return;
    }
    const tab: DatabaseTab = { id: tabId(), kind: 'database', title, itemId: id, conflict: null };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },

  openNewRequest(options = {}) {
    const data = newRequestData(options.data);
    const tab: RequestTab = {
      id: tabId(),
      kind: 'request',
      itemId: null,
      parentId: options.parentId ?? null,
      title: options.title ?? 'Nova requisição',
      conflict: null,
      draft: data,
      base: null,
      run: options.run ?? null,
      section: 'params',
      responseSection: 'body',
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
    return tab.id;
  },

  close(id) {
    set((s) => {
      const index = s.tabs.findIndex((t) => t.id === id);
      if (index === -1) return s;
      const tabs = s.tabs.filter((t) => t.id !== id);
      if (s.activeId !== id) return { tabs };
      const next = tabs[index] ?? tabs[index - 1] ?? null;
      return { tabs, activeId: next?.id ?? null };
    });
  },

  closeOthers(id) {
    set((s) => ({ tabs: s.tabs.filter((t) => t.id === id), activeId: id }));
  },

  togglePin(id) {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab) return s;
      const { pinned, ...rest } = tab;
      const toggled = (pinned ? rest : { ...rest, pinned: true }) as Tab;
      const others = s.tabs.filter((t) => t.id !== id);
      // Fixar leva para o fim do grupo fixado; desafixar, para o início das outras.
      const at = others.filter((t) => t.pinned).length;
      return { tabs: [...others.slice(0, at), toggled, ...others.slice(at)] };
    });
  },

  setActive(id) {
    set({ activeId: id });
  },

  activateRelative(delta) {
    const { tabs, activeId } = get();
    if (tabs.length === 0) return;
    const index = Math.max(
      0,
      tabs.findIndex((t) => t.id === activeId),
    );
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) set({ activeId: next.id });
  },

  move(id, toIndex) {
    set((s) => {
      const from = s.tabs.findIndex((t) => t.id === id);
      if (from === -1) return s;
      const tabs = [...s.tabs];
      const [tab] = tabs.splice(from, 1);
      if (!tab) return s;
      // Arrastar não cruza a fronteira entre fixadas e não fixadas.
      const pinnedCount = tabs.filter((t) => t.pinned).length;
      const index = tab.pinned
        ? Math.min(toIndex, pinnedCount)
        : Math.max(pinnedCount, Math.min(toIndex, tabs.length));
      tabs.splice(index, 0, tab);
      return { tabs };
    });
  },

  update(id, change) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? change(t as never) : t)) }));
  },

  markSaved(id, patch = {}, savedData) {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== id) return t;
        const saved = { ...t, ...patch, conflict: null } as Tab;
        switch (saved.kind) {
          case 'request':
            return { ...saved, base: structuredClone(savedData ?? saved.draft) };
          default:
            return saved; // bases de variáveis/coleção chegam pelo snapshot
        }
      }),
    }));
  },

  resolveConflict(id, choice) {
    set((s) => ({
      tabs: s.tabs.flatMap((t) => {
        if (t.id !== id || !t.conflict) return [t];
        if (t.conflict.type === 'deleted') {
          // "Recarregar" uma aba excluída = fechá-la; "manter" = vira requisição nova.
          if (choice === 'reload') return [];
          if (t.kind === 'request') return [{ ...t, itemId: null, base: null, conflict: null }];
          return [];
        }
        return [
          choice === 'reload' ? withIncoming(t, t.conflict.incoming) : keepMine(t, t.conflict.incoming),
        ];
      }),
    }));
    const { tabs, activeId } = get();
    if (!tabs.some((t) => t.id === activeId)) set({ activeId: tabs.at(-1)?.id ?? null });
  },

  reconcile(snapshot) {
    set((s) => {
      const tabs: Tab[] = [];
      for (const tab of s.tabs) {
        if (
          (tab.kind === 'request' && tab.itemId === null) ||
          tab.kind === 'loadtest' ||
          tab.kind === 'tunnel' ||
          tab.kind === 'database'
        ) {
          tabs.push(tab);
          continue;
        }
        const incoming = readIncoming(tab, snapshot);
        if (incoming === NOT_FOUND) {
          // Excluído por fora: sem alterações, fecha; com alterações, avisa.
          if (isDirty(tab))
            tabs.push(tab.conflict?.type === 'deleted' ? tab : { ...tab, conflict: { type: 'deleted' } });
          continue;
        }
        const titled = { ...tab, title: incoming.title } as Tab;
        if (deepEqual(incoming.value, tab.base)) {
          tabs.push(titled);
        } else if (!isDirty(tab) || draftMatches(tab, incoming.value)) {
          tabs.push(withIncoming(titled, incoming.value));
        } else if (tab.conflict?.type === 'changed' && deepEqual(tab.conflict.incoming, incoming.value)) {
          tabs.push(titled);
        } else {
          tabs.push({
            ...titled,
            conflict: {
              type: 'changed',
              incoming: incoming.value,
              changes: describeChanges(tab, incoming.value),
            },
          } as Tab);
        }
      }
      const activeId = tabs.some((t) => t.id === s.activeId) ? s.activeId : (tabs.at(-1)?.id ?? null);
      return { tabs, activeId };
    });
  },

  loadForWorkspace(root, snapshot) {
    const persisted = loadPersisted(root);
    set({ workspaceRoot: root, tabs: persisted.tabs, activeId: persisted.activeId });
    get().reconcile(snapshot);
  },
}));

// ---------------------------------------------------------------------------
// Persistência das abas (por workspace, no localStorage)

const STORAGE_PREFIX = 'rota:tabs:';

interface PersistedTabs {
  tabs: Tab[];
  activeId: string | null;
}

function loadPersisted(root: string): PersistedTabs {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + root);
    if (!raw) return { tabs: [], activeId: null };
    const parsed = JSON.parse(raw) as PersistedTabs;
    return {
      tabs: parsed.tabs.map((t) => ({ ...t, ...(t.kind === 'request' ? { run: null } : {}) })),
      activeId: parsed.activeId,
    };
  } catch {
    return { tabs: [], activeId: null };
  }
}

/**
 * Versão da aba que pode ir para o localStorage (texto puro no disco): sem
 * respostas e sem valores secretos revelados ou digitados. Um segredo digitado
 * e não salvo é perdido ao reiniciar — preferível a deixá-lo exposto.
 */
export function forStorage(tab: Tab): Tab {
  switch (tab.kind) {
    case 'request':
      return { ...tab, run: null };
    case 'loadtest':
      return { ...tab, stats: null, result: null, runId: null, status: 'idle' };
    case 'environment':
    case 'globals':
      return { ...tab, draft: tab.draft.map(withoutSecretValue) };
    case 'collection':
      return { ...tab, draft: { ...tab.draft, variables: tab.draft.variables.map(withoutSecretValue) } };
    default:
      return tab;
  }
}

function withoutSecretValue(draft: VariableDraft): VariableDraft {
  return draft.type === 'secret' ? { ...draft, value: undefined, secretDirty: false } : draft;
}

let saveTimer: number | undefined;
useTabs.subscribe((state) => {
  if (!state.workspaceRoot) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      // Respostas não são persistidas (podem ser grandes e conter dados sensíveis).
      const tabs = state.tabs.filter((t) => t.kind !== 'loadtest' || t.status !== 'running').map(forStorage);
      localStorage.setItem(
        STORAGE_PREFIX + state.workspaceRoot,
        JSON.stringify({ tabs, activeId: state.activeId }),
      );
    } catch {
      // localStorage cheio/indisponível: as abas só não sobrevivem ao reinício.
    }
  }, 300);
});

export function useActiveTab(): Tab | undefined {
  return useTabs((s) => s.tabs.find((t) => t.id === s.activeId));
}
