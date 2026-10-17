import { type AppSettings, contrastRatio, WCAG } from '@rota/core/shared';
import { Bot, Check, Clock, Info, Network, Palette as PaletteIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { AppInfo } from '../../../shared/ipc';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { Field, Switch, TextInput } from '../components/form';
import { api, errorMessage } from '../lib/api';
import { cn } from '../lib/cn';
import { HTTP_METHODS, methodTextClass } from '../lib/http-method';
import { toast } from '../state/toasts';
import { type SettingsSection, useUiStore } from '../state/ui';
import { contrastPairs, PALETTES, type Palette } from '../theme/palettes';

/** Seção do MCP, registrada pela feature do Claude. */
let mcpSection: (() => ReactNode) | undefined;
export function registerMcpSettings(render: () => ReactNode): void {
  mcpSection = render;
}

export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const section = useUiStore((s) => s.settingsSection);
  const openSettings = useUiStore((s) => s.openSettings);

  const nav: { id: SettingsSection; label: string; icon: typeof Info }[] = [
    { id: 'appearance', label: 'Aparência', icon: PaletteIcon },
    { id: 'requests', label: 'Requisições', icon: Clock },
    { id: 'network', label: 'Rede', icon: Network },
    ...(mcpSection ? [{ id: 'mcp' as const, label: 'Claude (MCP)', icon: Bot }] : []),
    { id: 'about', label: 'Sobre', icon: Info },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Configurações"
      className="h-[min(720px,88vh)] w-[min(920px,92vw)]"
    >
      <div className="flex min-h-0 flex-1">
        <nav className="w-48 shrink-0 space-y-0.5 border-r border-border p-2">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => openSettings(id)}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-[13px] transition-colors',
                section === id ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg',
              )}
            >
              <Icon className="size-4" strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {section === 'appearance' && <AppearanceSettings />}
          {(section === 'requests' || section === 'network') && <AppSettingsForm section={section} />}
          {section === 'mcp' && mcpSection?.()}
          {section === 'about' && <AboutSettings />}
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Requisições e rede (gravadas em %APPDATA%/Rota/settings.json)

function AppSettingsForm({ section }: { section: 'requests' | 'network' }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);

  useEffect(() => {
    void api.invoke('settings:get').then((s) => {
      setSettings(s);
      setDraft(s);
    });
  }, []);

  if (!draft || !settings) return <p className="text-[13px] text-fg-muted">Carregando…</p>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  async function save() {
    if (!draft) return;
    try {
      const saved = await api.invoke('settings:update', draft);
      setSettings(saved);
      setDraft(saved);
      toast.success('Configurações salvas.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      {section === 'requests' ? (
        <>
          <Header title="Requisições" description="Valores padrão aplicados a todas as requisições." />
          <Field
            label="Timeout padrão (ms)"
            hint="Cada requisição pode sobrescrever em Configurações da requisição. 0 = sem limite."
          >
            <TextInput
              type="number"
              min={0}
              value={draft.defaultTimeoutMs}
              onChange={(e) =>
                setDraft({ ...draft, defaultTimeoutMs: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
              }
              className="w-48"
            />
          </Field>
        </>
      ) : (
        <>
          <Header title="Proxy" description="Envia as requisições através de um proxy HTTP(S)." />
          <Switch
            label="Usar proxy"
            checked={draft.proxy.enabled}
            onChange={(enabled) => setDraft({ ...draft, proxy: { ...draft.proxy, enabled } })}
          />
          <Field
            label="Endereço do proxy"
            hint="Ex.: http://proxy.empresa:8080 ou http://usuario:senha@proxy:3128"
          >
            <TextInput
              mono
              value={draft.proxy.url}
              disabled={!draft.proxy.enabled}
              onChange={(e) => setDraft({ ...draft, proxy: { ...draft.proxy, url: e.target.value } })}
              placeholder="http://proxy:8080"
            />
          </Field>
          <Field label="Não usar proxy para" hint="Hosts separados por vírgula. Aceita curinga: *.interno">
            <TextInput
              mono
              value={draft.proxy.bypass}
              disabled={!draft.proxy.enabled}
              onChange={(e) => setDraft({ ...draft, proxy: { ...draft.proxy, bypass: e.target.value } })}
            />
          </Field>
        </>
      )}
      <div className="flex gap-2">
        <Button variant="primary" disabled={!dirty} onClick={() => void save()}>
          Salvar
        </Button>
        {dirty && <Button onClick={() => setDraft(settings)}>Descartar</Button>}
      </div>
    </div>
  );
}

function Header({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-[13px] text-fg-muted">{description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aparência

function AppearanceSettings() {
  const paletteId = useUiStore((s) => s.paletteId);
  const setPalette = useUiStore((s) => s.setPalette);
  const active = PALETTES[paletteId];

  return (
    <div className="space-y-8">
      <section>
        <Header
          title="Paleta de cores"
          description="Tema escuro. Clique em uma opção para aplicá-la em todo o app."
        />
        <div className="mt-4 grid grid-cols-2 gap-3">
          {Object.values(PALETTES).map((p) => (
            <PaletteCard
              key={p.id}
              palette={p}
              selected={p.id === paletteId}
              onSelect={() => setPalette(p.id)}
            />
          ))}
        </div>
      </section>

      <section>
        <Header title="Cores com função" description="São as únicas cores fortes da interface." />
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center gap-4 text-xs font-medium">
            <span className="text-success">200 OK</span>
            <span className="text-warning">301 Moved</span>
            <span className="text-danger">500 Error</span>
          </div>
          <div className="w-px self-stretch bg-border" />
          <div className="flex flex-wrap items-center gap-4 font-mono text-xs font-semibold">
            {HTTP_METHODS.map((m) => (
              <span key={m} className={methodTextClass(m)}>
                {m}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section>
        <Header
          title={`Contraste (WCAG AA) — ${active.name}`}
          description={`Mínimo de ${WCAG.AA_TEXT}:1 para texto. Também verificado nos testes automatizados.`}
        />
        <ContrastTable palette={active} />
      </section>
    </div>
  );
}

function PaletteCard({
  palette,
  selected,
  onSelect,
}: {
  palette: Palette;
  selected: boolean;
  onSelect(): void;
}) {
  const c = palette.colors;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'rounded-xl border p-3 text-left transition-[border-color,box-shadow] duration-150',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-border-strong',
      )}
    >
      <div className="overflow-hidden rounded-lg border" style={{ background: c.bg, borderColor: c.border }}>
        <div className="flex h-5 items-center gap-1 px-2" style={{ background: c.surface }}>
          <span className="size-1.5 rounded-full" style={{ background: c.primary }} />
          <span className="h-1 w-10 rounded-full" style={{ background: c.fgSubtle }} />
        </div>
        <div className="flex h-24">
          <div className="w-1/3 space-y-1.5 p-2" style={{ background: c.surface }}>
            {[c.method.get, c.method.post, c.method.delete].map((m) => (
              <div key={m} className="flex items-center gap-1">
                <span className="h-1 w-2.5 rounded-full" style={{ background: m }} />
                <span className="h-1 flex-1 rounded-full" style={{ background: c.fgMuted }} />
              </div>
            ))}
          </div>
          <div className="flex-1 space-y-2 p-2">
            <div className="flex h-4 items-center gap-1 rounded px-1" style={{ background: c.surface2 }}>
              <span className="h-1 flex-1 rounded-full" style={{ background: c.fgSubtle }} />
              <span className="h-2.5 w-6 rounded-sm" style={{ background: c.primary }} />
            </div>
            <span className="block h-1 w-3/4 rounded-full" style={{ background: c.fg }} />
            <span className="block h-1 w-1/2 rounded-full" style={{ background: c.fgMuted }} />
            <span className="block h-1 w-1/3 rounded-full" style={{ background: c.success }} />
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-medium text-fg">{palette.name}</p>
          <p className="mt-0.5 text-xs text-fg-muted">{palette.description}</p>
        </div>
        {selected && (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-fg">
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
      </div>
    </button>
  );
}

function ContrastTable({ palette }: { palette: Palette }) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-border">
      <table className="w-full text-xs">
        <tbody>
          {contrastPairs(palette).map(({ label, fg, bg }) => {
            const ratio = contrastRatio(fg, bg);
            const pass = ratio >= WCAG.AA_TEXT;
            return (
              <tr key={label} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5 text-fg-muted">{label}</td>
                <td className="w-28 px-3 py-1.5">
                  <span className="rounded px-1.5 py-0.5 font-medium" style={{ color: fg, background: bg }}>
                    Exemplo
                  </span>
                </td>
                <td className="w-20 px-3 py-1.5 text-right font-mono text-fg">{ratio.toFixed(2)}:1</td>
                <td
                  className={cn(
                    'w-20 px-3 py-1.5 text-right font-medium',
                    pass ? 'text-success' : 'text-danger',
                  )}
                >
                  {pass ? (ratio >= WCAG.AAA_TEXT ? 'AAA' : 'AA') : 'Falha'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sobre

function AboutSettings() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .invoke('app:getInfo')
      .then(setInfo)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  if (error) return <p className="text-[13px] text-danger">Não foi possível obter as informações: {error}</p>;
  if (!info) return <p className="text-[13px] text-fg-muted">Carregando…</p>;

  const rows: [string, string][] = [
    ['Versão', info.version],
    ['Electron', info.electron],
    ['Chromium', info.chrome],
    ['Node', info.node],
    ['Plataforma', info.platform],
    ['Dados do app', info.userDataPath],
  ];
  return (
    <div>
      <h3 className="text-sm font-semibold">{info.name}</h3>
      <dl className="mt-4 grid grid-cols-[140px_1fr] gap-y-2 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-muted">{k}</dt>
            <dd className="select-text break-all font-mono text-xs leading-5 text-fg">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
