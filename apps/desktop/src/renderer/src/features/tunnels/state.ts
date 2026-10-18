import { normalizeTarget, type TunnelConfig, type TunnelView } from '@rota/core/shared';
import { create } from 'zustand';
import type { CloudflaredInfo } from '../../../../shared/ipc';
import { api, errorMessage } from '../../lib/api';
import { promptDialog } from '../../state/dialogs';
import { useTabs } from '../../state/tabs';
import { toast } from '../../state/toasts';
import { useUiStore } from '../../state/ui';
import { closeTabsWithout } from '../databases/state';

interface TunnelState {
  views: TunnelView[];
  /** A lista inicial já chegou do processo principal. */
  loaded: boolean;
  binary: CloudflaredInfo | null;
  /** Download do cloudflared em andamento. */
  download: { received: number; total: number | null } | null;
  /** Guia "como usar" aberto. */
  guideOpen: boolean;
  setGuideOpen(open: boolean): void;
  /** Chamada selecionada em cada túnel (ausente = a mais recente). */
  selected: Record<string, string>;
  /** Simulador de webhook aberto, opcionalmente com corpo e caminho de uma chamada recebida. */
  simulator: SimulatorRequest | null;
}

export interface SimulatorRequest {
  tunnelId: string;
  body?: string;
  path?: string;
  eventId?: string;
}

export const useTunnels = create<TunnelState>()((set) => ({
  views: [],
  loaded: false,
  binary: null,
  download: null,
  guideOpen: false,
  setGuideOpen: (guideOpen) => set({ guideOpen }),
  selected: {},
  simulator: null,
}));

export function selectExchange(tunnelId: string, exchangeId: string): void {
  useTunnels.setState((s) => ({ selected: { ...s.selected, [tunnelId]: exchangeId } }));
}

export function openSimulator(request: SimulatorRequest): void {
  useTunnels.setState({ simulator: request });
}

export function closeSimulator(): void {
  useTunnels.setState({ simulator: null });
}

let subscribed = false;

/** Carrega o estado inicial e assina as mudanças vindas do processo principal. */
export function subscribeTunnelEvents(): void {
  if (subscribed) return;
  subscribed = true;
  api.on('tunnel:changed', (views) => {
    warnDropped(useTunnels.getState().views, views);
    useTunnels.setState({ views, loaded: true });
    closeTabsWithout('tunnel', new Set(views.map((v) => v.config.id)));
  });
  api.on('tunnel:download', (download) => useTunnels.setState({ download }));
  void api.invoke('tunnel:list').then((views) => useTunnels.setState({ views, loaded: true }));
  void api.invoke('tunnel:binary').then((binary) => useTunnels.setState({ binary }));
}

/** O túnel caiu sozinho (rede, Cloudflare): avisa mesmo se a tela dele estiver fechada. */
function warnDropped(before: TunnelView[], after: TunnelView[]): void {
  for (const view of after) {
    const previous = before.find((v) => v.config.id === view.config.id);
    if (previous?.status === 'running' && view.status === 'error')
      toast.error(`Túnel "${view.config.name}": ${view.error ?? 'caiu.'}`);
  }
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
    validate: (v) =>
      v.trim() === ''
        ? 'Informe a porta da sua API.'
        : normalizeTarget(v)
          ? null
          : 'Use uma porta (3000) ou um endereço (http://localhost:8080).',
  });
  if (!port) return;
  const id = await guarded(() => api.invoke('tunnel:create', { target: port }));
  if (!id) return;
  useUiStore.getState().showSection('tunnels');
  // O evento com a lista nova chega logo depois; o título é ajustado pela aba.
  useTabs.getState().openTunnel(id, 'Túnel');
}

/** false = recusado (o erro já apareceu num aviso); a tela volta ao valor salvo. */
export async function updateTunnel(id: string, patch: Partial<Omit<TunnelConfig, 'id'>>): Promise<boolean> {
  return (await guarded(() => api.invoke('tunnel:update', id, patch).then(() => true))) ?? false;
}

export async function startTunnel(id: string): Promise<void> {
  const state = useTunnels.getState();
  if (!state.binary?.installed) {
    // Abre a aba para o progresso do download ficar visível.
    openTunnel(id);
    const info = await installCloudflared();
    if (!info?.installed) return;
  }
  const ok = await guarded(() => api.invoke('tunnel:start', id));
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

export async function setWebhookSecret(id: string, value: string | null): Promise<boolean> {
  return (await guarded(() => api.invoke('tunnel:setWebhookSecret', id, value).then(() => true))) ?? false;
}

/** Envia o webhook simulado e seleciona a chamada na lista. */
export async function simulateWebhook(
  id: string,
  input: { body: string; path: string; eventId?: string },
): Promise<boolean> {
  const result = await guarded(() => api.invoke('tunnel:simulate', id, input));
  if (!result) return false;
  selectExchange(id, result.id);
  if (result.error) toast.error(result.error);
  else toast.success(`Webhook simulado: a API respondeu ${result.status}.`);
  return true;
}
