import { ChevronDown, PanelLeftOpen } from 'lucide-react';
import { cn } from '../lib/cn';
import { Tooltip } from './Tooltip';

/**
 * O que sobra de um painel recolhido: uma faixa clicável que o abre de novo.
 * `vertical` é a faixa estreita de um painel lateral (só o ícone).
 */
export function CollapsedStrip({
  label,
  vertical = false,
  onExpand,
}: {
  label: string;
  vertical?: boolean;
  onExpand: () => void;
}) {
  const button = (
    <button
      type="button"
      onClick={onExpand}
      aria-label={`Mostrar: ${label}`}
      className={cn(
        'flex size-full items-center text-xs text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg',
        vertical ? 'justify-center' : 'gap-2 px-4',
      )}
    >
      {vertical ? (
        <PanelLeftOpen className="size-4" strokeWidth={1.75} />
      ) : (
        <>
          <ChevronDown className="size-3.5" />
          <span className="font-medium">{label}</span>
          <span className="text-fg-subtle">· clique para mostrar</span>
        </>
      )}
    </button>
  );
  return vertical ? (
    <Tooltip label={`Mostrar: ${label}`} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}
