import { contrastRatio, WCAG } from '@rota/core';
import { Check, Info, Palette as PaletteIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppInfo } from '../../../shared/ipc';
import { Dialog } from '../components/Dialog';
import { cn } from '../lib/cn';
import { HTTP_METHODS, methodTextClass } from '../lib/http-method';
import { useUiStore } from '../state/ui';
import { contrastPairs, PALETTES, type Palette } from '../theme/palettes';

type Section = 'appearance' | 'about';

export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const [section, setSection] = useState<Section>('appearance');

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Configurações"
      className="h-[min(720px,88vh)] w-[min(920px,92vw)]"
    >
      <div className="flex min-h-0 flex-1">
        <nav className="w-48 shrink-0 space-y-0.5 border-r border-border p-2">
          <NavItem
            icon={PaletteIcon}
            label="Aparência"
            active={section === 'appearance'}
            onClick={() => setSection('appearance')}
          />
          <NavItem
            icon={Info}
            label="Sobre"
            active={section === 'about'}
            onClick={() => setSection('about')}
          />
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {section === 'appearance' ? <AppearanceSettings /> : <AboutSettings />}
        </div>
      </div>
    </Dialog>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Info;
  label: string;
  active: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-[13px] transition-colors',
        active ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg',
      )}
    >
      <Icon className="size-4" strokeWidth={1.75} />
      {label}
    </button>
  );
}

function AppearanceSettings() {
  const paletteId = useUiStore((s) => s.paletteId);
  const setPalette = useUiStore((s) => s.setPalette);
  const active = PALETTES[paletteId];

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-sm font-semibold">Paleta de cores</h3>
        <p className="mt-1 text-[13px] text-fg-muted">
          Proposta para aprovação. Clique em uma opção para aplicá-la em todo o app.
        </p>
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
        <h3 className="text-sm font-semibold">Cores com função</h3>
        <p className="mt-1 text-[13px] text-fg-muted">
          Iguais nas duas propostas. São as únicas cores fortes da interface.
        </p>
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
        <h3 className="text-sm font-semibold">Contraste (WCAG AA) — {active.name}</h3>
        <p className="mt-1 text-[13px] text-fg-muted">
          Mínimo de {WCAG.AA_TEXT}:1 para texto. Também verificado nos testes automatizados.
        </p>
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
      {/* Miniatura usando as cores literais da paleta, para comparar lado a lado. */}
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

      <div className="mt-3 flex gap-1">
        {[
          c.bg,
          c.surface,
          c.surface2,
          c.elevated,
          c.border,
          c.fgSubtle,
          c.fgMuted,
          c.fg,
          c.primarySoft,
          c.primary,
        ].map((color) => (
          <span
            key={color}
            title={color}
            className="h-4 flex-1 rounded-sm border border-black/20"
            style={{ background: color }}
          />
        ))}
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

function AboutSettings() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api
      .invoke('app:getInfo')
      .then(setInfo)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
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
