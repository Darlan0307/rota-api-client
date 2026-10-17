import type { TunnelConfig, TunnelView } from '@rota/core/shared';
import { create } from 'zustand';
import type { CloudflaredInfo } from '../../../../shared/ipc';
import { api, errorMessage } from '../../lib/api';
import { promptDialog } from '../../state/dialogs';
import { useTabs } from '../../state/tabs';
import { toast } from '../../state/toasts';
import { useUiStore } from '../../state/ui';

interface TunnelState {
  views: TunnelView[];
  binary: CloudflaredInfo | null;
  /** Download do cloudflared em andamento. */
  download: { received: number; total: number | null } | null;
  /** Guia "como usar" aberto. */
  guideOpen: boolean;
  setGuideOpen(open: boolean): void;
}

export const useTunnels = create<TunnelState>()((set) => ({
  views: [],
  binary: null,
  download: null,
  guideOpen: false,
  setGuideOpen: (guideOpen) => set({ guideOpen }),
}));

let subscribed = false;

/** Carrega o estado inicial e assina as mudanças vindas do processo principal. */
export function subscribeTunnelEvents(): void {
  if (subscribed) return;
  subscribed = true;
  api.on('tunnel:changed', (views) => useTunnels.setState({ views }));
  api.on('tunnel:download', (download) => useTunnels.setState({ download }));
  void api.invoke('tunnel:list').then((views) => useTunnels.setState({ views }));
  void api.invoke('tunnel:binary').then((binary) => useTunnels.setState({ binary }));
}

export function useTunnel(id: string | null): TunnelView | undefined {
  return useTunnels((s) => s.views.find((v) => v.config.id === id));
}

async function guarded<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    toast.error(errorMessage(error));
    return undefined;
  }
}

export function openTunnel(id: string): void {
  const view = useTunnels.getState().views.find((v) => v.config.id === id);
  useTabs.getState().openTunnel(id, view?.config.name ?? 'Túnel');
}

export async function newTunnel(): Promise<void> {
  const port = await promptDialog({
    title: 'Novo túnel',
    label: 'Porta ou endereço da sua API local',
    placeholder: 'Ex.: 3000 ou http://localhost:8080',
    initialValue: '3000',
    validate: (v) => (v.trim() === '' ? 'Informe a porta da sua API.' : null),
  });
  if (!port) return;
  const id = await guarded(() => api.invoke('tunnel:create', { target: port }));
  if (!id) return;
  useUiStore.getState().showSection('tunnels');
  // O evento com a lista nova chega logo depois; o título é ajustado pela aba.
  useTabs.getState().openTunnel(id, 'Túnel');
}

export async function updateTunnel(id: string, patch: Partial<Omit<TunnelConfig, 'id'>>): Promise<void> {
  await guarded(() => api.invoke('tunnel:update', id, patch));
}

export async function startTunnel(id: string): Promise<void> {
  const state = useTunnels.getState();
  if (!state.binary?.installed) {
    const info = await installCloudflared();
    if (!info?.installed) return;
  }
  const ok = await guarded(() => api.invoke('tunnel:start', id).then(() => true));
  if (ok) toast.success('Túnel ligado. Copie a URL pública e cole no serviço.');
}

export async function stopTunnel(id: string): Promise<void> {
  await guarded(() => api.invoke('tunnel:stop', id));
}

export async function removeTunnel(id: string): Promise<void> {
  await guarded(() => api.invoke('tunnel:remove', id));
  const tabs = useTabs.getState();
  const tab = tabs.tabs.find((t) => t.kind === 'tunnel' && t.itemId === id);
  if (tab) tabs.close(tab.id);
}

export async function installCloudflared(): Promise<CloudflaredInfo | undefined> {
  useTunnels.setState({ download: { received: 0, total: null } });
  try {
    const binary = await api.invoke('tunnel:install');
    useTunnels.setState({ binary });
    toast.success('cloudflared baixado. Agora é só ligar o túnel.');
    return binary;
  } catch (error) {
    toast.error(errorMessage(error));
    return undefined;
  } finally {
    useTunnels.setState({ download: null });
  }
}

export async function testTunnel(id: string, path?: string): Promise<void> {
  const result = await guarded(() => api.invoke('tunnel:test', id, path));
  if (!result) return;
  if (result.status === 502)
    toast.error('A chamada passou pelo túnel, mas a sua API não respondeu (veja a lista de chamadas).');
  else toast.success(`Chegou! A URL pública respondeu ${result.status}.`);
}

export function replayExchange(id: string, exchangeId: string) {
  return guarded(() => api.invoke('tunnel:replay', id, exchangeId));
}

export async function clearExchanges(id: string): Promise<void> {
  await guarded(() => api.invoke('tunnel:clear', id));
}
