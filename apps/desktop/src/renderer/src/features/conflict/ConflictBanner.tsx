import type { FieldChange } from '@rota/core/shared';
import { ChevronDown, FileWarning } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { cn } from '../../lib/cn';
import { type Tab, useTabs } from '../../state/tabs';

const KIND_LABEL: Record<Tab['kind'], string> = {
  request: 'Esta requisição',
  environment: 'Este ambiente',
  globals: 'As variáveis globais',
  collection: 'Esta coleção',
  folder: 'Esta pasta',
};

/**
 * Aviso exibido quando o arquivo de uma aba com alterações não salvas muda
 * fora do app (outro editor, git pull, MCP). Mostra exatamente o que mudou
 * para o usuário decidir.
 */
export function ConflictBanner({ tab }: { tab: Tab }) {
  const resolve = useTabs((s) => s.resolveConflict);
  const [open, setOpen] = useState(true);
  const conflict = tab.conflict;
  if (!conflict) return null;

  if (conflict.type === 'deleted') {
    return (
      <div className="shrink-0 border-b border-warning/40 bg-warning/10 px-4 py-3 animate-fade-in">
        <div className="flex flex-wrap items-center gap-3">
          <FileWarning className="size-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1 text-[13px]">
            <p className="font-medium text-fg">{KIND_LABEL[tab.kind]} foi excluída fora do app.</p>
            <p className="text-xs text-fg-muted">
              O arquivo sumiu do disco (excluído em outro editor, por um git pull/checkout ou pelo Claude via
              MCP). Suas alterações ainda estão nesta aba.
            </p>
          </div>
          {tab.kind === 'request' && (
            <Button size="sm" onClick={() => resolve(tab.id, 'keep')}>
              Manter como nova requisição
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => resolve(tab.id, 'reload')}>
            Fechar aba
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-warning/40 bg-warning/10 animate-fade-in">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <FileWarning className="size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1 text-[13px]">
          <p className="font-medium text-fg">
            {KIND_LABEL[tab.kind]} foi alterada fora do app enquanto você editava.
          </p>
          <p className="text-xs text-fg-muted">
            O arquivo no disco mudou ({conflict.changes.length}{' '}
            {conflict.changes.length === 1 ? 'diferença' : 'diferenças'} em relação à versão que você abriu).
            Escolha qual versão manter.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          {open ? 'Ocultar' : 'Ver'} detalhes
          <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
        </Button>
        <Button size="sm" onClick={() => resolve(tab.id, 'reload')}>
          Usar a versão do disco
        </Button>
        <Button size="sm" variant="primary" onClick={() => resolve(tab.id, 'keep')}>
          Manter as minhas alterações
        </Button>
      </div>
      {open && (
        <div className="max-h-72 overflow-auto border-t border-warning/20 px-4 py-3">
          <p className="mb-2 text-xs text-fg-muted">
            O que mudou no disco: <span className="text-danger">−</span> versão que você abriu ·{' '}
            <span className="text-success">+</span> versão atual no disco. "Manter as minhas" não grava nada
            até você salvar (Ctrl+S), e ao salvar a versão do disco será sobrescrita.
          </p>
          <ChangeList changes={conflict.changes} />
        </div>
      )}
    </div>
  );
}

export function ChangeList({ changes }: { changes: FieldChange[] }) {
  if (changes.length === 0) {
    return <p className="text-xs text-fg-muted">Só a formatação ou a ordem dos campos mudou.</p>;
  }
  return (
    <ul className="space-y-2">
      {changes.map((change, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lista estática
        <li key={i} className="rounded-md border border-border bg-bg p-2.5 text-xs">
          <p className="font-medium text-fg">{change.field}</p>
          {change.lines ? (
            <pre className="mt-1.5 max-h-48 select-text overflow-auto font-mono text-2xs leading-5">
              {change.lines.map((line, j) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: linhas do diff
                  key={j}
                  className={cn(
                    'whitespace-pre-wrap px-1',
                    line.type === 'removed' && 'bg-danger/10 text-danger',
                    line.type === 'added' && 'bg-success/10 text-success',
                    line.type === 'same' && 'text-fg-subtle',
                  )}
                >
                  {line.type === 'removed' ? '− ' : line.type === 'added' ? '+ ' : '  '}
                  {line.text || ' '}
                </div>
              ))}
            </pre>
          ) : (
            <div className="mt-1 space-y-0.5 font-mono">
              {change.before !== undefined && (
                <p className="break-all text-danger">
                  <span className="select-none">− </span>
                  {change.before || '(vazio)'}
                </p>
              )}
              {change.after !== undefined && (
                <p className="break-all text-success">
                  <span className="select-none">+ </span>
                  {change.after || '(vazio)'}
                </p>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
