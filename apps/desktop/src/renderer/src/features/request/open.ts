import { findNode } from '@rota/core/shared';
import { useTabs } from '../../state/tabs';
import { useWorkspace } from '../../state/workspace';

/** Abre qualquer item do workspace na aba adequada. */
export function openItemById(id: string): void {
  const snapshot = useWorkspace.getState().state?.snapshot;
  if (!snapshot) return;
  if (snapshot.environments.some((e) => e.id === id)) {
    useTabs.getState().openItem('environment', id, snapshot);
    return;
  }
  const node = findNode(snapshot, id);
  if (node) useTabs.getState().openItem(node.kind, id, snapshot);
}
