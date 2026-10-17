import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { useUiStore } from '../state/ui';

/** Conteúdo da busca global, registrado pela feature de busca. */
let searchContent: ((close: () => void) => ReactNode) | undefined;
export function registerSearchContent(render: (close: () => void) => ReactNode): void {
  searchContent = render;
}

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
      className="w-[min(680px,92vw)]"
    >
      {searchContent ? (
        searchContent(() => setOpen(false))
      ) : (
        <div className="h-64">
          <EmptyState compact icon={Search} title="Busca global" description="Em breve." />
        </div>
      )}
    </Dialog>
  );
}
