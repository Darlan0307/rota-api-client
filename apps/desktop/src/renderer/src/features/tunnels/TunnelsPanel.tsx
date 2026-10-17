import type { TunnelStatus, TunnelView } from '@rota/core/shared';
import { CircleHelp, Play, Plus, Square } from 'lucide-react';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { cn } from '../../lib/cn';
import { useActiveTab } from '../../state/tabs';
import { newTunnel, openTunnel, startTunnel, stopTunnel, useTunnels } from './state';
import { openTunnelGuide, TunnelSteps } from './TunnelGuide';

export const STATUS_LABEL: Record<TunnelStatus, string> = {
  stopped: 'Desligado',
  starting: 'Ligando…',
  running: 'Ligado',
  error: 'Com erro',
};

export function StatusDot({ status, className }: { status: TunnelStatus; className?: string }) {
  return (
    <span
      className={cn(
        'size-2 shrink-0 rounded-full',
        status === 'running' && 'bg-success shadow-[0_0_0_3px] shadow-success/20',
        status === 'starting' && 'animate-pulse bg-warning',
        status === 'error' && 'bg-danger',
        status === 'stopped' && 'bg-border-strong',
        className,
      )}
    />
  );
}

function targetLabel(target: string): string {
  try {
    const url = new URL(target);
    return `${url.hostname === 'localhost' ? '' : url.hostname}:${url.port || (url.protocol === 'https:' ? 443 : 80)}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return target;
  }
}

export function TunnelsPanel({ filter }: { filter: string }) {
  const views = useTunnels((s) => s.views);
  const active = useActiveTab();
  const q = filter.trim().toLowerCase();
  const list = q
    ? views.filter((v) => `${v.config.name} ${v.config.target}`.toLowerCase().includes(q))
    : views;

  if (views.length === 0) {
    return (
      <div className="space-y-4 px-4 pt-2 text-xs">
        <p className="leading-relaxed text-fg-muted">
          Receba webhooks (Stripe, Mercado Pago, GitHub…) na API que roda na sua máquina, com uma URL https
          pública.
        </p>
        <TunnelSteps compact />
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="sm" onClick={() => void newTunnel()}>
            <Plus className="size-3.5" /> Criar túnel
          </Button>
          <Button size="sm" variant="ghost" onClick={openTunnelGuide}>
            <CircleHelp className="size-3.5" /> Ver o passo a passo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ul className="space-y-0.5 px-2">
      {list.map((view) => (
        <TunnelItem
          key={view.config.id}
          view={view}
          selected={active?.kind === 'tunnel' && active.itemId === view.config.id}
        />
      ))}
      {list.length === 0 && (
        <li className="px-2 py-4 text-center text-xs text-fg-subtle">Nada encontrado.</li>
      )}
    </ul>
  );
}

function TunnelItem({ view, selected }: { view: TunnelView; selected: boolean }) {
  const { config, status } = view;
  const on = status === 'running' || status === 'starting';
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => openTunnel(config.id)}
        onKeyDown={(e) => e.key === 'Enter' && openTunnel(config.id)}
        className={cn(
          'group flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors',
          selected ? 'bg-surface-2' : 'hover:bg-surface-2/60',
        )}
      >
        <StatusDot status={status} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-fg">{config.name}</p>
          <p className="truncate font-mono text-2xs text-fg-subtle">
            {targetLabel(config.target)}
            {view.exchanges.length > 0 &&
              ` · ${view.exchanges.length} chamada${view.exchanges.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <IconButton
          icon={on ? Square : Play}
          label={on ? 'Desligar' : 'Ligar'}
          size="sm"
          className={cn(!on && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
          disabled={status === 'starting'}
          onClick={(e) => {
            e.stopPropagation();
            void (on ? stopTunnel(config.id) : startTunnel(config.id));
          }}
        />
      </div>
    </li>
  );
}

export function TunnelsActions() {
  return (
    <>
      <IconButton icon={CircleHelp} label="Como usar" size="sm" onClick={openTunnelGuide} />
      <IconButton icon={Plus} label="Novo túnel" size="sm" onClick={() => void newTunnel()} />
    </>
  );
}
