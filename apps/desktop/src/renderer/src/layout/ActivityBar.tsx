import {
  Database,
  FolderTree,
  Globe,
  History,
  type LucideIcon,
  Settings,
  Trash2,
  Webhook,
} from 'lucide-react';
import { Tooltip } from '../components/Tooltip';
import { cn } from '../lib/cn';
import { type SidebarSection, useUiStore } from '../state/ui';

export const SECTIONS: { id: SidebarSection; label: string; icon: LucideIcon }[] = [
  { id: 'collections', label: 'Coleções', icon: FolderTree },
  { id: 'environments', label: 'Ambientes', icon: Globe },
  { id: 'history', label: 'Histórico', icon: History },
  { id: 'tunnels', label: 'Túneis (webhooks)', icon: Webhook },
  { id: 'databases', label: 'Bancos de dados', icon: Database },
  { id: 'trash', label: 'Lixeira', icon: Trash2 },
];

export function ActivityBar() {
  const section = useUiStore((s) => s.sidebarSection);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const selectSection = useUiStore((s) => s.selectSection);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  return (
    <nav
      aria-label="Seções"
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface py-2"
    >
      {SECTIONS.map(({ id, label, icon: Icon }) => {
        const active = section === id && !collapsed;
        return (
          <Tooltip key={id} label={label} side="right">
            <button
              type="button"
              aria-label={label}
              aria-pressed={active}
              onClick={() => selectSection(id)}
              className={cn(
                'relative flex size-9 items-center justify-center rounded-lg transition-colors duration-150',
                active ? 'bg-surface-2 text-fg' : 'text-fg-subtle hover:bg-surface-2/60 hover:text-fg-muted',
              )}
            >
              <span
                className={cn(
                  'absolute -left-[7px] h-4 w-0.5 rounded-full bg-primary transition-[opacity,transform] duration-200',
                  active ? 'scale-y-100 opacity-100' : 'scale-y-50 opacity-0',
                )}
              />
              <Icon className="size-[18px]" strokeWidth={1.75} />
            </button>
          </Tooltip>
        );
      })}

      <div className="flex-1" />

      <Tooltip label="Configurações" side="right">
        <button
          type="button"
          aria-label="Configurações"
          onClick={() => setSettingsOpen(true)}
          className="flex size-9 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-2/60 hover:text-fg-muted"
        >
          <Settings className="size-[18px]" strokeWidth={1.75} />
        </button>
      </Tooltip>
    </nav>
  );
}
