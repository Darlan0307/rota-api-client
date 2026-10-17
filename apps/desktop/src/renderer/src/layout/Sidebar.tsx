import { Download, ListFilter, PanelLeftClose, Plus, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { IconButton } from '../components/IconButton';
import { CollectionsTree } from '../features/sidebar/CollectionsTree';
import { EnvironmentsPanel } from '../features/sidebar/EnvironmentsPanel';
import { newCollection, newEnvironment } from '../features/sidebar/item-actions';
import { type SidebarSection, useUiStore } from '../state/ui';
import { SECTIONS } from './ActivityBar';

/** Conteúdo extra das seções (histórico, lixeira e importação entram em fases seguintes). */
export interface SidebarExtensions {
  history?: (filter: string) => ReactNode;
  trash?: (filter: string) => ReactNode;
  historyActions?: () => ReactNode;
  trashActions?: () => ReactNode;
  onImport?: () => void;
}

let extensions: SidebarExtensions = {};
export function registerSidebarExtensions(ext: SidebarExtensions): void {
  extensions = { ...extensions, ...ext };
}

export function Sidebar() {
  const section = useUiStore((s) => s.sidebarSection);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const label = SECTIONS.find((s) => s.id === section)?.label ?? '';
  const [filters, setFilters] = useState<Record<SidebarSection, string>>({
    collections: '',
    environments: '',
    history: '',
    trash: '',
  });
  const filter = filters[section];

  return (
    <aside className="flex h-full flex-col bg-surface" aria-label={label}>
      <div className="flex h-10 shrink-0 items-center gap-0.5 pl-4 pr-2">
        <h2 className="flex-1 text-2xs font-semibold uppercase tracking-wider text-fg-muted">{label}</h2>
        <SectionActions section={section} />
        <IconButton icon={PanelLeftClose} label="Recolher painel" size="sm" onClick={toggleSidebar} />
      </div>

      <div className="px-3 pb-2">
        <label className="flex h-7 items-center gap-2 rounded-md border border-transparent bg-surface-2 px-2 text-xs transition-colors focus-within:border-border-strong">
          <ListFilter className="size-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <input
            value={filter}
            onChange={(e) => setFilters((f) => ({ ...f, [section]: e.target.value }))}
            onKeyDown={(e) => e.key === 'Escape' && setFilters((f) => ({ ...f, [section]: '' }))}
            placeholder={section === 'collections' ? 'Filtrar por nome ou URL' : 'Filtrar'}
            className="w-full bg-transparent text-fg outline-none placeholder:text-fg-subtle"
          />
          {filter && (
            <button
              type="button"
              aria-label="Limpar filtro"
              onClick={() => setFilters((f) => ({ ...f, [section]: '' }))}
              className="text-fg-subtle hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          )}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {section === 'collections' && <CollectionsTree filter={filter} />}
        {section === 'environments' && <EnvironmentsPanel filter={filter} />}
        {section === 'history' && extensions.history?.(filter)}
        {section === 'trash' && extensions.trash?.(filter)}
      </div>
    </aside>
  );
}

function SectionActions({ section }: { section: SidebarSection }) {
  if (section === 'collections') {
    return (
      <>
        {extensions.onImport && (
          <IconButton
            icon={Download}
            label="Importar (Postman ou OpenAPI)"
            size="sm"
            onClick={extensions.onImport}
          />
        )}
        <IconButton icon={Plus} label="Nova coleção" size="sm" onClick={() => void newCollection()} />
      </>
    );
  }
  if (section === 'environments') {
    return <IconButton icon={Plus} label="Novo ambiente" size="sm" onClick={() => void newEnvironment()} />;
  }
  if (section === 'history') return <>{extensions.historyActions?.()}</>;
  if (section === 'trash') return <>{extensions.trashActions?.()}</>;
  return null;
}
