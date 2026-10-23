import {
  applyUrlText,
  findWebhookProvider,
  HTTP_METHODS,
  joinUrl,
  type RequestData,
  type SignatureCheck,
  type TunnelBody,
  type TunnelConfig,
  type TunnelExchange,
  type TunnelExchangeSummary,
  type TunnelView as TunnelViewData,
  type WebhookProviderId,
} from '@rota/core/shared';
import {
  ArrowRight,
  BookmarkPlus,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  LoaderCircle,
  PenLine,
  Play,
  Radio,
  RotateCcw,
  Send,
  Square,
  Trash2,
  Unplug,
  Zap,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { CodeEditor } from '../../components/CodeEditor';
import { EmptyState } from '../../components/EmptyState';
import { Checkbox, TextInput } from '../../components/form';
import { IconButton } from '../../components/IconButton';
import { MethodBadge } from '../../components/MethodBadge';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatBytes, formatDuration, statusTone } from '../../lib/format';
import type { HttpMethod } from '../../lib/http-method';
import { confirmDialog } from '../../state/dialogs';
import { type TunnelTab, useTabs } from '../../state/tabs';
import { toast } from '../../state/toasts';
import {
  clearExchanges,
  installCloudflared,
  openSimulator,
  removeTunnel,
  replayExchange,
  saveWebhookEvent,
  selectExchange,
  startTunnel,
  stopTunnel,
  testTunnel,
  updateTunnel,
  useTunnel,
  useTunnels,
} from './state';
import { openTunnelGuide, TunnelDiagram } from './TunnelGuide';
import { STATUS_LABEL, StatusDot } from './TunnelsPanel';

function copy(text: string, message: string) {
  void navigator.clipboard.writeText(text);
  toast.success(message);
}

/** Página de um túnel: destino, URL pública e chamadas recebidas. */
export function TunnelTabView({ tab }: { tab: TunnelTab }) {
  const view = useTunnel(tab.itemId);
  const loaded = useTunnels((s) => s.loaded);
  const update = useTabs((s) => s.update);

  // O título da aba acompanha o nome do túnel.
  const name = view?.config.name;
  useEffect(() => {
    if (name && name !== tab.title) update<TunnelTab>(tab.id, (t) => ({ ...t, title: name }));
  }, [name, tab.id, tab.title, update]);

  // Ao abrir o app, a lista ainda está chegando do processo principal.
  if (!view && !loaded) return null;
  if (!view)
    return (
      <EmptyState icon={Unplug} title="Túnel não encontrado" description="Ele pode ter sido excluído." />
    );

  return (
    <div className="@container flex h-full min-h-0 flex-col overflow-y-auto bg-bg">
      <Header view={view} />
      <div className="grid shrink-0 gap-4 px-5 pb-5 @4xl:grid-cols-2">
        <TargetCard config={view.config} />
        <PublicUrlCard view={view} />
      </div>
      <Inspector view={view} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cabeçalho

function Header({ view }: { view: TunnelViewData }) {
  const { config, status } = view;
  const [name, setName] = useState(config.name);
  useEffect(() => setName(config.name), [config.name]);
  const on = status === 'running' || status === 'starting';

  async function remove() {
    const choice = await confirmDialog({
      title: `Excluir o túnel "${config.name}"?`,
      description: on
        ? 'Ele será desligado e a URL pública deixa de funcionar.'
        : 'A configuração será apagada.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (choice === 'confirm') await removeTunnel(config.id);
  }

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 px-5">
      <StatusDot status={status} />
      <input
        value={name}
        aria-label="Nome do túnel"
        spellCheck={false}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim() === '') setName(config.name);
          else if (name.trim() !== config.name) void updateTunnel(config.id, { name });
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[15px] font-semibold text-fg outline-none hover:border-border focus:border-primary"
      />
      <span className="hidden shrink-0 text-xs text-fg-muted @2xl:inline">{STATUS_LABEL[status]}</span>
      <Button size="sm" variant="ghost" onClick={openTunnelGuide}>
        <CircleHelp className="size-3.5" /> Como usar
      </Button>
      <IconButton icon={Trash2} label="Excluir túnel" size="sm" onClick={() => void remove()} />
      <Button
        size="sm"
        variant={on ? 'secondary' : 'primary'}
        onClick={() => void (on ? stopTunnel(config.id) : startTunnel(config.id))}
        title={status === 'starting' ? 'Cancelar a criação do túnel' : undefined}
        className="min-w-24"
      >
        {status === 'starting' ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : on ? (
          <Square className="size-3.5" />
        ) : (
          <Play className="size-3.5" />
        )}
        {status === 'starting' ? 'Cancelar' : on ? 'Desligar' : 'Ligar'}
      </Button>
    </div>
  );
}

function Card({ title, step, children }: { title: string; step: number; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface p-4">
      <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-fg">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary-soft font-mono text-2xs text-primary">
          {step}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Destino local

function TargetCard({ config }: { config: TunnelConfig }) {
  const [target, setTarget] = useState(config.target);
  const [captureStatus, setCaptureStatus] = useState(String(config.captureStatus));
  const [captureBody, setCaptureBody] = useState(config.captureBody);
  useEffect(() => setTarget(config.target), [config.target]);
  useEffect(() => setCaptureStatus(String(config.captureStatus)), [config.captureStatus]);
  useEffect(() => setCaptureBody(config.captureBody), [config.captureBody]);

  const commitTarget = async () => {
    if (target.trim() === config.target) return;
    // Destino inválido: volta ao valor salvo (o aviso explica o formato).
    if (!(await updateTunnel(config.id, { target }))) setTarget(config.target);
  };

  return (
    <Card step={1} title="Para onde vão as chamadas">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-fg-muted">Sua API local</span>
          <TextInput
            mono
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onBlur={() => void commitTarget()}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="3000 ou http://localhost:8080/api"
          />
          <p className="text-xs text-fg-subtle">
            Porta ou endereço. Pode trocar com o túnel ligado: a URL pública continua a mesma.
          </p>
        </div>

        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-fg-muted">Ao receber uma chamada</span>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1">
            {(
              [
                ['forward', 'Repassar para a API'],
                ['capture', 'Só capturar'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => mode !== config.mode && void updateTunnel(config.id, { mode })}
                className={cn(
                  'h-7 rounded-md text-xs transition-colors',
                  config.mode === mode
                    ? 'bg-elevated font-medium text-fg shadow-sm'
                    : 'text-fg-muted hover:text-fg',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-fg-subtle">
            {config.mode === 'forward'
              ? 'Cada chamada vai para a sua API, e a resposta dela volta para o serviço.'
              : 'A API não é chamada: o Rota responde sozinho e guarda a chamada para você reenviar depois.'}
          </p>
        </div>

        {config.mode === 'capture' && (
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
            <div className="space-y-1">
              <span className="block text-2xs text-fg-subtle">Status</span>
              <TextInput
                mono
                inputMode="numeric"
                aria-label="Status da resposta"
                value={captureStatus}
                onChange={(e) => setCaptureStatus(e.target.value.replace(/\D/g, '').slice(0, 3))}
                onBlur={async () => {
                  if (Number(captureStatus) === config.captureStatus) return;
                  if (!(await updateTunnel(config.id, { captureStatus: Number(captureStatus) })))
                    setCaptureStatus(String(config.captureStatus));
                }}
              />
            </div>
            <div className="space-y-1">
              <span className="block text-2xs text-fg-subtle">Corpo da resposta</span>
              <TextInput
                mono
                aria-label="Corpo da resposta"
                value={captureBody}
                onChange={(e) => setCaptureBody(e.target.value)}
                onBlur={() =>
                  captureBody !== config.captureBody && void updateTunnel(config.id, { captureBody })
                }
              />
            </div>
          </div>
        )}

        {config.mode === 'forward' && (
          <div className="flex items-start gap-2.5">
            <Checkbox
              checked={config.preserveHost}
              onChange={(preserveHost) => void updateTunnel(config.id, { preserveHost })}
              label="Manter o Host público"
              className="mt-0.5"
            />
            <div className="text-xs">
              <button
                type="button"
                onClick={() => void updateTunnel(config.id, { preserveHost: !config.preserveHost })}
                className="text-left text-fg"
              >
                Manter o Host público
              </button>
              <p className="text-fg-subtle">
                Só se a sua API depender do domínio público. Por padrão ela recebe o Host local e o público
                vai em X-Forwarded-Host.
              </p>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// URL pública

function PublicUrlCard({ view }: { view: TunnelViewData }) {
  const { config, status, publicUrl, error, logs } = view;
  const binary = useTunnels((s) => s.binary);
  const download = useTunnels((s) => s.download);
  const [path, setPath] = useState(config.webhookPath);
  useEffect(() => setPath(config.webhookPath), [config.webhookPath]);
  const fullUrl = publicUrl ? joinUrl(publicUrl, path) : null;
  const arrives = joinUrl(config.target, path);

  let content: ReactNode;
  if (download) {
    const pct = download.total ? Math.round((download.received / download.total) * 100) : null;
    content = (
      <div className="space-y-2">
        <p className="text-xs text-fg-muted">
          Baixando o cloudflared… {formatBytes(download.received)}
          {download.total ? ` de ${formatBytes(download.total)}` : ''}
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className={cn(
              'h-full rounded-full bg-primary transition-[width]',
              pct === null && 'w-1/3 animate-pulse',
            )}
            style={pct !== null ? { width: `${pct}%` } : undefined}
          />
        </div>
      </div>
    );
  } else if (binary && !binary.installed && status !== 'running') {
    content = (
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-fg-muted">
          Para criar a URL pública, o Rota usa o <b>cloudflared</b>, programa gratuito e oficial da Cloudflare
          (cerca de 60 MB, sem cadastro). Ele fica em %APPDATA%\Rota\bin.
        </p>
        <Button size="sm" variant="primary" onClick={() => void installCloudflared()}>
          <Download className="size-3.5" /> Baixar o cloudflared
        </Button>
      </div>
    );
  } else if (status === 'starting') {
    content = (
      <div className="flex items-center gap-2.5 text-xs text-fg-muted">
        <LoaderCircle className="size-4 animate-spin text-primary" />
        Criando a URL https e conectando à Cloudflare (alguns segundos)…
      </div>
    );
  } else if (status === 'running' && publicUrl && fullUrl) {
    content = (
      <div className="space-y-3">
        <CopyRow label="URL base" value={publicUrl} />
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-fg-muted">Caminho do webhook na sua API</span>
          <TextInput
            mono
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onBlur={() => path !== config.webhookPath && void updateTunnel(config.id, { webhookPath: path })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="/webhooks/stripe"
          />
        </div>
        <div className="rounded-lg border border-primary/40 bg-primary-soft/40 p-2.5">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 select-text break-all font-mono text-xs text-fg">{fullUrl}</code>
            <Button size="sm" variant="primary" onClick={() => copy(fullUrl, 'URL do webhook copiada.')}>
              <Copy className="size-3.5" /> Copiar
            </Button>
          </div>
          <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-2xs text-fg-subtle">
            <ArrowRight className="size-3 shrink-0" />
            <span className="truncate">
              {config.mode === 'forward' ? (
                <>
                  chega em <span className="font-mono text-fg-muted">{arrives}</span>
                </>
              ) : (
                'só capturar: o Rota responde sem chamar a API'
              )}
            </span>
          </p>
        </div>
        <Button size="sm" onClick={() => void testTunnel(config.id, path)}>
          <Send className="size-3.5" /> Testar agora
        </Button>
      </div>
    );
  } else {
    content = (
      <div className="space-y-3">
        {status === 'error' && error && (
          <div className="rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-xs text-fg">{error}</div>
        )}
        <p className="text-xs text-fg-muted">
          Ligue o túnel para gerar o endereço https. Ele vale enquanto o túnel estiver ligado.
        </p>
        <TunnelDiagram target={config.target.replace(/^https?:\/\//, '')} />
      </div>
    );
  }

  return (
    <Card step={2} title="Endereço público">
      {content}
      {logs.length > 0 && (
        <details className="mt-3 text-2xs text-fg-subtle">
          <summary className="cursor-pointer select-none hover:text-fg-muted">Log do cloudflared</summary>
          <pre className="mt-1.5 max-h-40 select-text overflow-auto whitespace-pre-wrap rounded-md bg-bg p-2 font-mono">
            {logs.join('\n')}
          </pre>
        </details>
      )}
    </Card>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="shrink-0 text-fg-muted">{label}</span>
      <code className="min-w-0 flex-1 select-text truncate font-mono text-fg">{value}</code>
      <IconButton
        icon={Copy}
        label={`Copiar ${label.toLowerCase()}`}
        size="sm"
        onClick={() => copy(value, `${label} copiada.`)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chamadas recebidas

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR');
}

function StatusText({ exchange }: { exchange: Pick<TunnelExchange, 'status' | 'error'> }) {
  if (exchange.status === undefined)
    return <span className="font-mono text-2xs font-semibold text-danger">sem resposta</span>;
  const tone = statusTone(exchange.status);
  return (
    <span
      className={cn(
        'font-mono text-2xs font-semibold',
        tone === 'success' && 'text-success',
        tone === 'warning' && 'text-warning',
        tone === 'danger' && 'text-danger',
        tone === 'muted' && 'text-fg-muted',
      )}
    >
      {exchange.status}
    </span>
  );
}

function asMethod(method: string): HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(method) ? (method as HttpMethod) : 'POST';
}

function Inspector({ view }: { view: TunnelViewData }) {
  const { config, exchanges } = view;
  const selectedId = useTunnels((s) => s.selected[config.id]);
  const setSelectedId = (id: string) => selectExchange(config.id, id);
  const selected = exchanges.find((e) => e.id === selectedId) ?? exchanges[0] ?? null;

  return (
    <section className="flex min-h-[340px] flex-1 flex-col border-t border-border">
      <div className="flex h-10 shrink-0 items-center gap-2 px-5">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-fg">
          <span className="flex size-5 items-center justify-center rounded-full bg-primary-soft font-mono text-2xs text-primary">
            3
          </span>
          Chamadas recebidas
          {exchanges.length > 0 && (
            <span className="rounded bg-surface-2 px-1 font-mono text-2xs text-fg-muted">
              {exchanges.length}
            </span>
          )}
        </h3>
        <div className="flex-1" />
        {exchanges.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => void clearExchanges(config.id)}>
            Limpar
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => openSimulator({ tunnelId: config.id })}
          title="Envia um evento de exemplo, assinado como o provedor faria, direto para a sua API"
        >
          <Zap className="size-3.5" /> Simular webhook
        </Button>
      </div>

      {exchanges.length === 0 ? (
        <div className="flex flex-1 items-center justify-center border-t border-border p-6">
          <div className="max-w-sm text-center">
            <Radio className="mx-auto mb-3 size-6 text-fg-subtle" strokeWidth={1.5} />
            <p className="text-[13px] font-medium text-fg">Nenhuma chamada ainda</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">
              {view.status === 'running'
                ? 'Dispare o webhook no serviço ou use "Testar agora". Cada chamada aparece aqui na hora.'
                : 'Ligue o túnel, cole a URL no serviço e as chamadas aparecem aqui. Sem o serviço por perto, use "Simular webhook".'}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 border-t border-border @3xl:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
          <ul className="max-h-60 overflow-y-auto border-b border-border @3xl:max-h-none @3xl:border-b-0 @3xl:border-r">
            {exchanges.map((e) => (
              <ExchangeRow
                key={e.id}
                exchange={e}
                selected={selected?.id === e.id}
                onSelect={() => setSelectedId(e.id)}
              />
            ))}
          </ul>
          {selected && (
            <ExchangeDetail
              key={selected.id}
              tunnelId={config.id}
              target={config.target}
              provider={config.webhook.provider}
              summary={selected}
              onReplayed={(id) => setSelectedId(id)}
            />
          )}
        </div>
      )}
    </section>
  );
}

function ExchangeRow({
  exchange,
  selected,
  onSelect,
}: {
  exchange: TunnelExchangeSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left transition-colors',
          selected ? 'bg-surface-2' : 'hover:bg-surface/70',
        )}
      >
        <MethodBadge method={asMethod(exchange.method)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs text-fg">{exchange.path}</span>
          <span className="flex items-center gap-1.5 text-2xs text-fg-subtle">
            {timeOf(exchange.at)} · {formatDuration(exchange.durationMs)}
            {exchange.replay && <span className="rounded bg-surface-2 px-1 text-fg-muted">reenvio</span>}
            {exchange.simulated && (
              <span className="truncate rounded bg-primary-soft px-1 text-primary" title={exchange.simulated}>
                simulado
              </span>
            )}
            {exchange.mode === 'capture' && (
              <span className="rounded bg-surface-2 px-1 text-fg-muted">capturada</span>
            )}
          </span>
        </span>
        <StatusText exchange={exchange} />
      </button>
    </li>
  );
}

function prettyBody(body: TunnelBody | null): { text: string; json: boolean } {
  if (!body || body.data === '') return { text: '', json: false };
  if (body.encoding === 'base64') return { text: '', json: false };
  try {
    return { text: JSON.stringify(JSON.parse(body.data), null, 2), json: true };
  } catch {
    return { text: body.data, json: false };
  }
}

/** Headers que não fazem sentido numa requisição manual (do túnel/Cloudflare). */
const SKIP_HEADERS =
  /^(host|content-length|connection|accept-encoding|cdn-loop|cf-[\w-]+|x-forwarded-[\w-]+|x-real-ip|true-client-ip)$/i;

function openAsRequest(exchange: TunnelExchange, target: string) {
  const { url, query } = applyUrlText(`${target.replace(/\/$/, '')}${exchange.path}`, []);
  const body = prettyBody(exchange.requestBody);
  const data: Partial<RequestData> = {
    method: asMethod(exchange.method),
    url,
    query,
    headers: exchange.requestHeaders
      .filter(([k]) => !SKIP_HEADERS.test(k))
      .map(([key, value]) => ({ key, value, enabled: true })),
    body:
      body.text === ''
        ? { mode: 'none' }
        : body.json
          ? { mode: 'json', text: body.text }
          : { mode: 'raw', language: 'text', text: body.text },
  };
  useTabs.getState().openNewRequest({ data, title: `Webhook ${exchange.path.split('?')[0]}` });
}

/** Evento do catálogo com os mesmos headers fixos da chamada (ex.: X-GitHub-Event: push). */
function guessEvent(provider: WebhookProviderId | null, headers: [string, string][]): string | undefined {
  const events = findWebhookProvider(provider)?.events ?? [];
  const value = (name: string) => headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
  return events.find((e) => {
    const fixed = Object.entries(e.headers ?? {});
    return fixed.length > 0 && fixed.every(([k, v]) => value(k) === v);
  })?.id;
}

function SignatureBadge({ check }: { check: SignatureCheck }) {
  const ok = check.status === 'valid';
  const Icon = ok ? CircleCheck : CircleAlert;
  return (
    <div
      className={cn(
        'mx-4 mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
        ok && 'border-success/40 bg-success/5',
        check.status === 'invalid' && 'border-danger/40 bg-danger/5',
        (check.status === 'missing' || check.status === 'unverifiable') && 'border-warning/40 bg-warning/5',
      )}
    >
      <Icon
        className={cn(
          'mt-px size-3.5 shrink-0',
          ok ? 'text-success' : check.status === 'invalid' ? 'text-danger' : 'text-warning',
        )}
      />
      <span className="text-fg">{check.message}</span>
    </div>
  );
}

function ExchangeDetail({
  tunnelId,
  target,
  provider,
  summary,
  onReplayed,
}: {
  tunnelId: string;
  target: string;
  provider: WebhookProviderId | null;
  summary: TunnelExchangeSummary;
  onReplayed: (id: string) => void;
}) {
  const [exchange, setExchange] = useState<TunnelExchange | null>(null);
  const [side, setSide] = useState<'request' | 'response'>('request');
  const [replaying, setReplaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .invoke('tunnel:exchange', tunnelId, summary.id)
      .then((e) => !cancelled && setExchange(e))
      .catch((e: unknown) => toast.error(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [tunnelId, summary.id]);

  const body = useMemo(
    () => prettyBody(side === 'request' ? (exchange?.requestBody ?? null) : (exchange?.responseBody ?? null)),
    [exchange, side],
  );

  if (!exchange) return <div className="p-4 text-xs text-fg-subtle">Carregando…</div>;
  const headers = side === 'request' ? exchange.requestHeaders : exchange.responseHeaders;
  const rawBody = side === 'request' ? exchange.requestBody : exchange.responseBody;

  async function replay() {
    setReplaying(true);
    const result = await replayExchange(tunnelId, summary.id);
    setReplaying(false);
    if (!result) return;
    onReplayed(result.id);
    if (result.error) toast.error(result.error);
    else toast.success(`Reenviada: a API respondeu ${result.status}.`);
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2.5">
        <MethodBadge method={asMethod(exchange.method)} short={false} />
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg" title={exchange.path}>
          {exchange.path}
        </code>
        <Button
          size="sm"
          onClick={() => void replay()}
          disabled={replaying}
          title="Envia de novo para a sua API"
        >
          {replaying ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <RotateCcw className="size-3.5" />
          )}
          Reenviar
        </Button>
        {exchange.requestBody.encoding === 'utf8' && !exchange.requestBody.truncated && (
          <Button
            size="sm"
            variant="ghost"
            title="Abre no simulador para editar o corpo e enviar com uma assinatura nova"
            onClick={() => {
              const eventId = guessEvent(provider, exchange.requestHeaders);
              openSimulator({
                tunnelId,
                body: exchange.requestBody.data,
                path: exchange.path,
                ...(eventId ? { eventId } : {}),
              });
            }}
          >
            <PenLine className="size-3.5" /> Editar e reenviar
          </Button>
        )}
        {exchange.requestBody.encoding === 'utf8' && !exchange.requestBody.truncated && (
          <Button
            size="sm"
            variant="ghost"
            title="Guarda este corpo no simulador (Meus eventos), para reenviar depois com uma assinatura nova"
            onClick={() => {
              const eventId = guessEvent(provider, exchange.requestHeaders);
              const template = findWebhookProvider(provider)?.events.find((e) => e.id === eventId);
              void saveWebhookEvent(tunnelId, {
                body: exchange.requestBody.data,
                path: exchange.path,
                ...(eventId ? { eventId } : {}),
                suggestedName: template?.label ?? exchange.simulated ?? `${exchange.method} ${exchange.path}`,
              });
            }}
          >
            <BookmarkPlus className="size-3.5" /> Salvar como evento
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => openAsRequest(exchange, target)}>
          <ExternalLink className="size-3.5" /> Abrir como requisição
        </Button>
      </div>

      {exchange.signature && <SignatureBadge check={exchange.signature} />}

      {exchange.error && (
        <div className="mx-4 mb-2 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-fg">
          {exchange.error}
        </div>
      )}

      <div className="flex h-9 shrink-0 items-center gap-1 border-t border-border px-3">
        {(
          [
            ['request', 'Pedido recebido'],
            ['response', 'Resposta da API'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSide(id)}
            className={cn(
              'h-6 rounded px-2 text-xs transition-colors',
              side === id ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {label}
          </button>
        ))}
        <div className="flex-1" />
        {side === 'response' && <StatusText exchange={exchange} />}
        <span className="font-mono text-2xs text-fg-subtle">{formatDuration(exchange.durationMs)}</span>
        {body.text && (
          <IconButton
            icon={Copy}
            label="Copiar corpo"
            size="sm"
            onClick={() => copy(body.text, 'Corpo copiado.')}
          />
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(160px,1fr)] border-t border-border">
        <details className="border-b border-border px-4 py-2 text-xs" open={headers.length <= 6}>
          <summary className="cursor-pointer select-none text-fg-muted hover:text-fg">
            Headers <span className="font-mono text-2xs">({headers.length})</span>
          </summary>
          <table className="mt-1.5 w-full select-text">
            <tbody>
              {headers.map(([k, v], i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: headers podem se repetir
                <tr key={i} className="align-top">
                  <td className="w-1/3 py-0.5 pr-3 font-mono text-fg-muted">{k}</td>
                  <td className="break-all py-0.5 font-mono text-fg">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        {rawBody?.encoding === 'base64' ? (
          <p className="p-4 text-xs text-fg-subtle">Corpo binário ({formatBytes(rawBody.size)}).</p>
        ) : body.text === '' ? (
          <p className="p-4 text-xs text-fg-subtle">
            {side === 'response' && !exchange.responseBody ? 'A API não respondeu.' : 'Sem corpo.'}
          </p>
        ) : (
          <div className="flex min-h-0 flex-col">
            {rawBody?.truncated && (
              <p className="shrink-0 px-4 py-1 text-2xs text-warning">
                Mostrando o primeiro 1 MB de {formatBytes(rawBody.size)}.
              </p>
            )}
            <div className="min-h-0 flex-1">
              <CodeEditor value={body.text} language={body.json ? 'json' : 'plaintext'} readOnly />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
