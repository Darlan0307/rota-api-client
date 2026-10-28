import {
  type AutoHeader,
  automaticHeaders,
  type EffectiveAuth,
  type RequestData,
  type ToggleableAutoHeader,
} from '@rota/core/shared';
import { ChevronDown, ChevronRight, Lock, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Checkbox } from '../../components/form';
import { Tooltip } from '../../components/Tooltip';
import { useUserAgent } from '../../lib/app-info';
import { cn } from '../../lib/cn';

const OPEN_KEY = 'rota.autoHeaders.open';

const SOURCE_LABEL: Record<AutoHeader['source'], string> = {
  body: 'Corpo',
  auth: 'Autenticação',
  default: 'Padrão',
  connection: 'Conexão',
};

const LOCKED_HINT: Record<AutoHeader['source'], string> = {
  body: 'Calculado pelo corpo multipart (o boundary muda a cada envio).',
  auth: 'Vem da aba Autenticação. Para não enviar, mude a autenticação ou defina o header na tabela.',
  default: '',
  connection:
    'Faz parte da conexão HTTP e sempre é enviado. Um header da tabela com o mesmo nome toma o lugar.',
};

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * Headers que o Rota acrescenta sozinho (como os "ocultos" do Postman): cada um
 * pode ser desligado ou substituído por um header da tabela.
 */
export function AutoHeaders({
  data,
  auth,
  onChange,
  onOverride,
  onOpenAuth,
}: {
  data: RequestData;
  auth: EffectiveAuth['auth'];
  onChange: (data: RequestData) => void;
  /** Copia o header para a tabela, onde ele pode ser editado. */
  onOverride: (header: AutoHeader) => void;
  onOpenAuth: () => void;
}) {
  const userAgent = useUserAgent();
  const [open, setOpen] = useState(readOpen);
  const headers = automaticHeaders(data, auth, userAgent ? { userAgent } : {});
  const active = headers.filter((h) => !h.disabled && !h.overridden).length;

  const toggleOpen = () => {
    setOpen((value) => {
      try {
        localStorage.setItem(OPEN_KEY, value ? '0' : '1');
      } catch {
        // sem armazenamento: só não lembra a escolha
      }
      return !value;
    });
  };

  const setDisabled = (name: ToggleableAutoHeader, disabled: boolean) => {
    const current = new Set(data.settings.disabledAutoHeaders ?? []);
    if (disabled) current.add(name);
    else current.delete(name);
    const { disabledAutoHeaders: _old, ...rest } = data.settings;
    onChange({ ...data, settings: current.size ? { ...rest, disabledAutoHeaders: [...current] } : rest });
  };

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-fg"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        Headers automáticos
        <span className="rounded bg-surface-2 px-1 font-mono text-2xs">{active}</span>
      </button>
      {open && (
        <div className="mt-2 overflow-hidden rounded-lg border border-border text-xs">
          {headers.map((h) => (
            <AutoHeaderRow
              key={h.key + h.source}
              header={h}
              onToggle={(enabled) => h.toggle && setDisabled(h.toggle, !enabled)}
              onOverride={() => onOverride(h)}
              onOpenAuth={onOpenAuth}
            />
          ))}
        </div>
      )}
      {open && (
        <p className="mt-2 text-xs text-fg-subtle">
          Desmarque para não enviar. Um header da tabela com o mesmo nome toma o lugar do automático.
        </p>
      )}
    </div>
  );
}

function AutoHeaderRow({
  header: h,
  onToggle,
  onOverride,
  onOpenAuth,
}: {
  header: AutoHeader;
  onToggle: (enabled: boolean) => void;
  onOverride: () => void;
  onOpenAuth: () => void;
}) {
  const inactive = h.disabled || h.overridden;
  return (
    <div
      className={cn(
        'group grid h-8 grid-cols-[28px_9.5rem_minmax(0,1fr)_auto] items-center border-b border-border last:border-b-0',
        inactive && 'opacity-55',
      )}
    >
      <div className="flex justify-center">
        {h.toggle ? (
          <Checkbox checked={!h.disabled} label={`Enviar ${h.key}`} onChange={onToggle} />
        ) : (
          <Tooltip label={LOCKED_HINT[h.source]}>
            <span className="flex size-4 items-center justify-center text-fg-subtle">
              <Lock className="size-3" />
            </span>
          </Tooltip>
        )}
      </div>
      <div className={cn('truncate px-2 font-mono text-fg-muted', inactive && 'line-through')}>{h.key}</div>
      <div
        className={cn('truncate px-2 font-mono', h.calculated ? 'text-fg-subtle italic' : 'text-fg-muted')}
        title={h.value}
      >
        {h.value}
      </div>
      <div className="flex items-center justify-end gap-1.5 pr-2">
        {h.overridden && <span className="text-2xs text-warning">substituído pela tabela</span>}
        {!h.overridden && !h.calculated && h.source !== 'auth' && (
          <Tooltip label="Copiar para a tabela e editar">
            <button
              type="button"
              aria-label={`Editar ${h.key} na tabela`}
              onClick={onOverride}
              className="flex size-6 items-center justify-center rounded text-fg-subtle opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg focus:opacity-100 group-hover:opacity-100"
            >
              <Pencil className="size-3" />
            </button>
          </Tooltip>
        )}
        {h.source === 'auth' ? (
          <button
            type="button"
            onClick={onOpenAuth}
            className="rounded bg-surface-2 px-1.5 text-2xs text-fg-muted transition-colors hover:text-fg"
          >
            {SOURCE_LABEL[h.source]}
          </button>
        ) : (
          <span className="rounded bg-surface-2 px-1.5 text-2xs text-fg-subtle">
            {SOURCE_LABEL[h.source]}
          </span>
        )}
      </div>
    </div>
  );
}
