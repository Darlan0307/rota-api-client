import type {
  DbConnectionConfig,
  DbConnectionView,
  DbCredentialView,
  DbQueryResult,
  DbSchema,
} from '@rota/core/shared';
import { create } from 'zustand';
import { api, errorMessage } from '../../lib/api';
import { useTabs } from '../../state/tabs';
import { toast } from '../../state/toasts';
import { useUiStore } from '../../state/ui';

export type ConnectionInput = Partial<DbConnectionConfig>;

/** Consulta de uma aba: o texto sobrevive ao fechar o app (localStorage); o resultado não. */
export interface QueryState {
  sql: string;
  result: DbQueryResult | null;
  error: string | null;
  /** Comando executado (para o título do resultado). */
  ranSql: string | null;
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
}));

let subscribed = false;

export function subscribeDatabaseEvents(): void {
  if (subscribed) return;
  subscribed = true;
  api.on('db:changed', (state) => useDatabases.setState({ ...state, loaded: true }));
  void api.invoke('db:state').then((state) => useDatabases.setState({ ...state, loaded: true }));
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
  return guarded(() => api.invoke('db:saveConnection', input, password));
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
  return { sql, result: null, error: null, ranSql: null };
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

export async function runQuery(id: string, sql: string, limit: number): Promise<void> {
  updateQuery(id, { error: null });
  try {
    const result = await api.invoke('db:run', id, sql, limit);
    updateQuery(id, { result, ranSql: sql, error: null });
    // Comando que altera a estrutura: a árvore pode ter mudado.
    if (result.affected !== undefined && /^\s*(create|alter|drop|recreate)\b/i.test(sql)) void loadSchema(id);
  } catch (error) {
    updateQuery(id, { error: errorMessage(error), ranSql: sql });
  }
}

export async function cancelQuery(id: string): Promise<void> {
  await guarded(() => api.invoke('db:cancel', id));
}

export function showDatabases(): void {
  useUiStore.getState().showSection('databases');
}
