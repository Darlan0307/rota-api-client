import {
  ChevronRight,
  Download,
  Folder,
  FolderTree,
  Globe,
  History,
  Library,
  ListFilter,
  PanelLeftClose,
  Plus,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { IconButton } from '../components/IconButton';
import { MethodBadge } from '../components/MethodBadge';
import { DEMO_ENVIRONMENTS, DEMO_TREE, type DemoNode } from '../demo';
import { cn } from '../lib/cn';
import { type SidebarSection, useUiStore } from '../state/ui';
import { SECTIONS } from './ActivityBar';

export function Sidebar() {
  const section = useUiStore((s) => s.sidebarSection);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const label = SECTIONS.find((s) => s.id === section)?.label ?? '';

  return (
    <aside className="flex h-full flex-col bg-surface" aria-label={label}>
      <div className="flex h-10 shrink-0 items-center gap-1 pl-4 pr-2">
        <h2 className="flex-1 text-2xs font-semibold uppercase tracking-wider text-fg-muted">{label}</h2>
        <SectionActions section={section} />
        <IconButton icon={PanelLeftClose} label="Recolher painel" size="sm" onClick={toggleSidebar} />
      </div>

      {section !== 'trash' && (
        <div className="px-3 pb-2">
          <label className="flex h-7 items-center gap-2 rounded-md border border-transparent bg-surface-2 px-2 text-xs transition-colors focus-within:border-border-strong">
            <ListFilter className="size-3.5 text-fg-subtle" strokeWidth={1.75} />
            <input
              placeholder="Filtrar"
              className="w-full bg-transparent text-fg outline-none placeholder:text-fg-subtle"
            />
          </label>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <SectionContent section={section} />
      </div>
    </aside>
  );
}

function SectionActions({ section }: { section: SidebarSection }) {
  if (section === 'collections') {
    return (
      <>
        <IconButton icon={Download} label="Importar do Postman (Fase 3)" size="sm" />
        <IconButton icon={Plus} label="Nova coleção" size="sm" />
      </>
    );
  }
  if (section === 'environments') return <IconButton icon={Plus} label="Novo ambiente" size="sm" />;
  return null;
}

function SectionContent({ section }: { section: SidebarSection }) {
  switch (section) {
    case 'collections':
      return <CollectionsTree />;
    case 'environments':
      return <EnvironmentsList />;
    case 'history':
      return (
        <EmptyState
          compact
          icon={History}
          title="Nenhuma requisição enviada"
          description="As requisições que você enviar aparecem aqui, com busca e opção de reabrir."
        />
      );
    case 'trash':
      return (
        <EmptyState
          compact
          icon={Trash2}
          title="A lixeira está vazia"
          description="Itens excluídos ficam aqui e podem ser restaurados."
        />
      );
  }
}

function CollectionsTree() {
  if (DEMO_TREE.length === 0) {
    return (
      <EmptyState
        compact
        icon={FolderTree}
        title="Nenhuma coleção ainda"
        description="Crie uma coleção ou importe uma exportação do Postman."
        action={
          <Button size="sm" variant="secondary">
            <Plus className="size-3.5" /> Nova coleção
          </Button>
        }
      />
    );
  }
  return (
    <ul className="px-2">
      {DEMO_TREE.map((node) => (
        <TreeNode key={node.id} node={node} depth={0} />
      ))}
    </ul>
  );
}

function TreeNode({ node, depth }: { node: DemoNode; depth: number }) {
  const [open, setOpen] = useState(depth === 0 || node.id === 'f2');
  const openTab = useUiStore((s) => s.openTab);
  const activeItemId = useUiStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.itemId);

  const isRequest = node.kind === 'request';
  const selected = isRequest && activeItemId === node.id;
  const indent = { paddingLeft: `${depth * 14 + 6}px` };

  function onClick() {
    if (isRequest && node.method) {
      openTab({ itemId: node.id, name: node.name, method: node.method });
    } else {
      setOpen((o) => !o);
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-expanded={isRequest ? undefined : open}
        aria-current={selected ? 'true' : undefined}
        style={indent}
        className={cn(
          'group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[13px] transition-colors duration-100',
          selected ? 'bg-primary-soft text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
        )}
      >
        {isRequest ? (
          <span className="w-3.5 shrink-0" />
        ) : (
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 text-fg-subtle transition-transform duration-150',
              open && 'rotate-90',
            )}
          />
        )}
        {node.kind === 'collection' && <Library className="size-3.5 shrink-0" strokeWidth={1.75} />}
        {node.kind === 'folder' && <Folder className="size-3.5 shrink-0" strokeWidth={1.75} />}
        {isRequest && node.method && <MethodBadge method={node.method} />}
        <span className={cn('truncate', node.kind === 'collection' && 'font-medium text-fg')}>
          {node.name}
        </span>
      </button>
      {!isRequest && open && (
        <ul>
          {node.children?.length ? (
            node.children.map((child) => <TreeNode key={child.id} node={child} depth={depth + 1} />)
          ) : (
            <li
              className="py-1 text-xs italic text-fg-subtle"
              style={{ paddingLeft: `${(depth + 1) * 14 + 26}px` }}
            >
              Vazia
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function EnvironmentsList() {
  const activeId = useUiStore((s) => s.activeEnvironmentId);
  return (
    <ul className="space-y-0.5 px-2">
      <li>
        <button
          type="button"
          className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <Globe className="size-3.5" strokeWidth={1.75} />
          Variáveis globais
        </button>
      </li>
      <li className="mx-2 my-1.5 h-px bg-border" />
      {DEMO_ENVIRONMENTS.map((env) => (
        <li key={env.id}>
          <button
            type="button"
            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <span
              className={cn('size-1.5 rounded-full', env.id === activeId ? 'bg-primary' : 'bg-border-strong')}
            />
            <span className="flex-1 truncate text-left">{env.name}</span>
            {env.id === activeId && <span className="text-2xs text-primary">ativo</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
