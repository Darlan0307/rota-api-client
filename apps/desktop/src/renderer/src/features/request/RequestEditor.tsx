import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { ancestorsOf, applyUrlText, composeUrl, HTTP_METHODS, type RequestData } from '@rota/core/shared';
import { ChevronDown, ChevronRight, Construction, LoaderCircle, Save, Send, X } from 'lucide-react';
import { type ClipboardEvent, type ReactNode, useRef } from 'react';
import { Group, Panel, useDefaultLayout } from 'react-resizable-panels';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Field, Switch, TextArea, TextInput } from '../../components/form';
import { Kbd } from '../../components/Kbd';
import { KeyValueTable } from '../../components/KeyValueTable';
import { TabStrip } from '../../components/TabStrip';
import { Tooltip } from '../../components/Tooltip';
import { VariableInput } from '../../components/VariableInput';
import { ResizeHandle } from '../../layout/ResizeHandle';
import { useInheritedAuth } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { methodTextClass } from '../../lib/http-method';
import { useElementWidth } from '../../lib/use-element-width';
import { VariableContextProvider } from '../../lib/variables';
import { cancelRequest, saveTab, sendRequest } from '../../state/actions';
import { isDirty, type RequestSection, type RequestTab, useTabs } from '../../state/tabs';
import { useUiStore } from '../../state/ui';
import { useSnapshot } from '../../state/workspace';
import { ConflictBanner } from '../conflict/ConflictBanner';
import { type ResponseExtraSection, ResponsePane } from '../response/ResponsePane';
import { AuthEditor } from './AuthEditor';
import { BodyEditor } from './BodyEditor';
import { openItemById } from './open';

/** Ganchos para fases seguintes (colar cURL, scripts, testes). */
export interface RequestEditorExtensions {
  onUrlPaste?: (tab: RequestTab, event: ClipboardEvent<HTMLInputElement>) => void;
  renderScripts?: (tab: RequestTab, onChange: (data: RequestData) => void) => ReactNode;
  responseSections?: (tab: RequestTab) => ResponseExtraSection[];
  responseActions?: (tab: RequestTab) => ReactNode;
  /** Faixa acima da resposta (ex.: vendo um envio anterior). */
  responseBanner?: (tab: RequestTab) => ReactNode;
  headerActions?: (tab: RequestTab) => ReactNode;
}

let extensions: RequestEditorExtensions = {};
export function registerRequestEditorExtensions(ext: RequestEditorExtensions): void {
  extensions = { ...extensions, ...ext };
}

/** Abaixo desta largura, requisição e resposta ficam empilhadas mesmo no modo lado a lado. */
const SIDE_BY_SIDE_MIN_WIDTH = 900;

export function RequestEditor({ tab }: { tab: RequestTab }) {
  const preferredLayout = useUiStore((s) => s.paneLayout);
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const paneLayout =
    preferredLayout === 'horizontal' && width > 0 && width < SIDE_BY_SIDE_MIN_WIDTH
      ? 'vertical'
      : preferredLayout;
  const layout = useDefaultLayout({ id: `request-response-${paneLayout}`, storage: localStorage });
  const update = useTabs((s) => s.update);

  const setData = (data: RequestData) => update<RequestTab>(tab.id, (t) => ({ ...t, draft: data }));
  const patch = (p: Partial<RequestData>) => setData({ ...tab.draft, ...p });
  const shortcut = (s: 'send' | 'save') => void (s === 'send' ? sendRequest(tab.id) : saveTab(tab.id));

  return (
    <VariableContextProvider itemId={tab.itemId ?? tab.parentId}>
      <div ref={containerRef} className="flex h-full min-h-0 flex-col">
        <ConflictBanner tab={tab} />
        <RequestHeader tab={tab} />
        <UrlBar tab={tab} onChange={patch} />
        <div className="min-h-0 flex-1">
          <Group
            key={paneLayout}
            orientation={paneLayout}
            defaultLayout={layout.defaultLayout}
            onLayoutChanged={layout.onLayoutChanged}
            className="h-full"
          >
            <Panel id="request" minSize="25%" defaultSize="50%">
              <RequestSections tab={tab} onChange={setData} onShortcut={shortcut} />
            </Panel>
            <ResizeHandle vertical={paneLayout === 'vertical'} />
            <Panel id="response" minSize="20%" defaultSize="50%">
              <ResponsePane
                tab={tab}
                extraSections={extensions.responseSections?.(tab) ?? []}
                actions={extensions.responseActions?.(tab)}
                banner={extensions.responseBanner?.(tab)}
              />
            </Panel>
          </Group>
        </div>
      </div>
    </VariableContextProvider>
  );
}

// ---------------------------------------------------------------------------
// Cabeçalho: caminho + salvar

function RequestHeader({ tab }: { tab: RequestTab }) {
  const snapshot = useSnapshot();
  const dirty = isDirty(tab);
  const path = tab.itemId ? ancestorsOf(snapshot, tab.itemId).reverse() : tab.parentId ? [] : [];

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-4">
      <nav aria-label="Caminho" className="flex min-w-0 flex-1 items-center gap-1 text-[13px]">
        {path.map((node) => (
          <span key={node.id} className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              onClick={() => openItemById(node.id)}
              className="truncate text-fg-muted transition-colors hover:text-fg"
            >
              {node.name}
            </button>
            <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" />
          </span>
        ))}
        <span className="truncate font-medium text-fg">{tab.title}</span>
        {!tab.itemId && (
          <span className="ml-1 rounded bg-surface-2 px-1.5 text-2xs text-fg-muted">não salva</span>
        )}
      </nav>
      {extensions.headerActions?.(tab)}
      <Tooltip label={tab.itemId ? 'Salvar' : 'Salvar em uma coleção'} shortcut="Ctrl+S">
        <Button size="sm" variant={dirty ? 'secondary' : 'ghost'} onClick={() => void saveTab(tab.id)}>
          <Save className="size-3.5" />
          Salvar
          {dirty && (
            <>
              <span className="size-1.5 rounded-full bg-primary" />
              <span className="sr-only">(alterações não salvas)</span>
            </>
          )}
        </Button>
      </Tooltip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barra de URL

function UrlBar({ tab, onChange }: { tab: RequestTab; onChange: (p: Partial<RequestData>) => void }) {
  const sending = tab.run?.status === 'sending';
  const fullUrl = composeUrl(tab.draft.url, tab.draft.query);

  return (
    <div className="flex shrink-0 items-center gap-2 px-4 pb-3">
      <div className="flex h-9 min-w-0 flex-1 items-stretch rounded-lg border border-border bg-surface-2 transition-colors focus-within:border-border-strong">
        <MethodSelect value={tab.draft.method} onChange={(method) => onChange({ method })} />
        <div className="w-px bg-border" />
        <VariableInput
          ariaLabel="URL"
          value={fullUrl}
          onChange={(text) => onChange(applyUrlText(text, tab.draft.query))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.ctrlKey) void sendRequest(tab.id);
          }}
          onPaste={(e) => extensions.onUrlPaste?.(tab, e)}
          placeholder="Digite a URL ou cole um comando cURL"
        />
      </div>
      {sending ? (
        <Button variant="secondary" className="h-9 w-28" onClick={() => cancelRequest(tab.id)}>
          <X className="size-3.5" />
          Cancelar
        </Button>
      ) : (
        <Tooltip label="Enviar" shortcut="Ctrl+Enter">
          <Button variant="primary" className="h-9 w-28" onClick={() => void sendRequest(tab.id)}>
            {sending ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" strokeWidth={2} />
            )}
            Enviar
          </Button>
        </Tooltip>
      )}
    </div>
  );
}

function MethodSelect({
  value,
  onChange,
}: {
  value: RequestData['method'];
  onChange: (m: RequestData['method']) => void;
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          aria-label="Método HTTP"
          className={cn(
            'flex w-[6.5rem] shrink-0 items-center justify-between gap-1 rounded-l-lg pl-3 pr-2 font-mono text-xs font-semibold outline-none hover:bg-surface',
            methodTextClass(value),
          )}
        >
          {value}
          <ChevronDown className="size-3.5 text-fg-subtle" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-36 rounded-lg border border-border bg-elevated p-1 shadow-xl shadow-black/40 animate-pop-in"
        >
          {HTTP_METHODS.map((m) => (
            <Dropdown.Item
              key={m}
              onSelect={() => onChange(m)}
              className={cn(
                'cursor-pointer rounded-md px-2 py-1.5 font-mono text-xs font-semibold outline-none data-[highlighted]:bg-surface-2',
                methodTextClass(m),
              )}
            >
              {m}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

// ---------------------------------------------------------------------------
// Seções: params, auth, headers, body, scripts, configurações

function RequestSections({
  tab,
  onChange,
  onShortcut,
}: {
  tab: RequestTab;
  onChange: (data: RequestData) => void;
  onShortcut: (s: 'send' | 'save') => void;
}) {
  const update = useTabs((s) => s.update);
  const data = tab.draft;
  const inherited = useInheritedAuth(tab.itemId ?? tab.parentId, !tab.itemId);
  const section = tab.section;
  const setSection = (s: RequestSection) => update<RequestTab>(tab.id, (t) => ({ ...t, section: s }));

  const counts: Partial<Record<RequestSection, number>> = {
    params: data.query.filter((p) => p.enabled && p.key).length,
    headers: data.headers.filter((h) => h.enabled && h.key).length,
  };
  const hasScripts = data.scripts.preRequest.trim() !== '' || data.scripts.postResponse.trim() !== '';

  const sections: { id: RequestSection; label: string; dot?: boolean }[] = [
    { id: 'params', label: 'Params' },
    { id: 'auth', label: 'Autenticação', dot: data.auth.type !== 'inherit' && data.auth.type !== 'none' },
    { id: 'headers', label: 'Headers' },
    { id: 'body', label: 'Body', dot: data.body.mode !== 'none' },
    { id: 'scripts', label: 'Scripts', dot: hasScripts },
    { id: 'settings', label: 'Configurações' },
  ];

  return (
    <section className="flex h-full min-w-0 flex-col bg-bg" aria-label="Requisição">
      <TabStrip activeKey={section} className="h-10 shrink-0 items-stretch gap-4 border-b border-border px-4">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            onClick={() => setSection(s.id)}
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 text-[13px] transition-colors',
              section === s.id ? 'text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {s.label}
            {counts[s.id] ? (
              <span className="rounded bg-surface-2 px-1 font-mono text-2xs text-fg-muted">
                {counts[s.id]}
              </span>
            ) : null}
            {s.dot && <span className="size-1.5 rounded-full bg-primary/80" />}
            {section === s.id && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </TabStrip>

      <div className="min-h-0 flex-1 overflow-auto">
        {section === 'params' && (
          <div className="p-4">
            <KeyValueTable
              rows={data.query}
              onChange={(query) => onChange({ ...data, query })}
              createRow={(p) => ({ key: '', value: '', enabled: true, ...p })}
              keyPlaceholder="Parâmetro"
            />
            <p className="mt-2 text-xs text-fg-subtle">
              Os parâmetros habilitados aparecem na URL e vice-versa.
            </p>
          </div>
        )}
        {section === 'auth' && (
          <AuthEditor
            auth={data.auth}
            onChange={(auth) => onChange({ ...data, auth })}
            allowInherit
            inherited={inherited}
            onOpenSource={openItemById}
          />
        )}
        {section === 'headers' && (
          <div className="p-4">
            <KeyValueTable
              rows={data.headers}
              onChange={(headers) => onChange({ ...data, headers })}
              createRow={(p) => ({ key: '', value: '', enabled: true, ...p })}
              keyPlaceholder="Header"
            />
            <p className="mt-2 text-xs text-fg-subtle">
              User-Agent, Accept e Accept-Encoding são enviados automaticamente se você não definir.
            </p>
          </div>
        )}
        {section === 'body' && (
          <BodyEditor
            body={data.body}
            onChange={(body) => onChange({ ...data, body })}
            onShortcut={onShortcut}
            setText={(text) =>
              update<RequestTab>(tab.id, (t) =>
                t.draft.body.mode === 'json' || t.draft.body.mode === 'raw'
                  ? { ...t, draft: { ...t.draft, body: { ...t.draft.body, text } } }
                  : t,
              )
            }
          />
        )}
        {section === 'scripts' &&
          (extensions.renderScripts?.(tab, onChange) ?? (
            <EmptyState compact icon={Construction} title="Scripts" description="Disponível em breve." />
          ))}
        {section === 'settings' && <RequestSettingsSection data={data} onChange={onChange} />}
      </div>
    </section>
  );
}

function RequestSettingsSection({
  data,
  onChange,
}: {
  data: RequestData;
  onChange: (data: RequestData) => void;
}) {
  const s = data.settings;
  const set = (patch: Partial<RequestData['settings']>) =>
    onChange({ ...data, settings: { ...s, ...patch } });
  return (
    <div className="max-w-xl space-y-6 p-4">
      <Field
        label="Timeout (ms)"
        hint="Deixe vazio para usar o padrão do app (Configurações → Requisições). 0 = sem limite."
      >
        <TextInput
          type="number"
          min={0}
          value={s.timeoutMs ?? ''}
          placeholder="Padrão do app"
          onChange={(e) => {
            const value = e.target.value;
            const { timeoutMs: _t, ...rest } = s;
            onChange({
              ...data,
              settings: value === '' ? rest : { ...rest, timeoutMs: Math.max(0, Math.floor(Number(value))) },
            });
          }}
          className="w-48"
        />
      </Field>
      <Switch
        label="Seguir redirecionamentos"
        description="Segue respostas 3xx automaticamente (até 10 saltos)."
        checked={s.followRedirects}
        onChange={(followRedirects) => set({ followRedirects })}
      />
      <Switch
        label="Verificar certificado SSL"
        description="Desative só para ambientes de desenvolvimento com certificado autoassinado."
        checked={s.verifySsl}
        onChange={(verifySsl) => set({ verifySsl })}
      />
      <Field label="Descrição">
        <TextArea
          rows={4}
          value={data.description ?? ''}
          onChange={(e) => onChange({ ...data, description: e.target.value || undefined })}
          placeholder="Notas sobre esta requisição"
        />
      </Field>
      <p className="flex items-center gap-1 text-xs text-fg-subtle">
        Proxy é configurado globalmente em Configurações → Rede. <Kbd keys="Ctrl+," />
      </p>
    </div>
  );
}
