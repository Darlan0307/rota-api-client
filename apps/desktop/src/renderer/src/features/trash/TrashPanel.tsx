import type { TrashEntry } from '@rota/core/shared';
import { Bookmark, FileText, Folder, Layers, Library, RotateCcw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ContextActions, type MenuEntry } from '../../components/ActionMenu';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { Tooltip } from '../../components/Tooltip';
import { api, errorMessage } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { confirmDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';

const ICONS = {
  collection: Library,
  folder: Folder,
  request: FileText,
  environment: Layers,
  example: Bookmark,
} as const;

const KIND_LABEL: Record<TrashEntry['kind'], string> = {
  collection: 'Coleção',
  folder: 'Pasta',
  request: 'Requisição',
  environment: 'Ambiente',
  example: 'Exemplo',
};

async function restore(entry: TrashEntry) {
  try {
    await api.invoke('trash:restore', entry.id);
    toast.success(`"${entry.name}" restaurado.`);
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

async function removeForever(entry: TrashEntry) {
  const choice = await confirmDialog({
    title: `Excluir "${entry.name}" para sempre?`,
    description: 'O item sai da lixeira e não poderá mais ser restaurado.',
    confirmLabel: 'Excluir definitivamente',
    danger: true,
  });
  if (choice === 'confirm') await api.invoke('trash:remove', entry.id);
}

export async function emptyTrash(): Promise<void> {
  const entries = await api.invoke('trash:list');
  if (entries.length === 0) {
    toast.info('A lixeira já está vazia.');
    return;
  }
  const choice = await confirmDialog({
    title: 'Esvaziar a lixeira?',
    description: `${entries.length} ${entries.length === 1 ? 'item será apagado' : 'itens serão apagados'} para sempre, incluindo valores de variáveis secretas guardados com eles. Esta ação não pode ser desfeita.`,
    confirmLabel: 'Esvaziar lixeira',
    danger: true,
  });
  if (choice !== 'confirm') return;
  const count = await api.invoke('trash:empty');
  toast.success(`${count} ${count === 1 ? 'item apagado' : 'itens apagados'} definitivamente.`);
}

export function TrashPanel({ filter }: { filter: string }) {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await api.invoke('trash:list'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void load();
    const offTrash = api.on('trash:changed', () => void load());
    const offWorkspace = api.on('workspace:changed', () => void load());
    return () => {
      offTrash();
      offWorkspace();
    };
  }, [load]);

  if (entries === null) return null;
  const q = filter.trim().toLowerCase();
  const shown = entries.filter((e) => !q || `${e.name} ${e.breadcrumb.join(' ')}`.toLowerCase().includes(q));

  if (entries.length === 0) {
    return (
      <EmptyState
        compact
        icon={Trash2}
        title="A lixeira está vazia"
        description="Itens excluídos ficam aqui e podem ser restaurados no mesmo lugar."
      />
    );
  }

  return (
    <ul className="space-y-0.5 px-2">
      {shown.map((entry) => {
        const Icon = ICONS[entry.kind];
        const menu: MenuEntry[] = [
          { label: 'Restaurar', icon: RotateCcw, onSelect: () => void restore(entry) },
          'separator',
          {
            label: 'Excluir definitivamente',
            icon: X,
            danger: true,
            onSelect: () => void removeForever(entry),
          },
        ];
        return (
          <li key={entry.id}>
            <ContextActions entries={menu}>
              <div className="group flex items-center gap-2 rounded-md px-2 py-(--row-py) hover:bg-surface-2">
                <Icon className="size-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-fg">{entry.name}</p>
                  <p className="truncate text-2xs text-fg-subtle">
                    {KIND_LABEL[entry.kind]}
                    {entry.breadcrumb.length ? ` em ${entry.breadcrumb.join(' › ')}` : ''} ·{' '}
                    {formatRelative(entry.deletedAt)}
                  </p>
                </div>
                <Tooltip label="Restaurar">
                  <button
                    type="button"
                    aria-label={`Restaurar ${entry.name}`}
                    onClick={() => void restore(entry)}
                    className="flex size-6 shrink-0 items-center justify-center rounded text-fg-subtle opacity-0 transition-opacity hover:bg-surface hover:text-primary focus:opacity-100 group-hover:opacity-100"
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                </Tooltip>
              </div>
            </ContextActions>
          </li>
        );
      })}
    </ul>
  );
}

export function TrashActions() {
  return <IconButton icon={Trash2} label="Esvaziar lixeira" size="sm" onClick={() => void emptyTrash()} />;
}
