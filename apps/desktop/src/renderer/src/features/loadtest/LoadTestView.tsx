import {
  composeUrl,
  LOADTEST_LIMITS,
  type LoadTestConfig,
  type LoadTestStats,
  validateLoadTestConfig,
} from '@rota/core/shared';
import { AlertTriangle, CheckCircle2, Gauge, Info, Play, Square } from 'lucide-react';
import { useEffect } from 'react';
import type { MenuEntry } from '../../components/ActionMenu';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Field, TextInput } from '../../components/form';
import { MethodBadge } from '../../components/MethodBadge';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatDuration, statusTone } from '../../lib/format';
import { type LoadTestTab, useTabs } from '../../state/tabs';
import { LineChart } from './LineChart';

function update(id: string, change: (t: LoadTestTab) => LoadTestTab) {
  useTabs.getState().update<LoadTestTab>(id, change);
}

async function start(tab: LoadTestTab) {
  const problem = validateLoadTestConfig(tab.config);
  if (problem) {
    update(tab.id, (t) => ({ ...t, error: problem }));
    return;
  }
  const runId = crypto.randomUUID();
  update(tab.id, (t) => ({ ...t, runId, status: 'running', stats: null, result: null, error: null }));
  try {
    const result = await api.invoke('loadtest:start', {
      runId,
      requestId: tab.requestId ?? undefined,
      parentId: tab.parentId ?? undefined,
      data: tab.data,
      config: tab.config,
    });
    update(tab.id, (t) => (t.runId === runId ? { ...t, status: 'done', result, stats: result } : t));
  } catch (error) {
    update(tab.id, (t) => (t.runId === runId ? { ...t, status: 'done', error: errorMessage(error) } : t));
  }
}

/** Assina o progresso dos testes em andamento (uma vez, no topo da aba). */
function useProgress(tab: LoadTestTab) {
  useEffect(
    () =>
      api.on('loadtest:progress', ({ runId, stats }) => {
        update(tab.id, (t) => (t.runId === runId && t.status === 'running' ? { ...t, stats } : t));
      }),
    [tab.id],
  );
}

const nf = (n: number, digits = 0) =>
  n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export function LoadTestView({ tab }: { tab: LoadTestTab }) {
  useProgress(tab);
  const running = tab.status === 'running';
  const stats = tab.stats;
  const config = tab.config;
  const setConfig = (patch: Partial<LoadTestConfig>) =>
    update(tab.id, (t) => ({ ...t, config: { ...t.config, ...patch }, error: null }));

  const progress = stats
    ? config.mode === 'count'
      ? Math.min(1, stats.completed / config.total)
      : Math.min(1, stats.elapsedMs / (config.durationSec * 1000))
    : 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <Gauge className="size-4 text-fg-subtle" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{tab.title}</h1>
          <p className="flex items-center gap-2 truncate text-xs text-fg-muted">
            <MethodBadge method={tab.data.method} short={false} />
            <span className="truncate font-mono">{composeUrl(tab.data.url, tab.data.query)}</span>
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl space-y-6 p-6">
          {/* Configuração */}
          <section className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-surface p-4">
            <Field label="Parar após">
              <div className="flex h-8 rounded-md border border-border bg-surface-2 p-0.5">
                {(
                  [
                    ['count', 'Quantidade'],
                    ['duration', 'Duração'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={running}
                    onClick={() => setConfig({ mode })}
                    className={cn(
                      'rounded px-3 text-xs transition-colors disabled:opacity-60',
                      config.mode === mode ? 'bg-elevated text-fg' : 'text-fg-muted hover:text-fg',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
            {config.mode === 'count' ? (
              <Field label="Total de requisições">
                <TextInput
                  type="number"
                  min={1}
                  max={LOADTEST_LIMITS.maxTotal}
                  disabled={running}
                  value={config.total}
                  onChange={(e) => setConfig({ total: Math.floor(Number(e.target.value)) })}
                  className="w-36"
                />
              </Field>
            ) : (
              <Field label="Duração (segundos)">
                <TextInput
                  type="number"
                  min={1}
                  max={LOADTEST_LIMITS.maxDurationSec}
                  disabled={running}
                  value={config.durationSec}
                  onChange={(e) => setConfig({ durationSec: Math.floor(Number(e.target.value)) })}
                  className="w-36"
                />
              </Field>
            )}
            <Field label="Concorrência">
              <TextInput
                type="number"
                min={1}
                max={LOADTEST_LIMITS.maxConcurrency}
                disabled={running}
                value={config.concurrency}
                onChange={(e) => setConfig({ concurrency: Math.floor(Number(e.target.value)) })}
                className="w-28"
              />
            </Field>
            <div className="flex-1" />
            {running ? (
              <Button
                variant="danger"
                className="h-9"
                onClick={() => tab.runId && void api.invoke('loadtest:cancel', tab.runId)}
              >
                <Square className="size-3.5" /> Cancelar
              </Button>
            ) : (
              <Button variant="primary" className="h-9" onClick={() => void start(tab)}>
                <Play className="size-3.5" /> {tab.status === 'done' ? 'Rodar de novo' : 'Iniciar teste'}
              </Button>
            )}
            <p className="flex w-full items-center gap-1.5 text-xs text-fg-subtle">
              <Info className="size-3.5" /> Usa o ambiente ativo e a auth herdada; scripts não são executados.
              Teste só APIs que você pode sobrecarregar.
            </p>
            {tab.error && <p className="w-full text-xs text-danger">{tab.error}</p>}
          </section>

          {!stats ? (
            <div className="h-64">
              <EmptyState
                icon={Gauge}
                title={running ? 'Iniciando…' : 'Configure e inicie o teste'}
                description="Mostra requisições por segundo, tempo médio, percentis (p50/p95/p99), taxa de erro e a distribuição dos status."
              />
            </div>
          ) : (
            <Results
              stats={stats}
              running={running}
              progress={progress}
              cancelled={tab.result?.cancelled ?? false}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Results({
  stats,
  running,
  progress,
  cancelled,
}: {
  stats: LoadTestStats;
  running: boolean;
  progress: number;
  cancelled: boolean;
}) {
  const errorPct = stats.errorRate * 100;
  return (
    <>
      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs text-fg-muted">
          <span className="flex items-center gap-1.5">
            {running ? (
              'Em andamento…'
            ) : cancelled ? (
              <>
                <AlertTriangle className="size-3.5 text-warning" /> Cancelado
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3.5 text-success" /> Concluído
              </>
            )}
          </span>
          <span className="font-mono">{formatDuration(stats.elapsedMs)}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-300',
              running ? 'bg-primary' : 'bg-success',
            )}
            style={{ width: `${(running ? progress : 1) * 100}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Requisições" value={nf(stats.completed)} />
        <Tile label="Requisições/s" value={nf(stats.rps, 1)} />
        <Tile label="Tempo médio" value={stats.latency ? formatDuration(stats.latency.mean) : '—'} />
        <Tile
          label="Taxa de erro"
          value={`${nf(errorPct, errorPct < 10 ? 1 : 0)}%`}
          tone={stats.failed > 0 ? 'danger' : 'success'}
          hint={stats.failed > 0 ? `${nf(stats.failed)} com falha` : 'nenhuma falha'}
        />
        <Tile label="p50" value={stats.latency ? formatDuration(stats.latency.p50) : '—'} />
        <Tile label="p95" value={stats.latency ? formatDuration(stats.latency.p95) : '—'} />
        <Tile label="p99" value={stats.latency ? formatDuration(stats.latency.p99) : '—'} />
        <Tile
          label="Mín. / máx."
          value={
            stats.latency
              ? `${formatDuration(stats.latency.min)} / ${formatDuration(stats.latency.max)}`
              : '—'
          }
          small
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Requisições por segundo">
          <LineChart
            ariaLabel="Requisições por segundo ao longo do teste"
            points={stats.timeline.map((p) => ({ x: p.t, y: p.rps }))}
            formatY={(y) => nf(y)}
            formatX={(x) => `${nf(x, 1)} s`}
          />
        </Panel>
        <Panel title="Tempo médio de resposta">
          <LineChart
            ariaLabel="Tempo médio de resposta por segundo"
            points={stats.timeline.filter((p) => p.requests > 0).map((p) => ({ x: p.t, y: p.meanMs }))}
            formatY={(y) => `${nf(y)} ms`}
            formatX={(x) => `${nf(x, 1)} s`}
          />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Status das respostas">
          <StatusBars counts={stats.statusCounts} total={stats.completed} />
        </Panel>
        {Object.keys(stats.errors).length > 0 && (
          <Panel title="Erros de conexão">
            <table className="w-full text-xs">
              <tbody>
                {Object.entries(stats.errors)
                  .sort((a, b) => b[1] - a[1])
                  .map(([message, count]) => (
                    <tr key={message} className="border-b border-border last:border-0">
                      <td className="py-1.5 text-fg">{message}</td>
                      <td className="py-1.5 text-right font-mono text-fg-muted">{nf(count)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>
    </>
  );
}

function Tile({
  label,
  value,
  tone,
  hint,
  small,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger';
  hint?: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className={cn('mt-1 font-mono font-semibold text-fg', small ? 'text-sm' : 'text-xl')}>{value}</p>
      {hint && (
        <p
          className={cn(
            'mt-0.5 flex items-center gap-1 text-2xs',
            tone === 'danger' ? 'text-danger' : 'text-success',
          )}
        >
          {tone === 'danger' ? <AlertTriangle className="size-3" /> : <CheckCircle2 className="size-3" />}
          {hint}
        </p>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-xs font-medium text-fg-muted">{title}</h2>
      {children}
    </section>
  );
}

const BAR_CLASS = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  muted: 'bg-fg-subtle',
} as const;

function StatusBars({ counts, total }: { counts: Record<string, number>; total: number }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <p className="text-xs text-fg-subtle">Nenhuma resposta ainda.</p>;
  return (
    <ul className="space-y-2.5">
      {entries.map(([status, count]) => {
        const tone = status === 'erro' ? 'danger' : statusTone(Number(status));
        const pct = total ? (count / total) * 100 : 0;
        return (
          <li key={status} className="group">
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-mono text-fg">{status === 'erro' ? 'Erro de conexão' : status}</span>
              <span className="font-mono text-fg-muted">
                {nf(count)} · {nf(pct, 1)}%
              </span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-surface-2"
              title={`${status}: ${count} (${nf(pct, 1)}%)`}
            >
              <div
                className={cn('h-full rounded-full', BAR_CLASS[tone])}
                style={{ width: `${Math.max(1, pct)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function loadTestAction(tab: import('../../state/tabs').RequestTab): MenuEntry {
  return { label: 'Teste de carga…', icon: Gauge, onSelect: () => useTabs.getState().openLoadTest(tab) };
}
