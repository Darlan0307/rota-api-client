import * as Popover from '@radix-ui/react-popover';
import type { HttpResponse, ResponseTimings } from '@rota/core/shared';
import { AlertTriangle, Copy, LoaderCircle, Search, Send, WrapText } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { CodeEditor, type EditorLanguage } from '../../components/CodeEditor';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { Kbd } from '../../components/Kbd';
import { cn } from '../../lib/cn';
import { formatBytes, formatDuration, statusTone } from '../../lib/format';
import type { monaco } from '../../lib/monaco';
import { cancelRequest } from '../../state/actions';
import type { RequestTab, ResponseSection } from '../../state/tabs';
import { useTabs } from '../../state/tabs';
import { toast } from '../../state/toasts';

type BodyView = 'pretty' | 'raw' | 'preview';

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

  const pretty = useMemo(() => {
    if (language !== 'json' || text.length > MAX_PRETTY_BYTES) return text;
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }, [text, language]);

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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-4 border-b border-border px-4">
        <div role="tablist" className="flex min-w-0 items-center gap-4 self-stretch overflow-x-auto">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={section === s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                'relative flex h-full items-center gap-1.5 text-[13px] transition-colors',
                section === s.id ? 'text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {s.label}
              {section === s.id && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>
        <div className="flex-1" />
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

      {section === 'body' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-center gap-1 px-3">
            {(['pretty', 'raw', ...(isImage ? (['preview'] as const) : [])] as BodyView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  'h-6 rounded px-2 text-xs transition-colors',
                  view === v ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {{ pretty: 'Formatado', raw: 'Raw', preview: 'Visualizar' }[v]}
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
                void navigator.clipboard.writeText(view === 'pretty' ? pretty : text);
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
            ) : view === 'preview' && isImage ? (
              <div className="flex h-full items-center justify-center overflow-auto p-4">
                <img
                  src={`data:${contentType};base64,${response.body.data}`}
                  alt="Pré-visualização da resposta"
                  className="max-h-full max-w-full rounded border border-border"
                />
              </div>
            ) : (
              <CodeEditor
                key={view}
                value={view === 'pretty' ? pretty : text}
                language={view === 'pretty' ? language : 'plaintext'}
                readOnly
                wordWrap={wrap}
                onEditor={(editor) => {
                  editorRef.current = editor;
                }}
              />
            )}
          </div>
        </div>
      )}

      {section === 'headers' && <HeadersTable headers={response.headers} />}
      {extraSections.find((s) => s.id === section)?.render()}
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
