import {
  DEFAULT_HMAC,
  findWebhookProvider,
  type HmacSettings,
  joinUrl,
  type TunnelConfig,
  WEBHOOK_PROVIDERS,
  type WebhookProviderId,
} from '@rota/core/shared';
import { BookmarkPlus, KeyRound, LoaderCircle, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { CodeEditor } from '../../components/CodeEditor';
import { Dialog } from '../../components/Dialog';
import { Field, Select, TextInput } from '../../components/form';
import {
  closeSimulator,
  removeSavedEvent,
  renameSavedEvent,
  saveWebhookEvent,
  setWebhookSecret,
  simulateWebhook,
  updateTunnel,
  useTunnel,
  useTunnels,
} from './state';

const NO_PROVIDER = 'none';
/** Prefixo dos eventos salvos no seletor (os de exemplo usam o id do provedor). */
const SAVED = 'saved:';
type ProviderChoice = WebhookProviderId | typeof NO_PROVIDER;

const PROVIDER_OPTIONS = [
  { value: NO_PROVIDER, label: 'Escolha o provedor' },
  ...WEBHOOK_PROVIDERS.map((p) => ({ value: p.id, label: p.name })),
] as const satisfies readonly { value: ProviderChoice; label: string }[];

/** Simula o webhook de um provedor: corpo de exemplo, assinatura correta e envio para a API local. */
export function WebhookSimulatorDialog() {
  const request = useTunnels((s) => s.simulator);
  const view = useTunnel(request?.tunnelId ?? null);
  return (
    <Dialog
      open={Boolean(request && view)}
      onOpenChange={(open) => !open && closeSimulator()}
      title="Simular webhook"
      className="h-[min(720px,calc(100vh-48px))] w-[min(980px,calc(100vw-32px))]"
    >
      {request && view && (
        <SimulatorForm
          key={`${request.tunnelId}:${request.body ?? ''}`}
          config={view.config}
          hasSecret={view.hasWebhookSecret}
          initialBody={request.body}
          initialPath={request.path}
          initialEvent={request.eventId}
        />
      )}
    </Dialog>
  );
}

function SimulatorForm({
  config,
  hasSecret,
  initialBody,
  initialPath,
  initialEvent,
}: {
  config: TunnelConfig;
  hasSecret: boolean;
  initialBody: string | undefined;
  initialPath: string | undefined;
  initialEvent: string | undefined;
}) {
  const provider = findWebhookProvider(config.webhook.provider);
  // Corpo de uma chamada recebida: fica sem evento de exemplo, a menos que os headers indiquem um.
  const [eventId, setEventId] = useState(
    initialBody !== undefined ? (initialEvent ?? '') : (provider?.events[0]?.id ?? ''),
  );
  const [body, setBody] = useState(initialBody ?? provider?.events[0]?.body ?? '');
  const [path, setPath] = useState(initialPath ?? config.webhookPath);
  const [sending, setSending] = useState(false);

  function chooseProvider(id: ProviderChoice) {
    const next = id === NO_PROVIDER ? null : id;
    if (next === config.webhook.provider) return;
    void updateTunnel(config.id, { webhook: { ...config.webhook, provider: next } });
    const first = findWebhookProvider(next)?.events[0];
    setEventId(first?.id ?? '');
    // Corpo de uma chamada recebida continua; o de exemplo troca junto com o provedor.
    if (!initialBody) setBody(first?.body ?? '');
  }

  const savedEvents = config.webhook.savedEvents ?? [];
  const saved = eventId.startsWith(SAVED)
    ? savedEvents.find((e) => `${SAVED}${e.id}` === eventId)
    : undefined;

  function chooseEvent(id: string) {
    setEventId(id);
    const mine = savedEvents.find((e) => `${SAVED}${e.id}` === id);
    if (mine) {
      setBody(mine.body);
      if (mine.path) setPath(mine.path);
      return;
    }
    const event = provider?.events.find((e) => e.id === id);
    if (event) setBody(event.body);
  }

  async function send() {
    setSending(true);
    // Evento salvo: os headers fixos vêm do modelo do provedor de onde ele veio.
    const template = saved ? saved.eventId : eventId || undefined;
    const ok = await simulateWebhook(config.id, {
      body,
      path,
      ...(template ? { eventId: template } : {}),
      ...(saved ? { label: saved.name } : {}),
    });
    setSending(false);
    if (ok) closeSimulator();
  }

  const destination = config.target ? joinUrl(config.target, path) : '';
  const canSend = Boolean(provider && hasSecret && body.trim()) && !sending;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[300px_minmax(0,1fr)] md:overflow-hidden">
        <div className="space-y-4 border-b border-border p-5 md:overflow-y-auto md:border-b-0 md:border-r">
          <Field label="Provedor">
            <Select
              value={config.webhook.provider ?? NO_PROVIDER}
              options={PROVIDER_OPTIONS}
              onChange={chooseProvider}
              ariaLabel="Provedor do webhook"
              triggerClassName="h-8 w-full"
            />
          </Field>

          {provider && (
            <>
              <SecretField
                tunnelId={config.id}
                hasSecret={hasSecret}
                label={provider.secretLabel}
                placeholder={provider.secretPlaceholder}
                help={provider.secretHelp}
              />
              {provider.id === 'hmac' && <HmacFields config={config} />}
              <Field label="Evento de exemplo">
                <Select
                  value={eventId}
                  options={[
                    ...(initialBody !== undefined && !eventId
                      ? [{ value: '', label: 'Corpo da chamada recebida' }]
                      : []),
                    ...(eventId.startsWith(SAVED) && !saved
                      ? [{ value: eventId, label: 'Evento excluído' }]
                      : []),
                    ...savedEvents.map((e) => ({
                      value: `${SAVED}${e.id}`,
                      label: `★ ${e.name}`,
                      hint:
                        e.provider && e.provider !== provider.id
                          ? (findWebhookProvider(e.provider)?.shortName ?? 'salvo')
                          : 'salvo',
                    })),
                    ...provider.events.map((e) => ({ value: e.id, label: e.label })),
                  ]}
                  onChange={chooseEvent}
                  ariaLabel="Evento de exemplo"
                  triggerClassName="h-8 w-full"
                  className="max-h-80 overflow-y-auto"
                />
              </Field>
              {saved && (
                <div className="-mt-2 flex gap-3 text-xs">
                  <button
                    type="button"
                    className="text-fg-muted hover:text-fg"
                    onClick={() => void renameSavedEvent(config.id, saved.id)}
                  >
                    Renomear
                  </button>
                  <button
                    type="button"
                    className="text-fg-muted hover:text-danger"
                    onClick={() => void removeSavedEvent(config.id, saved.id)}
                  >
                    Excluir evento
                  </button>
                </div>
              )}
            </>
          )}

          <Field label="Caminho na sua API">
            <TextInput
              mono
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/webhooks/pagamentos"
            />
          </Field>

          {provider && (
            <p className="rounded-lg bg-surface-2 p-2.5 font-mono text-2xs leading-relaxed text-fg-muted">
              {provider.scheme}
            </p>
          )}
        </div>

        <div className="flex min-h-[260px] min-w-0 flex-col">
          <div className="flex h-9 shrink-0 items-center px-4 text-xs text-fg-muted">
            Corpo
            <span className="ml-auto truncate pl-3 text-2xs text-fg-subtle">
              {'{{$guid}}, {{$cpf}}... geram dados novos a cada envio; {{variáveis}} vêm do ambiente ativo'}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-2 shrink-0"
              disabled={!body.trim()}
              title="Guarda este corpo em Meus eventos, para reenviar depois"
              onClick={() =>
                void saveWebhookEvent(config.id, {
                  body,
                  path,
                  ...(!saved && eventId ? { eventId } : saved?.eventId ? { eventId: saved.eventId } : {}),
                  suggestedName:
                    saved?.name ?? provider?.events.find((e) => e.id === eventId)?.label ?? 'Meu evento',
                })
              }
            >
              <BookmarkPlus className="size-3.5" /> Salvar
            </Button>
          </div>
          <div className="min-h-0 flex-1 border-t border-border">
            <CodeEditor value={body} onChange={setBody} language="json" variables />
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border px-5 py-3">
        <p className="min-w-0 flex-1 truncate text-xs text-fg-muted" title={destination}>
          {provider ? (
            hasSecret ? (
              <>
                POST direto para <span className="font-mono text-fg">{destination}</span>,{' '}
                {provider.id === 'hmac'
                  ? 'assinado com o HMAC configurado'
                  : `assinado como o ${provider.shortName} faria`}
                . Não precisa do túnel ligado.
              </>
            ) : (
              <span className="text-warning">
                Informe o {provider.secretLabel.toLowerCase()} para assinar.
              </span>
            )
          ) : (
            'Escolha o provedor para ver os eventos de exemplo.'
          )}
        </p>
        <Button onClick={closeSimulator}>Cancelar</Button>
        <Button variant="primary" disabled={!canSend} onClick={() => void send()}>
          {sending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          Enviar
        </Button>
      </div>
    </div>
  );
}

function SecretField({
  tunnelId,
  hasSecret,
  label,
  placeholder,
  help,
}: {
  tunnelId: string;
  hasSecret: boolean;
  label: string;
  placeholder: string;
  help: string;
}) {
  const [editing, setEditing] = useState(!hasSecret);
  const [value, setValue] = useState('');
  useEffect(() => setEditing(!hasSecret), [hasSecret]);

  async function save() {
    if (!value.trim()) return;
    if (await setWebhookSecret(tunnelId, value)) setValue('');
  }

  return (
    <Field label={label} hint={help}>
      {editing ? (
        <div className="flex gap-1.5">
          <TextInput
            mono
            type="password"
            autoComplete="off"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            aria-label={label}
          />
          <Button size="sm" className="h-8" disabled={!value.trim()} onClick={() => void save()}>
            Salvar
          </Button>
          {hasSecret && (
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          )}
        </div>
      ) : (
        <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-xs">
          <KeyRound className="size-3.5 text-success" />
          <span
            className="flex-1 truncate text-fg"
            title="Cifrado neste PC; nunca vai para arquivos versionados"
          >
            Salvo (cifrado)
          </span>
          <button type="button" className="text-fg-muted hover:text-fg" onClick={() => setEditing(true)}>
            Trocar
          </button>
          <button
            type="button"
            className="text-fg-muted hover:text-danger"
            onClick={() => void setWebhookSecret(tunnelId, null)}
          >
            Remover
          </button>
        </div>
      )}
    </Field>
  );
}

function HmacFields({ config }: { config: TunnelConfig }) {
  const hmac = config.webhook.hmac;
  const [header, setHeader] = useState(hmac.header);
  const [prefix, setPrefix] = useState(hmac.prefix);
  useEffect(() => setHeader(hmac.header), [hmac.header]);
  useEffect(() => setPrefix(hmac.prefix), [hmac.prefix]);
  const save = (patch: Partial<HmacSettings>) =>
    void updateTunnel(config.id, { webhook: { ...config.webhook, hmac: { ...hmac, ...patch } } });

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="col-span-2">
        <Field label="Header da assinatura">
          <TextInput
            mono
            value={header}
            placeholder={DEFAULT_HMAC.header}
            onChange={(e) => setHeader(e.target.value)}
            onBlur={() => header !== hmac.header && save({ header })}
          />
        </Field>
      </div>
      <Field label="Algoritmo">
        <Select
          value={hmac.algorithm}
          options={[
            { value: 'sha256', label: 'SHA-256' },
            { value: 'sha1', label: 'SHA-1' },
            { value: 'sha512', label: 'SHA-512' },
          ]}
          onChange={(algorithm) => save({ algorithm })}
          ariaLabel="Algoritmo"
          triggerClassName="h-8 w-full"
        />
      </Field>
      <Field label="Formato">
        <Select
          value={hmac.encoding}
          options={[
            { value: 'hex', label: 'Hex' },
            { value: 'base64', label: 'Base64' },
          ]}
          onChange={(encoding) => save({ encoding })}
          ariaLabel="Formato"
          triggerClassName="h-8 w-full"
        />
      </Field>
      <div className="col-span-2">
        <Field label="Prefixo (opcional)">
          <TextInput
            mono
            value={prefix}
            placeholder="ex.: sha256="
            onChange={(e) => setPrefix(e.target.value)}
            onBlur={() => prefix !== hmac.prefix && save({ prefix })}
          />
        </Field>
      </div>
    </div>
  );
}
