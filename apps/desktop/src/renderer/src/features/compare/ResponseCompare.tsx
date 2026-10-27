import { DiffEditor } from '@monaco-editor/react';
import {
  type ContractIssue,
  checkContract,
  describeContractIssue,
  type ExampleFile,
  findNode,
  formatJson,
  formatJsonSorted,
  type HistorySummary,
  type HttpResponse,
  tryParseJson,
} from '@rota/core/shared';
import { AlertTriangle, BookmarkPlus, CheckCircle2, GitCompare, Info, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { EmptyState } from '../../components/EmptyState';
import { Checkbox, Select } from '../../components/form';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatBytes, formatDateTime, formatDuration } from '../../lib/format';
import { type monaco, ROTA_THEME } from '../../lib/monaco';
import { useElementWidth } from '../../lib/use-element-width';
import type { RequestTab } from '../../state/tabs';
import { useSnapshot } from '../../state/workspace';
import type { ResponseExtraSection } from '../response/ResponsePane';

/** Seções "Contrato" e "Comparar" do painel de resposta. */
export function compareSections(tab: RequestTab): ResponseExtraSection[] {
  return [
    { id: 'contract', label: <ContractLabel tab={tab} />, render: () => <ContractView tab={tab} /> },
    { id: 'compare', label: 'Comparar', render: () => <CompareView tab={tab} /> },
  ];
}

function useExamples(tab: RequestTab): ExampleFile[] {
  const snapshot = useSnapshot();
  if (!snapshot || !tab.itemId) return [];
  const node = findNode(snapshot, tab.itemId);
  return node?.kind === 'request' ? node.examples : [];
}

function responseText(response: HttpResponse | null | undefined): string {
  return response?.body.encoding === 'utf8' ? response.body.data : '';
}

// ---------------------------------------------------------------------------
// Contrato

/** Exemplo de referência escolhido por aba (ausente = automático). */
const useChoices = create<{ byTab: Record<string, string>; set(tabId: string, id: string | null): void }>()(
  (set) => ({
    byTab: {},
    set: (tabId, id) =>
      set((s) => {
        const { [tabId]: _old, ...rest } = s.byTab;
        return { byTab: id ? { ...rest, [tabId]: id } : rest };
      }),
  }),
);

function useContract(tab: RequestTab) {
  const examples = useExamples(tab);
  const response = tab.run?.result?.response;
  const choice = useChoices((s) => s.byTab[tab.id] ?? null);
  const setChoice = useChoices((s) => s.set);
  const check = useMemo(
    () =>
      response
        ? checkContract(examples, response.status, responseText(response), choice ?? undefined)
        : undefined,
    [examples, response, choice],
  );
  const choose = (id: string | null) => setChoice(tab.id, id);
  return { examples, response, check, choice, choose };
}

function ContractLabel({ tab }: { tab: RequestTab }) {
  const { check } = useContract(tab);
  const breaking = check?.report.breaking.length ?? 0;
  return (
    <span className="flex items-center gap-1.5">
      Contrato
      {check &&
        (breaking > 0 ? (
          <span className="rounded bg-danger/15 px-1 font-mono text-2xs text-danger">{breaking}</span>
        ) : (
          <CheckCircle2 className="size-3 text-success" strokeWidth={2.5} aria-label="Contrato ok" />
        ))}
    </span>
  );
}

function ContractView({ tab }: { tab: RequestTab }) {
  const { examples, response, check, choice, choose } = useContract(tab);
  if (!response) return null;

  const jsonExamples = examples.filter((e) => tryParseJson(e.response.body));
  if (!tab.itemId || jsonExamples.length === 0) {
    return (
      <EmptyState
        compact
        icon={ShieldCheck}
        title="Sem exemplo para comparar"
        description={
          <>
            Salve uma resposta boa como exemplo (botão <BookmarkPlus className="inline size-3.5" /> Exemplo).
            A partir daí o Rota avisa quando um campo sumir ou mudar de tipo.
          </>
        }
      />
    );
  }

  const options = [
    { value: '', label: 'Automático (mesmo status, mais recente)' },
    ...jsonExamples.map((e) => ({
      value: e.id,
      label: `${e.name} · ${e.response.status}`,
      ...(e.savedAt ? { hint: formatDateTime(e.savedAt) } : {}),
    })),
  ];

  return (
    <div className="space-y-4 p-4 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-fg-muted">Comparar com</span>
        <Select
          value={choice ?? ''}
          options={options}
          onChange={(v) => choose(v || null)}
          ariaLabel="Exemplo de referência"
          triggerClassName="min-w-56"
        />
      </div>

      {!check ? (
        <p className="flex items-start gap-2 text-fg-muted">
          <Info className="mt-0.5 size-4 shrink-0" />
          {tryParseJson(responseText(response))
            ? `Nenhum exemplo com status ${response.status}. Escolha um exemplo acima ou salve esta resposta como exemplo.`
            : 'A resposta não é JSON: a verificação de contrato compara só respostas JSON.'}
        </p>
      ) : (
        <>
          {check.report.breaking.length === 0 ? (
            <p className="flex items-center gap-2 text-success">
              <CheckCircle2 className="size-4" />
              Mesmo formato do exemplo "{check.example.name}": nenhum campo removido ou com tipo diferente.
            </p>
          ) : (
            <IssueList
              tone="danger"
              title={`${check.report.breaking.length} mudança(s) que podem quebrar quem usa esta API`}
              issues={check.report.breaking}
            />
          )}
          {check.report.added.length > 0 && (
            <IssueList tone="info" title="Campos novos (não quebram)" issues={check.report.added} />
          )}
          <p className="text-xs text-fg-subtle">
            Compara a estrutura (campos e tipos) com o exemplo "{check.example.name}", ignorando os valores.
            Campos que já faltavam em algum item do exemplo são tratados como opcionais.
          </p>
        </>
      )}
    </div>
  );
}

function IssueList({
  tone,
  title,
  issues,
}: {
  tone: 'danger' | 'info';
  title: string;
  issues: ContractIssue[];
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        tone === 'danger' ? 'border-danger/40 bg-danger/5' : 'border-border',
      )}
    >
      <p
        className={cn(
          'mb-2 flex items-center gap-2 font-medium',
          tone === 'danger' ? 'text-danger' : 'text-fg',
        )}
      >
        {tone === 'danger' ? <AlertTriangle className="size-4" /> : <Info className="size-4" />}
        {title}
      </p>
      <ul className="space-y-1 text-fg-muted">
        {issues.map((issue) => (
          <li key={`${issue.kind}:${issue.path}`} className="select-text">
            {describeContractIssue(issue)}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparar (diff de texto com um exemplo ou um envio anterior)

interface Side {
  label: string;
  status: number;
  timeMs?: number | undefined;
  sizeBytes?: number | undefined;
  headers: [string, string][];
  body: string;
}

/** Com o que cada aba compara ("example:<id>" ou "history:<id>"); outras features podem escolher. */
const useCompareSources = create<{ byTab: Record<string, string> }>()(() => ({ byTab: {} }));

export function setCompareSource(tabId: string, source: string): void {
  useCompareSources.setState((s) => ({ byTab: { ...s.byTab, [tabId]: source } }));
}

function CompareView({ tab }: { tab: RequestTab }) {
  const examples = useExamples(tab);
  const response = tab.run?.result?.response;
  const [history, setHistory] = useState<HistorySummary[]>([]);
  const source = useCompareSources((s) => s.byTab[tab.id] ?? '');
  const setSource = (value: string) => setCompareSource(tab.id, value);
  const [base, setBase] = useState<Side | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKeys, setSortKeys] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  // biome-ignore lint/correctness/useExhaustiveDependencies: recarrega a lista a cada envio novo
  useEffect(() => {
    if (!tab.itemId) return;
    api
      .invoke('history:list', '', 30, tab.itemId)
      .then(({ items }) => setHistory(items.filter((h) => h.status !== null)))
      .catch(() => setHistory([]));
  }, [tab.itemId, tab.run?.result]);

  useEffect(() => {
    setError(null);
    if (!source) {
      setBase(null);
      return;
    }
    const [kind, id] = source.split(':') as ['example' | 'history', string];
    if (kind === 'example') {
      const e = examples.find((x) => x.id === id);
      setBase(
        e
          ? {
              label: `Exemplo "${e.name}"`,
              status: e.response.status,
              timeMs: e.response.timeMs,
              headers: e.response.headers.map((h) => [h.key, h.value]),
              body: e.response.body,
            }
          : null,
      );
      return;
    }
    let cancelled = false;
    api
      .invoke('history:get', id)
      .then((entry) => {
        const r = entry?.result.response;
        if (cancelled) return;
        if (!entry || !r) {
          setBase(null);
          setError('Esse envio não tem resposta registrada.');
          return;
        }
        setBase({
          label: `Envio de ${formatDateTime(entry.at)}`,
          status: r.status,
          timeMs: r.timings.total,
          sizeBytes: r.sizeBytes,
          headers: r.headers,
          body: responseText(r),
        });
      })
      .catch((e: unknown) => setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [source, examples]);

  if (!response) return null;
  const options = [
    ...examples.map((e) => ({
      value: `example:${e.id}`,
      label: `Exemplo: ${e.name}`,
      hint: String(e.response.status),
    })),
    ...history.map((h) => ({
      value: `history:${h.id}`,
      label: `Envio de ${formatDateTime(h.at)}${h.source === 'mcp' ? ' (Claude)' : ''}`,
      hint: String(h.status),
    })),
  ];
  if (options.length === 0) {
    return (
      <EmptyState
        compact
        icon={GitCompare}
        title="Nada para comparar ainda"
        description="Salve um exemplo ou envie esta requisição mais vezes: dá para comparar com qualquer exemplo ou envio anterior."
      />
    );
  }

  const current: Side = {
    label: 'Resposta atual',
    status: response.status,
    timeMs: response.timings.total,
    sizeBytes: response.sizeBytes,
    headers: response.headers,
    body: responseText(response),
  };

  return (
    <div ref={ref} className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2 text-[13px]">
        <div className="flex items-center gap-2">
          <span className="text-fg-muted">Comparar com</span>
          <Select
            value={source}
            options={[{ value: '', label: 'Escolha um exemplo ou envio…' }, ...options]}
            onChange={setSource}
            ariaLabel="Resposta para comparar"
            triggerClassName="min-w-60"
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox checked={sortKeys} onChange={setSortKeys} label="Ignorar ordem dos campos" />
          <button
            type="button"
            onClick={() => setSortKeys(!sortKeys)}
            className="text-fg-muted hover:text-fg"
          >
            Ignorar ordem dos campos
          </button>
        </div>
      </div>
      {error && <p className="px-4 py-3 text-[13px] text-danger">{error}</p>}
      {base ? (
        <>
          <Summary base={base} current={current} />
          <div className="min-h-0 flex-1">
            <BodyDiff
              original={normalize(base.body, sortKeys)}
              modified={normalize(current.body, sortKeys)}
              language={tryParseJson(current.body) ? 'json' : 'plaintext'}
              sideBySide={width === 0 || width >= 640}
            />
          </div>
        </>
      ) : (
        !error && (
          <p className="px-4 py-6 text-[13px] text-fg-muted">
            Escolha acima um exemplo salvo ou um envio anterior desta requisição.
          </p>
        )
      )}
    </div>
  );
}

/**
 * Diff do corpo. Os modelos ficam com o componente (keepCurrent*Model) e são
 * descartados depois que o editor sai da tela: descartá-los antes, como o
 * @monaco-editor/react faz por padrão, gera erro no Monaco.
 */
function BodyDiff({
  original,
  modified,
  language,
  sideBySide,
}: {
  original: string;
  modified: string;
  language: string;
  sideBySide: boolean;
}) {
  const ref = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  useEffect(
    () => () => {
      const models = ref.current?.getModel();
      ref.current = null;
      if (!models) return;
      setTimeout(() => {
        models.original.dispose();
        models.modified.dispose();
      }, 0);
    },
    [],
  );
  return (
    <DiffEditor
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={(editor) => {
        ref.current = editor;
      }}
      original={original}
      modified={modified}
      language={language}
      theme={ROTA_THEME}
      loading={<div className="p-4 text-xs text-fg-subtle">Carregando…</div>}
      options={{
        readOnly: true,
        originalEditable: false,
        renderSideBySide: sideBySide,
        minimap: { enabled: false },
        fontFamily: "'JetBrains Mono Variable', Consolas, monospace",
        fontSize: 13,
        lineHeight: 20,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: 'on',
        renderOverviewRuler: false,
        hideUnchangedRegions: { enabled: true },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      }}
    />
  );
}

function Summary({ base, current }: { base: Side; current: Side }) {
  const headerChanges = diffHeaders(base.headers, current.headers);
  const cell = (side: Side) => (
    <div className="min-w-0">
      <p className="truncate text-xs text-fg-muted">{side.label}</p>
      <p className="font-mono text-xs">
        <span className={side.status >= 400 ? 'text-danger' : 'text-success'}>{side.status}</span>
        {side.timeMs !== undefined && <span className="text-fg-muted"> · {formatDuration(side.timeMs)}</span>}
        {side.sizeBytes !== undefined && (
          <span className="text-fg-muted"> · {formatBytes(side.sizeBytes)}</span>
        )}
      </p>
    </div>
  );
  return (
    <div className="shrink-0 space-y-2 border-b border-border px-4 py-2">
      <div className="grid grid-cols-2 gap-4">
        {cell(base)}
        {cell(current)}
      </div>
      {headerChanges.length > 0 && (
        <details className="text-xs text-fg-muted">
          <summary className="cursor-pointer select-none">
            {headerChanges.length} header(s) diferente(s)
          </summary>
          <ul className="mt-1 space-y-0.5 font-mono">
            {headerChanges.map((c) => (
              <li key={c.key} className="select-text break-all">
                <span className="text-fg">{c.key}</span>: {c.before ?? '—'} → {c.after ?? '—'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Headers que mudam a cada envio não interessam na comparação. */
const VOLATILE_HEADERS = new Set([
  'date',
  'x-request-id',
  'etag',
  'age',
  'expires',
  'last-modified',
  'set-cookie',
]);

function diffHeaders(before: [string, string][], after: [string, string][]) {
  const toMap = (list: [string, string][]) => {
    const map = new Map<string, string>();
    for (const [k, v] of list) {
      const key = k.toLowerCase();
      if (!VOLATILE_HEADERS.has(key)) map.set(key, map.has(key) ? `${map.get(key)}, ${v}` : v);
    }
    return map;
  };
  const a = toMap(before);
  const b = toMap(after);
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  return keys
    .filter((k) => a.get(k) !== b.get(k))
    .map((key) => ({ key, before: a.get(key), after: b.get(key) }));
}

/** JSON formatado (e com campos em ordem alfabética, se pedido) para o diff não acusar só formatação. */
function normalize(body: string, sortKeys: boolean): string {
  const trimmed = body.trim();
  return (sortKeys ? formatJsonSorted(trimmed) : formatJson(trimmed)) ?? body;
}
