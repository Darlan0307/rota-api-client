import * as Popover from '@radix-ui/react-popover';
import {
  findJsonTables,
  formatJsonPath,
  type HttpResponse,
  type JsonPath,
  jsonPathAtOffset,
  type ResponseTimings,
  valueAtPath,
} from '@rota/core/shared';
import { AlertTriangle, Copy, LoaderCircle, Search, Send, Variable, WrapText, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { CodeEditor, type EditorLanguage } from '../../components/CodeEditor';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { Kbd } from '../../components/Kbd';
import { TabStrip } from '../../components/TabStrip';
import { cn } from '../../lib/cn';
import { formatBytes, formatDuration, statusTone } from '../../lib/format';
import type { monaco } from '../../lib/monaco';
import { cancelRequest } from '../../state/actions';
import type { RequestTab, ResponseSection } from '../../state/tabs';
import { useTabs } from '../../state/tabs';
import { toast } from '../../state/toasts';
import { JsonTable } from './JsonTable';
import { openSaveToVariable, variableText } from './SaveToVariableDialog';

type BodyView = 'pretty' | 'raw' | 'preview' | 'table';

/** Campo do JSON selecionado (cursor no editor ou célula da tabela). */
interface FieldSelection {
  path: JsonPath;
  value: unknown;
}

const NOT_JSON = Symbol('not-json');

const MAX_PRETTY_BYTES = 5 * 1024 * 1024;

export function ResponsePane({
  tab,
  extraSections,
  actions,
}: {
  tab: RequestTab;
  extraSections?: ResponseExtraSection[];
  /** Ações extras no cabeçalho da resposta (ex.: salvar como exemplo). */
  actions?: ReactNode;
}) {
  const run = tab.run;
  const result = run?.result;
  const sending = run?.status === 'sending';

  return (
    <section className="flex h-full min-w-0 flex-col bg-bg" aria-label="Resposta">
      {sending && !result ? (
        <Sending startedAt={run.startedAt} onCancel={() => cancelRequest(tab.id)} />
      ) : !result ? (
        <EmptyState
          icon={Send}
          title="Nenhuma resposta ainda"
          description={
            <span className="inline-flex flex-wrap items-center justify-center gap-1">
              Envie a requisição com <Kbd keys="Ctrl+Enter" /> para ver status, tempo, headers e body.
            </span>
          }
        />
      ) : result.error && !result.response ? (
        <ErrorView message={result.error.message} detail={result.error.detail} code={result.error.code} />
      ) : result.response ? (
        <ResponseView
          tab={tab}
          response={result.response}
          sending={sending}
          extraSections={extraSections ?? []}
          actions={actions}
        />
      ) : null}
    </section>
  );
}

/** Seções extras do painel (testes, console) adicionadas em fases futuras. */
export interface ResponseExtraSection {
  id: ResponseSection;
  label: ReactNode;
  render: () => ReactNode;
}

function Sending({ startedAt, onCancel }: { startedAt: number; onCancel: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 animate-fade-in">
      <LoaderCircle className="size-7 animate-spin text-primary" strokeWidth={1.75} />
      <div className="text-center">
        <p className="text-sm font-medium">Enviando…</p>
        <p className="mt-1 font-mono text-xs text-fg-muted">{formatDuration(now - startedAt)}</p>
      </div>
      <Button size="sm" onClick={onCancel}>
        Cancelar
      </Button>
    </div>
  );
}

function ErrorView({
  message,
  detail,
  code,
}: {
  message: string;
  detail?: string | undefined;
  code: string;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8 animate-fade-in">
      <div className="max-w-lg rounded-xl border border-danger/40 bg-danger/5 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" strokeWidth={1.75} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">
              {code === 'aborted' ? 'Requisição cancelada' : 'Não foi possível obter uma resposta'}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{message}</p>
            {detail && detail !== message && (
              <pre className="mt-3 max-h-40 select-text overflow-auto whitespace-pre-wrap rounded-md bg-bg p-2 font-mono text-2xs text-fg-subtle">
                {detail}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function headerValue(response: HttpResponse, name: string): string | undefined {
  return response.headers.find(([k]) => k.toLowerCase() === name)?.[1];
}

function languageFor(contentType: string | undefined, text: string): EditorLanguage {
  const ct = contentType?.toLowerCase() ?? '';
  if (ct.includes('json')) return 'json';
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('html')) return 'html';
  if (ct.includes('javascript')) return 'javascript';
  if (ct.includes('css')) return 'css';
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (trimmed.startsWith('<')) return 'xml';
  return 'plaintext';
}

function ResponseView({
  tab,
  response,
  sending,
  extraSections,
  actions,
}: {
  tab: RequestTab;
  response: HttpResponse;
  sending: boolean;
  extraSections: ResponseExtraSection[];
  actions: ReactNode;
}) {
  const update = useTabs((s) => s.update);
  const section = tab.responseSection;
  const setSection = (responseSection: ResponseSection) =>
    update<RequestTab>(tab.id, (t) => ({ ...t, responseSection }));
  const [view, setView] = useState<BodyView>('pretty');
  const [wrap, setWrap] = useState(true);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const contentType = headerValue(response, 'content-type');
  const isImage = response.body.encoding === 'base64' && /^image\//i.test(contentType ?? '');
  const text = response.body.encoding === 'utf8' ? response.body.data : '';
  const language = languageFor(contentType, text);

  const parsed = useMemo((): unknown => {
    if (language !== 'json' || text.length > MAX_PRETTY_BYTES) return NOT_JSON;
    try {
      return JSON.parse(text);
    } catch {
      return NOT_JSON;
    }
  }, [text, language]);
  const isJson = parsed !== NOT_JSON;
  const pretty = useMemo(() => (isJson ? JSON.stringify(parsed, null, 2) : text), [parsed, isJson, text]);
  const tables = useMemo(() => (isJson ? findJsonTables(parsed) : []), [parsed, isJson]);
  const views: BodyView[] = [
    'pretty',
    'raw',
    ...(tables.length > 0 ? (['table'] as const) : []),
    ...(isImage ? (['preview'] as const) : []),
  ];
  const currentView = views.includes(view) ? view : 'pretty';

  // Campo selecionado: vale para a resposta e a visualização atuais.
  const [selection, setSelection] = useState<FieldSelection | null>(null);
  const parsedRef = useRef(parsed);
  parsedRef.current = parsed;
  // biome-ignore lint/correctness/useExhaustiveDependencies: limpa a seleção quando a resposta ou a visualização mudam
  useEffect(() => setSelection(null), [response, currentView]);

  function selectAtCursor(editor: monaco.editor.IStandaloneCodeEditor): FieldSelection | null {
    const model = editor.getModel();
    const position = editor.getPosition();
    const data = parsedRef.current;
    if (!model || !position || data === NOT_JSON) return null;
    const path = jsonPathAtOffset(model.getValue(), model.getOffsetAt(position));
    return path && path.length > 0 ? { path, value: valueAtPath(data, path) } : null;
  }

  const saveSelection = (field: FieldSelection | null) => {
    if (field) openSaveToVariable({ tabId: tab.id, path: field.path, value: field.value });
  };

  function handleEditor(editor: monaco.editor.IStandaloneCodeEditor) {
    editorRef.current = editor;
    if (!isJson) return;
    editor.onDidChangeCursorPosition((e) => {
      if (e.source === 'mouse' || e.source === 'keyboard') setSelection(selectAtCursor(editor));
    });
    editor.addAction({
      id: 'rota.saveToVariable',
      label: 'Salvar em variável…',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 0,
      run: () => saveSelection(selectAtCursor(editor)),
    });
  }

  const sections: { id: ResponseSection; label: ReactNode }[] = [
    { id: 'body', label: 'Body' },
    {
      id: 'headers',
      label: (
        <>
          Headers <Count n={response.headers.length} />
        </>
      ),
    },
    ...extraSections.map(({ id, label }) => ({ id, label })),
  ];

  const tone = statusTone(response.status);

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      {/* Em painéis estreitos, status/tempo/tamanho descem para uma segunda linha. */}
      <div className="flex shrink-0 flex-col border-b border-border @3xl:h-10 @3xl:flex-row @3xl:items-center @3xl:gap-4 @3xl:px-4">
        <TabStrip
          activeKey={section}
          className="h-10 shrink-0 items-stretch gap-4 px-4 @3xl:h-full @3xl:flex-1 @3xl:shrink @3xl:px-0"
        >
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={section === s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                'relative flex h-full shrink-0 items-center gap-1.5 text-[13px] transition-colors',
                section === s.id ? 'text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {s.label}
              {section === s.id && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </TabStrip>
        <div className="flex h-9 shrink-0 items-center justify-end gap-3 border-t border-border/60 px-4 @3xl:h-auto @3xl:border-0 @3xl:px-0">
          {actions}
          {sending && <LoaderCircle className="size-3.5 animate-spin text-primary" />}
          <div className="flex shrink-0 items-center gap-3 whitespace-nowrap text-xs">
            <span
              className={cn(
                'font-mono font-semibold',
                tone === 'success' && 'text-success',
                tone === 'warning' && 'text-warning',
                tone === 'danger' && 'text-danger',
                tone === 'muted' && 'text-fg-muted',
              )}
            >
              {response.status} {response.statusText}
            </span>
            <TimingsPopover timings={response.timings} />
            <span className="font-mono text-fg-muted" title={`${response.sizeBytes} bytes`}>
              {formatBytes(response.sizeBytes)}
              {response.truncated && <span className="text-warning"> (truncado)</span>}
            </span>
          </div>
        </div>
      </div>

      {section === 'body' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-center gap-1 px-3">
            {views.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  'h-6 rounded px-2 text-xs transition-colors',
                  currentView === v ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {{ pretty: 'Formatado', raw: 'Raw', preview: 'Visualizar', table: 'Tabela' }[v]}
              </button>
            ))}
            <div className="flex-1" />
            <IconButton
              icon={WrapText}
              label="Quebra de linha"
              size="sm"
              active={wrap}
              onClick={() => setWrap((w) => !w)}
            />
            <IconButton
              icon={Search}
              label="Buscar na resposta"
              shortcut="Ctrl+F"
              size="sm"
              onClick={() => {
                editorRef.current?.focus();
                editorRef.current?.getAction('actions.find')?.run();
              }}
            />
            <IconButton
              icon={Copy}
              label="Copiar body"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(currentView === 'pretty' ? pretty : text);
                toast.success('Body copiado.');
              }}
            />
          </div>
          <div className="min-h-0 flex-1 border-t border-border">
            {response.body.encoding === 'base64' && !isImage ? (
              <EmptyState
                compact
                icon={AlertTriangle}
                title="Resposta binária"
                description={`${contentType ?? 'Tipo desconhecido'} · ${formatBytes(response.sizeBytes)}. Não é possível exibir como texto.`}
              />
            ) : currentView === 'table' ? (
              <JsonTable
                value={parsed}
                tables={tables}
                name={tab.title}
                selectedPath={selection?.path ?? null}
                onSelect={(path, value) => setSelection({ path, value })}
              />
            ) : currentView === 'preview' && isImage ? (
              <div className="flex h-full items-center justify-center overflow-auto p-4">
                <img
                  src={`data:${contentType};base64,${response.body.data}`}
                  alt="Pré-visualização da resposta"
                  className="max-h-full max-w-full rounded border border-border"
                />
              </div>
            ) : (
              <CodeEditor
                key={currentView}
                value={currentView === 'pretty' ? pretty : text}
                language={currentView === 'pretty' ? language : 'plaintext'}
                readOnly
                wordWrap={wrap}
                onEditor={handleEditor}
              />
            )}
          </div>
          {selection && (
            <SelectionBar
              selection={selection}
              onSave={() => saveSelection(selection)}
              onClear={() => setSelection(null)}
            />
          )}
        </div>
      )}

      {section === 'headers' && <HeadersTable headers={response.headers} />}
      {extraSections.find((s) => s.id === section)?.render()}
    </div>
  );
}

/** Barra do campo selecionado: caminho, valor e ações. */
function SelectionBar({
  selection,
  onSave,
  onClear,
}: {
  selection: FieldSelection;
  onSave: () => void;
  onClear: () => void;
}) {
  const value = variableText(selection.value);
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border bg-surface px-3 text-xs animate-fade-in">
      <span
        className="min-w-0 max-w-[40%] shrink-0 truncate font-mono text-fg-muted"
        title={formatJsonPath(selection.path)}
      >
        {formatJsonPath(selection.path)}
      </span>
      <span
        className="min-w-0 flex-1 truncate font-mono text-fg"
        title={value.length > 60 ? value : undefined}
      >
        {value === '' ? '(vazio)' : value}
      </span>
      <IconButton
        icon={Copy}
        label="Copiar valor"
        size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast.success('Valor copiado.');
        }}
      />
      <Button size="sm" onClick={onSave} className="shrink-0">
        <Variable className="size-3.5" /> Salvar em variável
      </Button>
      <IconButton icon={X} label="Limpar seleção" size="sm" onClick={onClear} />
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="rounded bg-surface-2 px-1 font-mono text-2xs text-fg-muted">{n}</span>;
}

function HeadersTable({ headers }: { headers: [string, string][] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <table className="w-full select-text text-xs">
        <tbody>
          {headers.map(([k, v], i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: headers podem se repetir (set-cookie)
            <tr key={i} className="border-b border-border last:border-0">
              <td className="w-1/3 py-1.5 pr-4 align-top font-mono text-fg-muted">{k}</td>
              <td className="break-all py-1.5 font-mono text-fg">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PHASES: { key: keyof ResponseTimings; label: string; className: string }[] = [
  { key: 'dns', label: 'DNS', className: 'bg-method-head' },
  { key: 'tcp', label: 'Conexão TCP', className: 'bg-method-put' },
  { key: 'tls', label: 'Handshake TLS', className: 'bg-method-patch' },
  { key: 'ttfb', label: 'Aguardando resposta (TTFB)', className: 'bg-method-post' },
  { key: 'download', label: 'Download', className: 'bg-method-get' },
];

function TimingsPopover({ timings }: { timings: ResponseTimings }) {
  // O TTFB medido inclui a conexão; aqui mostramos só a espera do servidor.
  const connect = (timings.dns ?? 0) + (timings.tcp ?? 0) + (timings.tls ?? 0);
  const phases = {
    ...timings,
    ttfb: Math.max(0, timings.ttfb - connect),
  };
  const total = timings.total || 1;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="font-mono text-fg-muted underline decoration-dotted underline-offset-4 hover:text-fg"
        >
          {formatDuration(timings.total)}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 rounded-lg border border-border bg-elevated p-4 text-xs shadow-xl shadow-black/40 animate-pop-in"
        >
          <p className="mb-3 font-medium text-fg">Tempo por fase</p>
          <div className="space-y-2">
            {PHASES.map(({ key, label, className }) => {
              const value = phases[key];
              if (value === undefined) return null;
              return (
                <div key={key}>
                  <div className="flex justify-between text-fg-muted">
                    <span>{label}</span>
                    <span className="font-mono text-fg">{formatDuration(value)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={cn('h-full rounded-full', className)}
                      style={{ width: `${Math.max(1, (value / total) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex justify-between border-t border-border pt-2 font-medium">
            <span>Total</span>
            <span className="font-mono">{formatDuration(timings.total)}</span>
          </div>
          {timings.dns === undefined && (
            <p className="mt-2 text-2xs text-fg-subtle">DNS/TCP/TLS não disponíveis (conexão via proxy).</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
