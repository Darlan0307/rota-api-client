import type { RunConsoleEntry, RunScriptError, RunTest } from '@rota/core/shared';
import { AlertOctagon, CheckCircle2, CircleSlash, FlaskConical, Terminal, XCircle } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { cn } from '../../lib/cn';
import type { RequestTab } from '../../state/tabs';
import type { ResponseExtraSection } from '../response/ResponsePane';

const ORIGIN: Record<RunTest['sourceKind'], string> = {
  collection: 'coleção',
  folder: 'pasta',
  request: 'requisição',
};

function Origin({ item }: { item: Pick<RunTest, 'sourceKind' | 'source' | 'phase'> }) {
  if (item.sourceKind === 'request' && item.phase === 'post') return null;
  return (
    <span className="shrink-0 rounded bg-surface-2 px-1.5 text-2xs text-fg-subtle">
      {item.phase === 'pre' ? 'pré · ' : ''}
      {ORIGIN[item.sourceKind]}
      {item.sourceKind !== 'request' ? `: ${item.source}` : ''}
    </span>
  );
}

function ScriptErrors({ errors }: { errors: RunScriptError[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="space-y-2 border-b border-border p-4">
      {errors.map((e, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: lista estática
          key={i}
          className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2.5 text-xs"
        >
          <AlertOctagon className="mt-0.5 size-3.5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="text-fg">
              Erro no script de {e.phase === 'pre' ? 'pré-requisição' : 'pós-resposta'} (
              {ORIGIN[e.sourceKind]}
              {e.sourceKind !== 'request' ? ` "${e.source}"` : ''})
            </p>
            <p className="mt-0.5 break-words font-mono text-danger">{e.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

type Filter = 'all' | 'passed' | 'failed';

function TestsView({ tests, errors }: { tests: RunTest[]; errors: RunScriptError[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const passed = tests.filter((t) => t.status === 'passed').length;
  const failed = tests.filter((t) => t.status === 'failed').length;
  const shown = tests.filter((t) => filter === 'all' || t.status === filter);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <ScriptErrors errors={errors} />
      {tests.length === 0 ? (
        errors.length === 0 && (
          <EmptyState
            compact
            icon={FlaskConical}
            title="Nenhum teste nesta execução"
            description='Escreva testes no script de pós-resposta, ex.: pm.test("Status 200", () => pm.response.to.have.status(200));'
          />
        )
      ) : (
        <>
          <div className="flex items-center gap-1 px-4 py-2">
            {(
              [
                ['all', `Todos (${tests.length})`],
                ['passed', `Passaram (${passed})`],
                ['failed', `Falharam (${failed})`],
              ] as [Filter, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={cn(
                  'h-6 rounded px-2 text-xs transition-colors',
                  filter === id ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <ul className="px-4 pb-4">
            {shown.map((t, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: testes podem ter nomes repetidos
                key={i}
                className="flex items-start gap-2.5 border-b border-border py-2 text-[13px] last:border-0"
              >
                {t.status === 'passed' && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}
                {t.status === 'failed' && <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
                {t.status === 'skipped' && <CircleSlash className="mt-0.5 size-4 shrink-0 text-fg-subtle" />}
                <div className="min-w-0 flex-1">
                  <p className={cn(t.status === 'skipped' ? 'text-fg-muted' : 'text-fg')}>{t.name}</p>
                  {t.message && (
                    <p className="mt-0.5 break-words font-mono text-xs text-danger">{t.message}</p>
                  )}
                </div>
                <Origin item={t} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const LEVEL: Record<RunConsoleEntry['level'], string> = {
  log: 'text-fg',
  info: 'text-method-put',
  warn: 'text-warning',
  error: 'text-danger',
};

function ConsoleView({ entries, errors }: { entries: RunConsoleEntry[]; errors: RunScriptError[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <ScriptErrors errors={errors} />
      {entries.length === 0 ? (
        errors.length === 0 && (
          <EmptyState
            compact
            icon={Terminal}
            title="Console vazio"
            description="Mensagens de console.log nos scripts aparecem aqui."
          />
        )
      ) : (
        <ul className="select-text p-2 font-mono text-xs">
          {entries.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: ordem de execução
            <li key={i} className="flex items-start gap-2 rounded px-2 py-1 hover:bg-surface">
              <span className="w-10 shrink-0 text-2xs uppercase text-fg-subtle">{e.level}</span>
              <pre className={cn('min-w-0 flex-1 whitespace-pre-wrap break-words', LEVEL[e.level])}>
                {e.message}
              </pre>
              <Origin item={e} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Seções "Testes" e "Console" do painel de resposta. */
export function scriptResultSections(tab: RequestTab): ResponseExtraSection[] {
  const result = tab.run?.result;
  const tests = result?.tests ?? [];
  const entries = result?.console ?? [];
  const errors = result?.scriptErrors ?? [];
  const failed = tests.filter((t) => t.status === 'failed').length;
  const passed = tests.filter((t) => t.status === 'passed').length;

  return [
    {
      id: 'tests',
      label: (
        <span className="flex items-center gap-1.5">
          Testes
          {tests.length > 0 && (
            <span
              className={cn(
                'rounded px-1 font-mono text-2xs',
                failed ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success',
              )}
            >
              {passed}/{tests.length - tests.filter((t) => t.status === 'skipped').length}
            </span>
          )}
          {errors.length > 0 && <span className="size-1.5 rounded-full bg-danger" />}
        </span>
      ),
      render: () => <TestsView tests={tests} errors={errors} />,
    },
    {
      id: 'console',
      label: (
        <span className="flex items-center gap-1.5">
          Console
          {entries.length > 0 && (
            <span className="rounded bg-surface-2 px-1 font-mono text-2xs text-fg-muted">
              {entries.length}
            </span>
          )}
        </span>
      ),
      render: () => <ConsoleView entries={entries} errors={errors} />,
    },
  ];
}
