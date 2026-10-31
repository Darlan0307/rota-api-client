import { engineInfo, snippetText, sqlExamples } from '@rota/core/shared';
import { SquarePen } from 'lucide-react';
import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Kbd } from '../../components/Kbd';
import { cn } from '../../lib/cn';
import { appendToSqlEditor } from './sql-editors';
import { useConnection } from './state';

const useSqlExamples = create<{ connectionId: string | null }>()(() => ({ connectionId: null }));

export function openSqlExamples(connectionId: string): void {
  useSqlExamples.setState({ connectionId });
}

const close = () => useSqlExamples.setState({ connectionId: null });

export function SqlExamplesDialog() {
  const connectionId = useSqlExamples((s) => s.connectionId);
  if (!connectionId) return null;
  return <SqlExamplesContent connectionId={connectionId} />;
}

function SqlExamplesContent({ connectionId }: { connectionId: string }) {
  const view = useConnection(connectionId);
  const engine = view?.config.engine ?? 'firebird';
  const groups = useMemo(() => sqlExamples(engine), [engine]);
  const [group, setGroup] = useState(0);
  const current = groups[group] ?? groups[0];

  function use(snippet: string) {
    // Fecha antes: o diálogo aberto seguraria o foco longe do editor.
    close();
    // O Radix devolve o foco ao fechar: espera isso acontecer antes de focar o editor.
    setTimeout(() => appendToSqlEditor(connectionId, snippet, { snippet: true }), 60);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={`Exemplos de SQL · ${engineInfo(engine).label}`}
      className="h-[min(680px,88vh)] w-[min(940px,94vw)]"
    >
      <div className="flex min-h-0 flex-1">
        <nav
          className="w-44 shrink-0 space-y-0.5 border-r border-border bg-surface p-2"
          aria-label="Assuntos"
        >
          {groups.map((g, i) => (
            <button
              key={g.label}
              type="button"
              onClick={() => setGroup(i)}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors',
                i === group ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg',
              )}
            >
              {g.label}
              <span className="font-mono text-2xs text-fg-subtle">{g.items.length}</span>
            </button>
          ))}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
          <p className="mb-3 text-xs text-fg-muted">
            "Usar" coloca o exemplo no fim do editor com os nomes destacados: digite por cima e aperte{' '}
            <Kbd keys="Tab" /> para ir ao próximo. Troque pelos nomes das suas tabelas e colunas (a estrutura
            à esquerda ajuda).
          </p>
          <ul className="space-y-3">
            {current?.items.map((item) => (
              <li key={item.title} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-fg">{item.title}</p>
                    <p className="text-xs text-fg-muted">{item.description}</p>
                  </div>
                  <Button size="sm" onClick={() => use(item.snippet)}>
                    <SquarePen className="size-3.5" /> Usar
                  </Button>
                </div>
                <pre className="mt-2 overflow-x-auto rounded-md bg-bg p-2.5 font-mono text-xs text-fg">
                  {snippetText(item.snippet)}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}
