import { ancestorsOf, findNode, type TreeNode } from '@rota/core/shared';
import { create } from 'zustand';
import type { WorkspaceCommand } from '../../../../shared/ipc';
import { api, errorMessage, runCommand } from '../../lib/api';
import { confirmDialog, promptDialog } from '../../state/dialogs';
import { useTabs } from '../../state/tabs';
import { toast } from '../../state/toasts';
import { useUiStore } from '../../state/ui';
import { offerUndo } from '../../state/undo';
import { useWorkspace } from '../../state/workspace';

/** Item em renomeação inline na sidebar. */
export const useRenaming = create<{ id: string | null; set(id: string | null): void }>()((set) => ({
  id: null,
  set: (id) => set({ id }),
}));

function snapshot() {
  return useWorkspace.getState().state?.snapshot;
}

const notEmpty = (value: string) => (value.trim() === '' ? 'Informe um nome.' : null);

export async function newCollection(): Promise<void> {
  const name = await promptDialog({
    title: 'Nova coleção',
    label: 'Nome',
    placeholder: 'Ex.: API de Pedidos',
    validate: notEmpty,
  });
  if (!name) return;
  const result = await runCommand({ type: 'createCollection', name });
  if (result?.id) useUiStore.getState().setExpanded(result.id, true);
}

export async function newFolder(parentId: string): Promise<void> {
  const name = await promptDialog({
    title: 'Nova pasta',
    label: 'Nome',
    placeholder: 'Ex.: Autenticação',
    validate: notEmpty,
  });
  if (!name) return;
  const result = await runCommand({ type: 'createFolder', parentId, name });
  if (result?.id) useUiStore.getState().expandMany([parentId, result.id]);
}

export async function newRequest(parentId: string): Promise<void> {
  const name = await promptDialog({
    title: 'Nova requisição',
    label: 'Nome',
    placeholder: 'Ex.: Listar pedidos',
    validate: notEmpty,
  });
  if (!name) return;
  const result = await runCommand({ type: 'createRequest', parentId, name });
  const snap = snapshot();
  if (result?.id && snap) {
    useUiStore.getState().setExpanded(parentId, true);
    useTabs.getState().openItem('request', result.id, snap);
  }
}

/**
 * Item alvo dos atalhos Ctrl+E / Ctrl+D: o item focado na sidebar ou, se o
 * foco estiver em outro lugar, o item da aba ativa.
 */
export function selectedItemId(): string | null {
  const focused = document.activeElement?.closest<HTMLElement>('[data-item-id]');
  if (focused?.dataset.itemId) return focused.dataset.itemId;
  const tabs = useTabs.getState();
  const tab = tabs.tabs.find((t) => t.id === tabs.activeId);
  if (!tab?.itemId) return null;
  return ['request', 'collection', 'folder', 'environment'].includes(tab.kind) ? tab.itemId : null;
}

/** Renomeia o item selecionado: inline na árvore (revelando-o) ou, para ambientes, num diálogo. */
export function renameSelected(): void {
  const id = selectedItemId();
  const snap = snapshot();
  if (!id || !snap) return;
  const env = snap.environments.find((e) => e.id === id);
  if (env) {
    void renameEnvironment(id, env.name);
    return;
  }
  if (!findNode(snap, id)) return;
  const ui = useUiStore.getState();
  ui.showSection('collections');
  ui.expandMany(ancestorsOf(snap, id).map((a) => a.id));
  // Espera a árvore renderizar o item revelado antes de abrir o campo.
  requestAnimationFrame(() => useRenaming.getState().set(id));
}

export function duplicateSelected(): void {
  const id = selectedItemId();
  if (id) void duplicateItem(id);
}

export async function duplicateItem(id: string): Promise<void> {
  const result = await runCommand({ type: 'duplicate', id });
  const copyId = result?.id;
  if (copyId) offerUndo('Item duplicado.', () => command({ type: 'remove', id: copyId }));
}

/** Comando sem o toast de erro do runCommand (o desfazer mostra o próprio erro). */
function command(cmd: WorkspaceCommand) {
  return api.invoke('workspace:command', cmd);
}

/** Exclui (vai para a lixeira) e oferece desfazer. */
export async function removeItem(id: string, name: string): Promise<void> {
  const result = await runCommand({ type: 'remove', id });
  const trashId = result?.id;
  if (trashId) offerUndo(`"${name}" foi para a lixeira.`, () => api.invoke('trash:restore', trashId));
}

export async function renameItem(id: string, previous: string, name: string): Promise<void> {
  if (!name || name === previous) return;
  const result = await runCommand({ type: 'rename', id, name });
  if (result) offerUndo(`Renomeado para "${name}".`, () => command({ type: 'rename', id, name: previous }));
}

/** Move um item na árvore lembrando a posição anterior (para desfazer). */
export async function moveItem(id: string, parentId: string, index?: number): Promise<void> {
  const snap = snapshot();
  const origin = snap ? positionOf(snap.collections, id) : undefined;
  const result = await runCommand({ type: 'move', id, parentId, ...(index !== undefined ? { index } : {}) });
  if (result && origin)
    offerUndo('Item movido.', () =>
      command({ type: 'move', id, parentId: origin.parentId, index: origin.index }),
    );
}

export async function reorderCollections(order: string[]): Promise<void> {
  const previous = snapshot()?.collections.map((c) => c.id);
  const result = await runCommand({ type: 'reorderCollections', order });
  if (result && previous)
    offerUndo('Ordem das coleções alterada.', () => command({ type: 'reorderCollections', order: previous }));
}

function positionOf(nodes: readonly TreeNode[], id: string): { parentId: string; index: number } | undefined {
  for (const node of nodes) {
    if (node.kind === 'request') continue;
    const index = node.children.findIndex((c) => c.id === id);
    if (index >= 0) return { parentId: node.id, index };
    const inner = positionOf(node.children, id);
    if (inner) return inner;
  }
  return undefined;
}

export async function deleteItem(
  node: Pick<TreeNode, 'id' | 'name' | 'kind'> | { id: string; name: string; kind: 'environment' },
) {
  const what = {
    collection: 'a coleção',
    folder: 'a pasta',
    request: 'a requisição',
    environment: 'o ambiente',
  }[node.kind];
  // Uma requisição sozinha vai direto (dá para desfazer); o que agrupa outros itens pede confirmação.
  if (node.kind === 'request') {
    await removeItem(node.id, node.name);
    return;
  }
  const extra =
    node.kind === 'collection' || node.kind === 'folder' ? ' Tudo o que estiver dentro vai junto.' : '';
  const choice = await confirmDialog({
    title: `Excluir ${what} "${node.name}"?`,
    description: `O item vai para a lixeira e pode ser restaurado depois.${extra}`,
    confirmLabel: 'Excluir',
    danger: true,
  });
  if (choice !== 'confirm') return;
  await removeItem(node.id, node.name);
}

export async function renameEnvironment(id: string, current: string): Promise<void> {
  const name = await promptDialog({
    title: 'Renomear ambiente',
    label: 'Nome',
    initialValue: current,
    validate: notEmpty,
  });
  if (name) await renameItem(id, current, name);
}

export async function newEnvironment(): Promise<void> {
  const name = await promptDialog({
    title: 'Novo ambiente',
    label: 'Nome',
    placeholder: 'Ex.: Homologação',
    validate: notEmpty,
  });
  if (!name) return;
  const result = await runCommand({ type: 'createEnvironment', name });
  const snap = snapshot();
  if (result?.id && snap) useTabs.getState().openItem('environment', result.id, snap);
}

/** Exporta e avisa onde o arquivo ficou. Valores secretos nunca vão para o arquivo. */
export async function exportCollection(id: string, format: 'postman' | 'markdown'): Promise<void> {
  try {
    const path = await api.invoke('export:collection', id, format);
    if (path)
      toast.success(`Exportado para ${path}${format === 'postman' ? ' (sem valores secretos)' : ''}.`);
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

export async function exportVariables(id: string | null): Promise<void> {
  try {
    const path = await api.invoke('export:variables', id);
    if (path) toast.success(`Exportado para ${path} (sem valores secretos).`);
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

export function revealInExplorer(id?: string): void {
  void api.invoke('workspace:revealInExplorer', id);
}

/** Abre a aba de configurações de uma coleção/pasta. */
export function openContainerSettings(id: string): void {
  const snap = snapshot();
  const node = snap ? findNode(snap, id) : undefined;
  if (snap && node && node.kind !== 'request') useTabs.getState().openItem(node.kind, id, snap);
}
