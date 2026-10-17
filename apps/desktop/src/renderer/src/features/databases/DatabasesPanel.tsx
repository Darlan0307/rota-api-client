import type { DbConnectionStatus, DbConnectionView, DbEnvironment } from '@rota/core/shared';
import { KeyRound, Lock, Pencil, Plus } from 'lucide-react';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { cn } from '../../lib/cn';
import { useActiveTab } from '../../state/tabs';
import { openConnection, openConnectionDialog, setCredentialsOpen, useDatabases } from './state';

export const ENVIRONMENT_LABEL: Record<DbEnvironment, string> = {
  local: 'Local',
  teste: 'Teste',
  producao: 'Produção',
};

export function EnvironmentBadge({
  environment,
  className,
}: {
  environment: DbEnvironment;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1 text-2xs font-medium',
        environment === 'producao' && 'bg-danger/15 text-danger',
        environment === 'teste' && 'bg-warning/15 text-warning',
        environment === 'local' && 'bg-surface-2 text-fg-muted',
        className,
      )}
    >
      {ENVIRONMENT_LABEL[environment]}
    </span>
  );
}

export function ConnectionDot({ status }: { status: DbConnectionStatus }) {
  return (
    <span
      title={
        status === 'connected'
          ? 'Conectado'
          : status === 'connecting'
            ? 'Conectando…'
            : status === 'error'
              ? 'Erro ao conectar'
              : 'Desconectado'
      }
      className={cn(
        'size-2 shrink-0 rounded-full',
        status === 'connected' && 'bg-success',
        status === 'connecting' && 'animate-pulse bg-warning',
        status === 'error' && 'bg-danger',
        status === 'disconnected' && 'bg-border-strong',
      )}
    />
  );
}

export function DatabasesPanel({ filter }: { filter: string }) {
  const connections = useDatabases((s) => s.connections);
  const active = useActiveTab();
  const q = filter.trim().toLowerCase();
  const list = q
    ? connections.filter((c) =>
        `${c.config.name} ${c.config.host} ${c.config.database}`.toLowerCase().includes(q),
      )
    : connections;

  if (connections.length === 0) {
    return (
      <div className="space-y-4 px-4 pt-2 text-xs">
        <p className="leading-relaxed text-fg-muted">
          Conecte direto no Firebird dos clientes (2.5 ou mais novo) para ver tabelas e rodar consultas, sem
          instalar nada. Bancos de produção começam somente leitura.
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="sm" onClick={() => openConnectionDialog()}>
            <Plus className="size-3.5" /> Nova conexão
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCredentialsOpen(true)}>
            <KeyRound className="size-3.5" /> Credenciais salvas
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ul className="space-y-0.5 px-2">
      {list.map((view) => (
        <ConnectionItem
          key={view.config.id}
          view={view}
          selected={active?.kind === 'database' && active.itemId === view.config.id}
        />
      ))}
      {list.length === 0 && (
        <li className="px-2 py-4 text-center text-xs text-fg-subtle">Nada encontrado.</li>
      )}
    </ul>
  );
}

function ConnectionItem({ view, selected }: { view: DbConnectionView; selected: boolean }) {
  const { config } = view;
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => openConnection(config.id)}
        onKeyDown={(e) => e.key === 'Enter' && openConnection(config.id)}
        className={cn(
          'group flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors',
          selected ? 'bg-surface-2' : 'hover:bg-surface-2/60',
        )}
      >
        <ConnectionDot status={view.status} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[13px] text-fg">
            <span className="truncate">{config.name}</span>
            {config.readOnly && (
              <Lock className="size-3 shrink-0 text-fg-subtle" aria-label="Somente leitura" />
            )}
          </p>
          <p className="flex items-center gap-1.5 text-2xs text-fg-subtle">
            <EnvironmentBadge environment={config.environment} />
            <span className="truncate font-mono">
              {config.host}:{config.database}
            </span>
          </p>
        </div>
        <IconButton
          icon={Pencil}
          label="Editar conexão"
          size="sm"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            openConnectionDialog(config.id);
          }}
        />
      </div>
    </li>
  );
}

export function DatabasesActions() {
  return (
    <>
      <IconButton
        icon={KeyRound}
        label="Credenciais salvas"
        size="sm"
        onClick={() => setCredentialsOpen(true)}
      />
      <IconButton icon={Plus} label="Nova conexão" size="sm" onClick={() => openConnectionDialog()} />
    </>
  );
}
