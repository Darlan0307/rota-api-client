import { Search } from 'lucide-react';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { Kbd } from '../components/Kbd';
import { useUiStore } from '../state/ui';

export function SearchDialog() {
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearchOpen);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Busca global"
      hideTitle
      placement="top"
      className="w-[min(640px,90vw)]"
    >
      <label className="flex h-12 items-center gap-3 border-b border-border px-4">
        <Search className="size-4 text-fg-subtle" strokeWidth={1.75} />
        <input
          autoFocus
          placeholder="Buscar por nome, URL ou conteúdo"
          className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
        />
        <Kbd keys="Esc" />
      </label>
      <div className="h-64">
        <EmptyState
          compact
          icon={Search}
          title="Busca global em construção"
          description="A busca por coleções, pastas, requisições e ambientes chega na Fase 4."
        />
      </div>
    </Dialog>
  );
}
