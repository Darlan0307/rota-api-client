import {
  type ColumnProfile,
  columnNote,
  fillPercent,
  profileHeadline,
  profileToMarkdown,
  type TableProfile,
} from '@rota/core/shared';
import { AlertTriangle, FileText, KeyRound, LoaderCircle, RefreshCw, Square } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../../components/Button';
import { cn } from '../../lib/cn';
import { toast } from '../../state/toasts';
import { cancelProfile, type ProfileState } from './profile-state';

/** Perfil da tabela: um cartão por coluna. */
export function ProfileView({
  connectionId,
  state,
  onRetry,
  extraActions,
}: {
  connectionId: string;
  state: ProfileState;
  onRetry: () => void;
  extraActions?: (profile: TableProfile) => ReactNode;
}) {
  if (state.status === 'running')
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-xs text-fg-muted">
        <LoaderCircle className="size-5 animate-spin text-primary" />
        <p>
          Analisando <span className="font-mono text-fg">{state.table}</span>
          {state.steps > 0 && ` (${Math.round((state.done / state.steps) * 100)}%)`}…
        </p>
        <div className="h-1 w-56 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${state.steps ? (state.done / state.steps) * 100 : 3}%` }}
          />
        </div>
        <Button size="sm" onClick={() => cancelProfile(connectionId)}>
          <Square className="size-3.5" /> Cancelar
        </Button>
      </div>
    );

  if (state.status === 'error' || !state.profile)
    return (
      <div className="space-y-3 p-4 text-xs">
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-fg">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-danger" />
          <p className="whitespace-pre-wrap">{state.error ?? 'Não foi possível analisar a tabela.'}</p>
        </div>
        <Button size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" /> Analisar de novo
        </Button>
      </div>
    );

  const profile = state.profile;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-xs text-fg-muted">
          <span className="font-mono text-fg">{profile.table}</span> · {profileHeadline(profile)}
          {profile.sampled && (
            <span className="text-warning"> (tabela grande: valores calculados sobre a amostra)</span>
          )}
        </p>
        {extraActions?.(profile)}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(profileToMarkdown(profile));
            toast.success('Perfil copiado em Markdown.');
          }}
        >
          <FileText className="size-3.5" /> Copiar em Markdown
        </Button>
        <Button size="sm" variant="ghost" onClick={onRetry} title="Analisar de novo">
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border p-3">
        {profile.total === 0 ? (
          <p className="p-2 text-xs text-fg-muted">A tabela está vazia.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
            {profile.columns.map((column) => (
              <ColumnCard key={column.name} column={column} analyzed={profile.analyzed} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ColumnCard({ column, analyzed }: { column: ColumnProfile; analyzed: number }) {
  const ratio = analyzed ? column.filled / analyzed : 0;
  const note = columnNote(column, analyzed);
  const maxTop = column.top[0]?.count ?? 1;
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface p-2.5 text-xs">
      <div className="flex items-center gap-1.5">
        {column.primaryKey && <KeyRound className="size-3 shrink-0 text-warning" />}
        <span className="min-w-0 flex-1 truncate font-mono font-medium text-fg" title={column.name}>
          {column.name}
        </span>
        {note && (
          <span
            className={cn(
              'shrink-0 rounded px-1 text-2xs',
              note === 'sempre vazia' ? 'bg-warning/15 text-warning' : 'bg-primary-soft text-primary',
            )}
          >
            {note}
          </span>
        )}
      </div>
      <p className="mt-0.5 truncate font-mono text-2xs text-fg-subtle" title={column.type}>
        {column.type}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-success" style={{ width: `${ratio * 100}%` }} />
        </div>
        <span className="shrink-0 font-mono text-2xs text-fg-muted" title={`${column.filled} preenchidas`}>
          {fillPercent(column, analyzed)} preenchido
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-2xs">
        {column.distinct !== null && (
          <>
            <dt className="text-fg-subtle">Distintos</dt>
            <dd className="font-mono text-fg">{column.distinct.toLocaleString('pt-BR')}</dd>
          </>
        )}
        {column.min !== null && (
          <>
            <dt className="text-fg-subtle">Mín · Máx</dt>
            <dd className="truncate font-mono text-fg" title={`${column.min} · ${column.max}`}>
              {String(column.min)} · {String(column.max)}
            </dd>
          </>
        )}
        {column.kind === 'large' && (
          <dd className="col-span-2 text-fg-subtle">Tipo grande: só a contagem de preenchidos.</dd>
        )}
      </dl>

      {column.top.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {column.top.map((t) => (
            <li key={String(t.value)} className="flex items-center gap-2 text-2xs">
              <span className="min-w-0 flex-1 truncate font-mono text-fg" title={String(t.value)}>
                {t.value === null ? 'NULL' : String(t.value)}
              </span>
              <span className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full bg-primary/70"
                  style={{ width: `${(t.count / maxTop) * 100}%` }}
                />
              </span>
              <span className="w-10 shrink-0 text-right font-mono text-fg-muted">{t.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
