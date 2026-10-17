import {
  CheckCircle2,
  Copy,
  FileDown,
  Globe,
  Layers,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { ContextActions, DropdownActions, type MenuEntry } from '../../components/ActionMenu';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useTabs } from '../../state/tabs';
import { useActiveEnvironmentId, useSnapshot } from '../../state/workspace';
import {
  deleteItem,
  duplicateItem,
  exportVariables,
  newEnvironment,
  renameEnvironment,
} from './item-actions';

export function EnvironmentsPanel({ filter }: { filter: string }) {
  const snapshot = useSnapshot();
  const activeId = useActiveEnvironmentId();
  const activeTabItem = useTabs((s) => s.tabs.find((t) => t.id === s.activeId));
  const query = filter.trim().toLowerCase();
  const envs = snapshot.environments.filter((e) => !query || e.name.toLowerCase().includes(query));

  return (
    <div className="px-2">
      <button
        type="button"
        onClick={() => useTabs.getState().openGlobals(snapshot)}
        className={cn(
          'flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] transition-colors',
          activeTabItem?.kind === 'globals'
            ? 'bg-primary-soft text-fg'
            : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
        )}
      >
        <Globe className="size-3.5" strokeWidth={1.75} />
        <span className="flex-1 text-left">Variáveis globais</span>
        <span className="font-mono text-2xs text-fg-subtle">{snapshot.globals.length}</span>
      </button>
      <div className="mx-2 my-2 h-px bg-border" />

      {snapshot.environments.length === 0 ? (
        <EmptyState
          compact
          icon={Layers}
          title="Nenhum ambiente"
          description="Ambientes guardam variáveis como URL base e tokens, por exemplo Local, Homologação e Produção."
          action={
            <Button size="sm" onClick={() => void newEnvironment()}>
              <Plus className="size-3.5" /> Novo ambiente
            </Button>
          }
        />
      ) : (
        <ul className="space-y-0.5">
          {envs.map((env) => {
            const isActive = env.id === activeId;
            const selected = activeTabItem?.kind === 'environment' && activeTabItem.itemId === env.id;
            const secrets = env.variables.filter((v) => v.type === 'secret').length;
            const entries: MenuEntry[] = [
              {
                label: isActive ? 'Desativar' : 'Ativar',
                icon: CheckCircle2,
                onSelect: () => void api.invoke('workspace:setActiveEnvironment', isActive ? null : env.id),
              },
              'separator',
              {
                label: 'Renomear',
                icon: Pencil,
                onSelect: () => void renameEnvironment(env.id, env.name),
                shortcut: 'Ctrl+E',
              },
              {
                label: 'Duplicar',
                icon: Copy,
                onSelect: () => void duplicateItem(env.id),
                shortcut: 'Ctrl+D',
              },
              {
                label: 'Exportar para o Postman',
                icon: FileDown,
                onSelect: () => void exportVariables(env.id),
              },
              'separator',
              {
                label: 'Excluir',
                icon: Trash2,
                danger: true,
                onSelect: () => void deleteItem({ id: env.id, name: env.name, kind: 'environment' }),
              },
            ];
            return (
              <li key={env.id}>
                <ContextActions entries={entries}>
                  <div
                    role="button"
                    tabIndex={0}
                    data-item-id={env.id}
                    onClick={() => useTabs.getState().openItem('environment', env.id, snapshot)}
                    onKeyDown={(e) =>
                      e.key === 'Enter' && useTabs.getState().openItem('environment', env.id, snapshot)
                    }
                    className={cn(
                      'group flex h-7 cursor-pointer items-center gap-2 rounded-md pl-2 pr-1 text-[13px] transition-colors',
                      selected ? 'bg-primary-soft text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                    )}
                  >
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        isActive ? 'bg-primary' : 'bg-border-strong',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{env.name}</span>
                    {secrets > 0 && (
                      <Lock className="size-3 text-fg-subtle" aria-label={`${secrets} secretas`} />
                    )}
                    {isActive && <span className="text-2xs text-primary">ativo</span>}
                    <DropdownActions
                      entries={entries}
                      align="end"
                      trigger={
                        <button
                          type="button"
                          aria-label={`Ações de ${env.name}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex size-6 shrink-0 items-center justify-center rounded text-fg-subtle opacity-0 transition-opacity hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                        >
                          <MoreHorizontal className="size-3.5" />
                        </button>
                      }
                    />
                  </div>
                </ContextActions>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
