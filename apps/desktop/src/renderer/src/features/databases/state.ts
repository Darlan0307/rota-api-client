import type {
  DbConnectionConfig,
  DbConnectionView,
  DbCredentialView,
  DbEngine,
  DbQueryResult,
  DbSchema,
} from '@rota/core/shared';
import { stripSqlLiterals } from '@rota/core/shared';
import { create } from 'zustand';
import { api, errorMessage } from '../../lib/api';
import { useTabs } from '../../state/tabs';
import { toast } from '../../state/toasts';
import { useUiStore } from '../../state/ui';
import { closeProfile } from './profile-state';

export type ConnectionInput = Partial<DbConnectionConfig>;

/** Um comando de uma execução em sequência. */
export interface QueryStep {
  sql: string;
  status: 'pending' | 'running' | 'ok' | 'error' | 'skipped';
  result?: DbQueryResult;
  error?: string;
}

/** Consulta de uma aba: o texto sobrevive ao fechar o app (localStorage); o resultado não. */
export interface QueryState {
  sql: string;
  /** Resultado exibido (o do comando escolhido, numa sequência). */
  result: DbQueryResult | null;
  error: string | null;
  /** Comando executado (para o título do resultado). */
  ranSql: string | null;
  /** Vários comandos executados em sequência (null quando foi um só). */
  steps: QueryStep[] | null;
  stepIndex: number;
}

interface DatabaseStore {
  connections: DbConnectionView[];
  credentials: DbCredentialView[];
  loaded: boolean;
  schemas: Record<string, DbSchema | undefined>;
  schemaErrors: Record<string, string | undefined>;
  queries: Record<string, QueryState | undefined>;
  /** Janela de conexão aberta: null = nova; string = editar. */
  editing: { id: string | null } | null;
  credentialsOpen: boolean;
  /** Guia de conexão aberto, no tipo de banco mostrado. */
  guideEngine: DbEngine | null;
}

export const useDatabases = create<DatabaseStore>()(() => ({
  connections: [],
  credentials: [],
  loaded: false,
  schemas: {},
  schemaErrors: {},
  queries: {},
  editing: null,
  credentialsOpen: false,
  guideEngine: null,
}));

let subscribed = false;

export function subscribeDatabaseEvents(): void {
  if (subscribed) return;
  subscribed = true;
  api.on('db:changed', (state) => {
    useDatabases.setState({ ...state, loaded: true });
    closeTabsWithout('database', new Set(state.connections.map((c) => c.config.id)));
  });
  void api.invoke('db:state').then((state) => useDatabases.setState({ ...state, loaded: true }));
  // Fechou a aba da conexão: desconecta (não deixa sessão aberta, principalmente em produção).
  useTabs.subscribe((state, previous) => {
    const open = new Set(state.tabs.filter((t) => t.kind === 'database').map((t) => t.itemId));
    for (const tab of previous.tabs)
      if (tab.kind === 'database' && tab.itemId && !open.has(tab.itemId)) {
        closeProfile(tab.itemId);
        void api.invoke('db:disconnect', tab.itemId).catch(() => undefined);
      }
  });
}

export function useConnection(id: string | null): DbConnectionView | undefined {
  return useDatabases((s) => s.connections.find((c) => c.config.id === id));
}

async function guarded<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    toast.error(errorMessage(error));
    return undefined;
  }
}

export function openConnection(id: string): void {
  const view = useDatabases.getState().connections.find((c) => c.config.id === id);
  useTabs.getState().openDatabase(id, view?.config.name ?? 'Banco');
}

export function openConnectionDialog(id: string | null = null): void {
  useDatabases.setState({ editing: { id } });
}

export function closeConnectionDialog(): void {
  useDatabases.setState({ editing: null });
}

export function setCredentialsOpen(credentialsOpen: boolean): void {
  useDatabases.setState({ credentialsOpen });
}

export async function saveConnection(
  input: ConnectionInput,
  password?: string | null,
): Promise<string | undefined> {
  const id = await guarded(() => api.invoke('db:saveConnection', input, password));
  // Servidor, banco ou senha podem ter mudado: a árvore e o erro antigos não valem mais.
  if (id && input.id)
    useDatabases.setState((s) => ({
      schemas: { ...s.schemas, [id]: undefined },
      schemaErrors: { ...s.schemaErrors, [id]: undefined },
    }));
  return id;
}

/** Fecha abas de itens que deixaram de existir (excluídos por outra tela, pelo MCP...). */
export function closeTabsWithout(kind: 'database' | 'tunnel', existing: Set<string>): void {
  const tabs = useTabs.getState();
  for (const tab of tabs.tabs)
    if (tab.kind === kind && tab.itemId && !existing.has(tab.itemId)) tabs.close(tab.id);
}

export async function duplicateConnection(id: string): Promise<void> {
  const copy = await guarded(() => api.invoke('db:duplicateConnection', id));
  if (copy) openConnectionDialog(copy);
}

export async function removeConnection(id: string): Promise<void> {
  await guarded(() => api.invoke('db:removeConnection', id));
  const tabs = useTabs.getState();
  const tab = tabs.tabs.find((t) => t.kind === 'database' && t.itemId === id);
  if (tab) tabs.close(tab.id);
}

export async function disconnect(id: string): Promise<void> {
  await guarded(() => api.invoke('db:disconnect', id));
}

/** Carrega (ou recarrega) a estrutura do banco; conecta se preciso. */
export async function loadSchema(id: string): Promise<void> {
  try {
    const schema = await api.invoke('db:schema', id);
    useDatabases.setState((s) => ({
      schemas: { ...s.schemas, [id]: schema },
      schemaErrors: { ...s.schemaErrors, [id]: undefined },
    }));
  } catch (error) {
    useDatabases.setState((s) => ({ schemaErrors: { ...s.schemaErrors, [id]: errorMessage(error) } }));
  }
}

const SQL_KEY = (id: string) => `rota:db-sql:${id}`;

export function queryOf(id: string): QueryState {
  const current = useDatabases.getState().queries[id];
  if (current) return current;
  let sql = '';
  try {
    sql = localStorage.getItem(SQL_KEY(id)) ?? '';
  } catch {
    // Sem localStorage: começa vazio.
  }
  return { sql, result: null, error: null, ranSql: null, steps: null, stepIndex: 0 };
}

export function updateQuery(id: string, patch: Partial<QueryState>): void {
  useDatabases.setState((s) => ({ queries: { ...s.queries, [id]: { ...queryOf(id), ...patch } } }));
  if (patch.sql !== undefined) {
    try {
      localStorage.setItem(SQL_KEY(id), patch.sql);
    } catch {
      // Sem localStorage: o texto só não sobrevive ao reinício.
    }
  }
}

const changesStructure = (sql: string, result: DbQueryResult) =>
  result.affected !== undefined &&
  /^\s*(create|alter|drop|recreate)\b/i.test(stripSqlLiterals(sql).trimStart());

export async function runQuery(id: string, sql: string, limit: number): Promise<void> {
  updateQuery(id, { error: null, steps: null, stepIndex: 0 });
  try {
    const result = await api.invoke('db:run', id, sql, limit);
    updateQuery(id, { result, ranSql: sql, error: null });
    // Comando que altera a estrutura: a árvore pode ter mudado.
    if (changesStructure(sql, result)) void loadSchema(id);
  } catch (error) {
    updateQuery(id, { error: errorMessage(error), ranSql: sql });
  }
}

/**
 * Executa os comandos um por um, na ordem, e para no primeiro erro (os
 * seguintes ficam como "não executado"). Cada comando é uma chamada própria:
 * nenhum driver aceita vários num envio só (o SQL Server até aceita, mas
 * junta os resultados numa grade).
 */
/** Sequências em andamento por conexão (Cancelar entre um comando e outro também precisa parar). */
const sequences = new Map<string, { cancelled: boolean }>();

/** Uma sequência está rodando? (entre dois comandos a conexão fica livre por um instante). */
export function sequenceRunning(state: QueryState | undefined): boolean {
  return state?.steps?.some((s) => s.status === 'running' || s.status === 'pending') ?? false;
}

export async function runQueries(id: string, statements: string[], limit: number): Promise<void> {
  if (sequences.has(id)) return;
  const control = { cancelled: false };
  sequences.set(id, control);
  try {
    await runSequence(id, statements, limit, control);
  } finally {
    sequences.delete(id);
    // Erro inesperado no meio: nada pode ficar "executando" para sempre (travaria o botão Executar).
    const steps = queryOf(id).steps;
    if (sequenceRunning(queryOf(id)) && steps)
      updateQuery(id, {
        steps: steps.map((s) =>
          s.status === 'running' || s.status === 'pending' ? { ...s, status: 'skipped' } : s,
        ),
      });
  }
}

async function runSequence(
  id: string,
  statements: string[],
  limit: number,
  control: { cancelled: boolean },
): Promise<void> {
  const steps: QueryStep[] = statements.map((sql) => ({ sql, status: 'pending' }));
  const publish = (stepIndex: number) =>
    updateQuery(id, { steps: [...steps], stepIndex, ...stepView(steps[stepIndex]) });
  let structure = false;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as QueryStep;
    if (control.cancelled) {
      for (let j = i; j < steps.length; j++) steps[j] = { ...(steps[j] as QueryStep), status: 'skipped' };
      break;
    }
    steps[i] = { ...step, status: 'running' };
    publish(i);
    try {
      const result = await api.invoke('db:run', id, step.sql, limit);
      steps[i] = { ...step, status: 'ok', result };
      structure ||= changesStructure(step.sql, result);
    } catch (error) {
      steps[i] = { ...step, status: 'error', error: errorMessage(error) };
      for (let j = i + 1; j < steps.length; j++) steps[j] = { ...(steps[j] as QueryStep), status: 'skipped' };
      break;
    }
  }
  if (structure) void loadSchema(id);
  // Mostra o erro, se houve; senão o último comando que trouxe linhas (o SELECT de conferência no fim).
  const failed = steps.findIndex((s) => s.status === 'error');
  const lastRows = steps.findLastIndex((s) => s.result && s.result.affected === undefined);
  const lastDone = steps.findLastIndex((s) => s.status === 'ok');
  publish(failed >= 0 ? failed : lastRows >= 0 ? lastRows : Math.max(lastDone, 0));
}

/** Cancela a consulta da vez e, numa sequência, os comandos que ainda não rodaram. */
export async function cancelQueries(id: string): Promise<void> {
  const control = sequences.get(id);
  if (control) control.cancelled = true;
  await cancelQuery(id);
}

function stepView(step: QueryStep | undefined): Pick<QueryState, 'result' | 'error' | 'ranSql'> {
  return { result: step?.result ?? null, error: step?.error ?? null, ranSql: step?.sql ?? null };
}

/** Mostra o resultado de um dos comandos da sequência. */
export function showStep(id: string, index: number): void {
  const steps = queryOf(id).steps;
  if (!steps?.[index]) return;
  updateQuery(id, { stepIndex: index, ...stepView(steps[index]) });
}

export async function cancelQuery(id: string): Promise<void> {
  await guarded(() => api.invoke('db:cancel', id));
}

export function showDatabases(): void {
  useUiStore.getState().showSection('databases');
}
