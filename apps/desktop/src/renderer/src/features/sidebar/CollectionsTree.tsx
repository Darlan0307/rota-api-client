import {
  type ChildNode,
  type CollectionNode,
  composeUrl,
  isContainer,
  type TreeNode,
  walkTree,
} from '@rota/core/shared';
import {
  Bookmark,
  BookText,
  ChevronRight,
  Copy,
  FileDown,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Library,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings2,
  Sparkles,
  SquareArrowOutUpRight,
  Trash2,
} from 'lucide-react';
import { type DragEvent, useMemo, useState } from 'react';
import { ContextActions, DropdownActions, type MenuEntry } from '../../components/ActionMenu';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { MethodBadge } from '../../components/MethodBadge';
import { cn } from '../../lib/cn';
import { statusTone } from '../../lib/format';
import { useTabs } from '../../state/tabs';
import { useUiStore } from '../../state/ui';
import { useSnapshot } from '../../state/workspace';
import { claudePrompts, copyPrompt } from '../claude/AskClaude';
import {
  deleteItem,
  duplicateItem,
  exportCollection,
  moveItem,
  newCollection,
  newFolder,
  newRequest,
  openContainerSettings,
  removeItem,
  renameItem,
  reorderCollections,
  revealInExplorer,
  useRenaming,
} from './item-actions';

type DropZone = 'before' | 'after' | 'inside';
interface DropTarget {
  id: string;
  zone: DropZone;
}

const DRAG_MIME = 'application/x-rota-item';

export function CollectionsTree({ filter }: { filter: string }) {
  const snapshot = useSnapshot();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const query = filter.trim().toLowerCase();
  const visible = useMemo(() => (query ? filterTree(snapshot.collections, query) : null), [snapshot, query]);

  if (snapshot.collections.length === 0) {
    return (
      <EmptyState
        compact
        icon={FolderTree}
        title="Nenhuma coleção ainda"
        description="Crie uma coleção ou importe uma exportação do Postman."
        action={
          <Button size="sm" onClick={() => void newCollection()}>
            <Plus className="size-3.5" /> Nova coleção
          </Button>
        }
      />
    );
  }

  if (visible && visible.size === 0) {
    return <p className="px-4 py-6 text-center text-xs text-fg-muted">Nada encontrado para "{filter}".</p>;
  }

  /** Converte a zona de soltura em (pai, índice) e executa o movimento. */
  async function drop(target: DropTarget) {
    const sourceId = dragId;
    setDragId(null);
    setDropTarget(null);
    if (!sourceId || sourceId === target.id) return;

    const parents = parentMap(snapshot.collections);
    const source = findIn(snapshot.collections, sourceId);
    const targetNode = findIn(snapshot.collections, target.id);
    if (!source || !targetNode) return;

    if (source.kind === 'collection') {
      if (targetNode.kind !== 'collection' || target.zone === 'inside') return;
      const order = snapshot.collections.map((c) => c.id).filter((id) => id !== sourceId);
      const index = order.indexOf(target.id) + (target.zone === 'after' ? 1 : 0);
      order.splice(index, 0, sourceId);
      await reorderCollections(order);
      return;
    }

    let parentId: string;
    let index: number | undefined;
    if (target.zone === 'inside' && isContainer(targetNode)) {
      parentId = targetNode.id;
      useUiStore.getState().setExpanded(parentId, true);
    } else {
      const parent = parents.get(target.id);
      if (!parent) return;
      parentId = parent.id;
      const siblings = parent.children.map((c) => c.id).filter((id) => id !== sourceId);
      index = siblings.indexOf(target.id) + (target.zone === 'after' ? 1 : 0);
    }
    if (
      source.kind === 'folder' &&
      (parentId === sourceId || isAncestor(snapshot.collections, sourceId, parentId))
    )
      return;
    await moveItem(sourceId, parentId, index);
  }

  const dnd: DndHandlers = {
    dragId,
    dropTarget,
    onDragStart: (id, e) => {
      setDragId(id);
      e.dataTransfer.setData(DRAG_MIME, id);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (node, e) => {
      if (!dragId || dragId === node.id) return;
      const dragged = findIn(snapshot.collections, dragId);
      if (!dragged) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const y = (e.clientY - rect.top) / rect.height;
      let zone: DropZone;
      if (dragged.kind === 'collection') {
        if (node.kind !== 'collection') return;
        zone = y < 0.5 ? 'before' : 'after';
      } else if (node.kind === 'collection') {
        zone = 'inside';
      } else if (node.kind === 'folder') {
        zone = y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
      } else {
        zone = y < 0.5 ? 'before' : 'after';
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dropTarget?.id !== node.id || dropTarget.zone !== zone) setDropTarget({ id: node.id, zone });
    },
    onDrop: (e) => {
      e.preventDefault();
      if (dropTarget) void drop(dropTarget);
    },
    onDragEnd: () => {
      setDragId(null);
      setDropTarget(null);
    },
  };

  return (
    <ul className="px-2" onDragLeave={(e) => e.currentTarget === e.target && setDropTarget(null)}>
      {snapshot.collections.map((node) =>
        !visible || visible.has(node.id) ? (
          <TreeRow key={node.id} node={node} depth={0} visible={visible} dnd={dnd} forceOpen={!!visible} />
        ) : null,
      )}
    </ul>
  );
}

interface DndHandlers {
  dragId: string | null;
  dropTarget: DropTarget | null;
  onDragStart(id: string, e: DragEvent): void;
  onDragOver(node: TreeNode, e: DragEvent<HTMLElement>): void;
  onDrop(e: DragEvent): void;
  onDragEnd(): void;
}

function TreeRow({
  node,
  depth,
  visible,
  dnd,
  forceOpen,
}: {
  node: TreeNode;
  depth: number;
  visible: Set<string> | null;
  dnd: DndHandlers;
  forceOpen: boolean;
}) {
  const expanded = useUiStore((s) => s.expanded[node.id] ?? false);
  const setExpanded = useUiStore((s) => s.setExpanded);
  const activeItemId = useTabs((s) => s.tabs.find((t) => t.id === s.activeId)?.itemId);
  const renaming = useRenaming((s) => s.id === node.id);
  const setRenaming = useRenaming((s) => s.set);
  const snapshot = useSnapshot();

  const container = isContainer(node);
  const open = container && (expanded || forceOpen);
  const selected = activeItemId === node.id;
  const drop = dnd.dropTarget?.id === node.id ? dnd.dropTarget.zone : null;

  function activate() {
    if (node.kind === 'request') useTabs.getState().openItem('request', node.id, snapshot);
    else setExpanded(node.id, !expanded);
  }

  const entries: MenuEntry[] = [
    ...(container
      ? ([
          { label: 'Nova requisição', icon: FilePlus2, onSelect: () => void newRequest(node.id) },
          { label: 'Nova pasta', icon: FolderPlus, onSelect: () => void newFolder(node.id) },
          { label: 'Configurações', icon: Settings2, onSelect: () => openContainerSettings(node.id) },
          'separator',
        ] satisfies MenuEntry[])
      : ([
          { label: 'Abrir', icon: SquareArrowOutUpRight, onSelect: activate },
          'separator',
        ] satisfies MenuEntry[])),
    { label: 'Renomear', icon: Pencil, onSelect: () => setRenaming(node.id), shortcut: 'Ctrl+E' },
    { label: 'Duplicar', icon: Copy, onSelect: () => void duplicateItem(node.id), shortcut: 'Ctrl+D' },
    { label: 'Mostrar no Explorer', icon: FolderOpen, onSelect: () => revealInExplorer(node.id) },
    ...(node.kind === 'collection'
      ? ([
          'separator',
          {
            label: 'Exportar para o Postman (v2.1)',
            icon: FileDown,
            onSelect: () => void exportCollection(node.id, 'postman'),
          },
          {
            label: 'Exportar documentação (Markdown)',
            icon: BookText,
            onSelect: () => void exportCollection(node.id, 'markdown'),
          },
          {
            label: 'Pedir ao Claude para documentar',
            icon: Sparkles,
            onSelect: () => void copyPrompt(claudePrompts.document(node.name, node.id)),
          },
        ] satisfies MenuEntry[])
      : []),
    'separator',
    { label: 'Excluir', icon: Trash2, onSelect: () => void deleteItem(node), danger: true, shortcut: 'Del' },
  ];

  const url = node.kind === 'request' ? composeUrl(node.data.url, node.data.query) : undefined;

  return (
    <li>
      <ContextActions entries={entries}>
        <div
          draggable={!renaming}
          onDragStart={(e) => dnd.onDragStart(node.id, e)}
          onDragOver={(e) => dnd.onDragOver(node, e)}
          onDrop={dnd.onDrop}
          onDragEnd={dnd.onDragEnd}
          onClick={() => !renaming && activate()}
          onDoubleClick={() => container && openContainerSettings(node.id)}
          onKeyDown={(e) => {
            if (renaming) return;
            if (e.key === 'Enter') activate();
            else if (e.key === 'F2') setRenaming(node.id);
            else if (e.key === 'Delete') void deleteItem(node);
            else if (e.key === 'ArrowRight' && container) setExpanded(node.id, true);
            else if (e.key === 'ArrowLeft' && container) setExpanded(node.id, false);
          }}
          tabIndex={0}
          role="treeitem"
          data-item-id={node.id}
          aria-expanded={container ? open : undefined}
          aria-selected={selected}
          title={url}
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
          className={cn(
            'group relative flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-1 text-[13px] outline-none transition-colors duration-100',
            selected
              ? 'bg-primary-soft text-fg'
              : 'text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:bg-surface-2',
            dnd.dragId === node.id && 'opacity-40',
            drop === 'inside' && 'bg-primary-soft ring-1 ring-primary',
          )}
        >
          {drop === 'before' && (
            <span className="pointer-events-none absolute inset-x-1 -top-px h-0.5 rounded-full bg-primary" />
          )}
          {drop === 'after' && (
            <span className="pointer-events-none absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary" />
          )}

          {container ? (
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 text-fg-subtle transition-transform duration-150',
                open && 'rotate-90',
              )}
            />
          ) : node.kind === 'request' && node.examples.length > 0 ? (
            <button
              type="button"
              aria-label={expanded ? 'Ocultar exemplos' : 'Mostrar exemplos'}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(node.id, !expanded);
              }}
              className="flex size-3.5 shrink-0 items-center justify-center"
            >
              <ChevronRight
                className={cn(
                  'size-3.5 text-fg-subtle transition-transform duration-150',
                  expanded && 'rotate-90',
                )}
              />
            </button>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          {node.kind === 'collection' && <Library className="size-3.5 shrink-0" strokeWidth={1.75} />}
          {node.kind === 'folder' &&
            (open ? (
              <FolderOpen className="size-3.5 shrink-0" strokeWidth={1.75} />
            ) : (
              <Folder className="size-3.5 shrink-0" strokeWidth={1.75} />
            ))}
          {node.kind === 'request' && <MethodBadge method={node.data.method} />}

          {renaming ? (
            <RenameInput node={node} onDone={() => setRenaming(null)} />
          ) : (
            <span
              className={cn('min-w-0 flex-1 truncate', node.kind === 'collection' && 'font-medium text-fg')}
            >
              {node.name}
            </span>
          )}

          {!renaming && (
            <DropdownActions
              entries={entries}
              align="end"
              trigger={
                <button
                  type="button"
                  aria-label={`Ações de ${node.name}`}
                  onClick={(e) => e.stopPropagation()}
                  className="ml-auto flex size-6 shrink-0 items-center justify-center rounded text-fg-subtle opacity-0 transition-opacity hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
              }
            />
          )}
        </div>
      </ContextActions>

      {node.kind === 'request' && expanded && node.examples.length > 0 && (
        <ul>
          {node.examples.map((ex) => (
            <ExampleRow key={ex.id} id={ex.id} name={ex.name} status={ex.response.status} depth={depth + 1} />
          ))}
        </ul>
      )}

      {open && (
        <ul>
          {node.children.length === 0 ? (
            <li
              className="flex h-7 items-center gap-2 text-xs text-fg-subtle"
              style={{ paddingLeft: `${(depth + 1) * 14 + 26}px` }}
            >
              Vazia
              <button
                type="button"
                onClick={() => void newRequest(node.id)}
                className="text-primary hover:underline"
              >
                adicionar requisição
              </button>
            </li>
          ) : (
            node.children.map((child: ChildNode) =>
              !visible || visible.has(child.id) ? (
                <TreeRow
                  key={child.id}
                  node={child}
                  depth={depth + 1}
                  visible={visible}
                  dnd={dnd}
                  forceOpen={forceOpen}
                />
              ) : null,
            )
          )}
        </ul>
      )}
    </li>
  );
}

function ExampleRow({
  id,
  name,
  status,
  depth,
}: {
  id: string;
  name: string;
  status: number;
  depth: number;
}) {
  const snapshot = useSnapshot();
  const selected = useTabs((s) => s.tabs.find((t) => t.id === s.activeId)?.itemId === id);
  const tone = statusTone(status);
  const open = () => useTabs.getState().openItem('example', id, snapshot);
  const entries: MenuEntry[] = [
    { label: 'Abrir', icon: SquareArrowOutUpRight, onSelect: open },
    'separator',
    { label: 'Excluir exemplo', icon: Trash2, danger: true, onSelect: () => void deleteExample(id, name) },
  ];
  return (
    <li>
      <ContextActions entries={entries}>
        <div
          role="treeitem"
          tabIndex={0}
          aria-selected={selected}
          onClick={open}
          onKeyDown={(e) => e.key === 'Enter' && open()}
          style={{ paddingLeft: `${depth * 14 + 26}px` }}
          className={cn(
            'flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-2 text-xs transition-colors',
            selected ? 'bg-primary-soft text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
          )}
        >
          <Bookmark className="size-3 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <span
            className={cn(
              'font-mono text-2xs',
              tone === 'success' && 'text-success',
              tone === 'warning' && 'text-warning',
              tone === 'danger' && 'text-danger',
            )}
          >
            {status}
          </span>
        </div>
      </ContextActions>
    </li>
  );
}

/** Sem confirmação: o aviso oferece desfazer. */
function deleteExample(id: string, name: string) {
  return removeItem(id, name);
}

function RenameInput({ node, onDone }: { node: TreeNode; onDone: () => void }) {
  const [value, setValue] = useState(node.name);
  async function commit() {
    const name = value.trim();
    onDone();
    await renameItem(node.id, node.name, name);
  }
  return (
    <input
      autoFocus
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') void commit();
        if (e.key === 'Escape') onDone();
      }}
      onBlur={() => void commit()}
      className="h-6 min-w-0 flex-1 rounded border border-primary bg-bg px-1.5 text-[13px] text-fg outline-none"
    />
  );
}

// ---------------------------------------------------------------------------
// Utilitários da árvore

function findIn(nodes: readonly TreeNode[], id: string): TreeNode | undefined {
  for (const n of walkTree(nodes)) if (n.id === id) return n;
  return undefined;
}

function parentMap(
  collections: readonly CollectionNode[],
): Map<string, CollectionNode | Extract<TreeNode, { kind: 'folder' }>> {
  const map = new Map<string, CollectionNode | Extract<TreeNode, { kind: 'folder' }>>();
  for (const n of walkTree(collections)) {
    if (isContainer(n)) for (const c of n.children) map.set(c.id, n);
  }
  return map;
}

function isAncestor(collections: readonly CollectionNode[], ancestorId: string, id: string): boolean {
  const parents = parentMap(collections);
  let current = parents.get(id);
  while (current) {
    if (current.id === ancestorId) return true;
    current = parents.get(current.id);
  }
  return false;
}

/** Ids visíveis para o filtro: itens que casam e todos os seus ancestrais. */
function filterTree(collections: readonly CollectionNode[], query: string): Set<string> {
  const result = new Set<string>();
  const visit = (node: TreeNode, path: string[]): void => {
    const haystack =
      node.kind === 'request'
        ? `${node.name} ${node.data.method} ${composeUrl(node.data.url, node.data.query)}`
        : node.name;
    if (haystack.toLowerCase().includes(query)) {
      for (const id of path) result.add(id);
      result.add(node.id);
      // Se uma pasta casa, mostra tudo dentro dela.
      if (isContainer(node)) for (const n of walkTree(node.children)) result.add(n.id);
    }
    if (isContainer(node)) for (const child of node.children) visit(child, [...path, node.id]);
  };
  for (const c of collections) visit(c, []);
  return result;
}
