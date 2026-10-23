import {
  type DbEngine,
  type DbTable,
  ProfileCancelled,
  profileTable,
  type TableProfile,
} from '@rota/core/shared';
import { create } from 'zustand';
import { api, errorMessage } from '../../lib/api';

export interface ProfileState {
  table: string;
  status: 'running' | 'done' | 'error';
  done: number;
  steps: number;
  profile: TableProfile | null;
  error: string | null;
  /** Mostrando o perfil (em vez do resultado da consulta) na área de baixo. */
  visible: boolean;
  /** Identifica a execução: cancelar ou começar outra invalida a anterior. */
  runId: string;
}

export const useProfiles = create<{ byConnection: Record<string, ProfileState | undefined> }>()(() => ({
  byConnection: {},
}));

function patch(connectionId: string, runId: string | null, change: Partial<ProfileState>): void {
  useProfiles.setState((s) => {
    const current = s.byConnection[connectionId];
    if (!current || (runId && current.runId !== runId)) return s;
    return { byConnection: { ...s.byConnection, [connectionId]: { ...current, ...change } } };
  });
}

/** Analisa a tabela (somente leitura, fora do histórico de consultas). */
export async function runProfile(connectionId: string, engine: DbEngine, table: DbTable): Promise<void> {
  const runId = crypto.randomUUID();
  useProfiles.setState((s) => ({
    byConnection: {
      ...s.byConnection,
      [connectionId]: {
        table: table.name,
        status: 'running',
        done: 0,
        steps: 0,
        profile: null,
        error: null,
        visible: true,
        runId,
      },
    },
  }));
  const isCancelled = () => useProfiles.getState().byConnection[connectionId]?.runId !== runId;
  try {
    const profile = await profileTable(
      (sql, limit) => api.invoke('db:run', connectionId, sql, limit, { history: false }),
      engine,
      table,
      { onProgress: (done, steps) => patch(connectionId, runId, { done, steps }), isCancelled },
    );
    patch(connectionId, runId, { status: 'done', profile });
  } catch (error) {
    if (error instanceof ProfileCancelled || isCancelled()) return;
    patch(connectionId, runId, { status: 'error', error: errorMessage(error) });
  }
}

export function cancelProfile(connectionId: string): void {
  const current = useProfiles.getState().byConnection[connectionId];
  if (current?.status !== 'running') return;
  patch(connectionId, null, { status: 'error', error: 'Análise cancelada.', runId: crypto.randomUUID() });
  void api.invoke('db:cancel', connectionId).catch(() => undefined);
}

export function closeProfile(connectionId: string): void {
  cancelProfile(connectionId);
  useProfiles.setState((s) => {
    const { [connectionId]: _removed, ...rest } = s.byConnection;
    return { byConnection: rest };
  });
}

export function showProfile(connectionId: string, visible: boolean): void {
  patch(connectionId, null, { visible });
}
