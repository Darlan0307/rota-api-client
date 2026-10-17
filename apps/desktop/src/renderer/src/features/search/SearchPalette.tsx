import { type SearchResult, searchWorkspace } from '@rota/core/shared';
import { Bookmark, CornerDownLeft, Folder, Layers, Library, Search } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { Kbd } from '../../components/Kbd';
import { MethodBadge } from '../../components/MethodBadge';
import { cn } from '../../lib/cn';
import { useTabs } from '../../state/tabs';
import { useUiStore } from '../../state/ui';
import { useSnapshot, useWorkspace } from '../../state/workspace';

function openResult(result: SearchResult): void {
  const snapshot = useWorkspace.getState().state?.snapshot;
  if (!snapshot) return;
  const tabs = useTabs.getState();
  if (result.kind === 'environment') tabs.openItem('environment', result.id, snapshot);
  else if (result.kind === 'example') tabs.openItem('example', result.id, snapshot);
  else if (result.kind === 'request') tabs.openItem('request', result.id, snapshot);
  else {
    // Pastas e coleções: expande na sidebar e abre as configurações.
    useUiStore.getState().showSection('collections');
    useUiStore.getState().setExpanded(result.id, true);
    tabs.openItem(result.kind, result.id, snapshot);
  }
}

const ICONS = {
  collection: Library,
  folder: Folder,
  environment: Layers,
  example: Bookmark,
} as const;

/** Conteúdo do diálogo de busca global (Ctrl+P). */
export function SearchPalette({ close }: { close: () => void }) {
  const snapshot = useSnapshot();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const results = useMemo(() => searchWorkspace(snapshot, deferred, 60), [snapshot, deferred]);
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: volta ao primeiro resultado a cada nova busca
  useEffect(() => setIndex(0), [deferred]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  function choose(result: SearchResult | undefined) {
    if (!result) return;
    close();
    openResult(result);
  }

  return (
    <div className="flex max-h-[70vh] flex-col">
      <label className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Search className="size-4 text-fg-subtle" strokeWidth={1.75} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(results[index]);
            }
          }}
          placeholder="Buscar por nome, URL ou conteúdo (body, headers, scripts)"
          className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
        />
        <Kbd keys="Esc" />
      </label>

      {query.trim() === '' ? (
        <div className="p-6 text-center text-xs text-fg-muted">
          Busque coleções, pastas, requisições, exemplos e ambientes. Vários termos podem ser combinados:
          "pedido post".
        </div>
      ) : results.length === 0 ? (
        <div className="h-48">
          <EmptyState
            compact
            icon={Search}
            title="Nada encontrado"
            description={`Nenhum item contém "${query}".`}
          />
        </div>
      ) : (
        <ul ref={listRef} role="listbox" className="min-h-0 overflow-auto p-1.5">
          {results.map((r, i) => {
            const Icon = r.kind === 'request' ? null : ICONS[r.kind];
            return (
              <li
                key={`${r.kind}-${r.id}`}
                data-index={i}
                role="option"
                aria-selected={i === index}
                onMouseMove={() => setIndex(i)}
                onClick={() => choose(r)}
                onKeyDown={() => undefined}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2',
                  i === index ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                )}
              >
                <span className="flex w-10 shrink-0 justify-center">
                  {r.kind === 'request' && r.method ? (
                    <MethodBadge method={r.method} />
                  ) : Icon ? (
                    <Icon className="size-4 text-fg-subtle" strokeWidth={1.75} />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-fg">{r.title}</span>
                  <span className="block truncate text-2xs text-fg-subtle">
                    {r.path}
                    {r.url ? <span className="font-mono"> · {r.url}</span> : null}
                  </span>
                  {r.match.snippet && (
                    <span className="mt-0.5 block truncate font-mono text-2xs text-fg-muted">
                      <span className="text-primary">{r.match.field}:</span> {r.match.snippet}
                    </span>
                  )}
                </span>
                {i === index && <CornerDownLeft className="size-3.5 shrink-0 text-fg-subtle" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
