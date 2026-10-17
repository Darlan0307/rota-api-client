import type { WorkspaceSnapshot } from '@rota/core/shared';
import { create } from 'zustand';
import type { WorkspaceState } from '../../../shared/ipc';
import { api } from '../lib/api';

interface WorkspaceStore {
  state: WorkspaceState | null;
  error: string | null;
  init(): Promise<void>;
}

let subscribed = false;

/** Espelho do workspace aberto no processo principal (somente leitura aqui). */
export const useWorkspace = create<WorkspaceStore>()((set) => ({
  state: null,
  error: null,
  async init() {
    if (!subscribed) {
      subscribed = true;
      api.on('workspace:changed', (state) => set({ state, error: null }));
    }
    try {
      set({ state: await api.invoke('workspace:get'), error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },
}));

const EMPTY: WorkspaceSnapshot = {
  root: '',
  id: '',
  name: '',
  globals: [],
  environments: [],
  collections: [],
  problems: [],
};

export function useSnapshot(): WorkspaceSnapshot {
  return useWorkspace((s) => s.state?.snapshot ?? EMPTY);
}

export function useActiveEnvironmentId(): string | null {
  return useWorkspace((s) => s.state?.activeEnvironmentId ?? null);
}
