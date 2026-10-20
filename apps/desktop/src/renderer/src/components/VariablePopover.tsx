import type { VariableTarget } from '@rota/core/shared';
import { Check, Copy, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, errorMessage, runCommand } from '../lib/api';
import { cn } from '../lib/cn';
import { useVariableResolver, useVariableTargets } from '../lib/variables';
import { toast } from '../state/toasts';
import { Button } from './Button';
import { IconButton } from './IconButton';

/**
 * Popover de uma {{variável}} ao passar o mouse (campos e editor de corpo),
 * como no Postman: mostra o valor, deixa editar e, nas secretas, revelar
 * pelo olho. O valor secreto só vem do processo principal ao clicar e some
 * quando o popover fecha.
 */

const WIDTH = 384;
const CLOSE_DELAY = 220;

export interface VariableHover {
  name: string;
  x: number;
  y: number;
}

/** Abre ao passar o mouse e fecha com um pequeno atraso, para dar tempo de chegar ao popover. */
export function useVariableHover() {
  const [hover, setHover] = useState<VariableHover | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);
  // O Monaco avisa que o mouse saiu do editor depois que ele já entrou no popover.
  const inside = useRef(false);

  const cancelClose = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const close = useCallback(() => {
    cancelClose();
    pinned.current = false;
    inside.current = false;
    setHover(null);
  }, [cancelClose]);
  const scheduleClose = useCallback(() => {
    cancelClose();
    if (pinned.current || inside.current) return;
    timer.current = setTimeout(() => setHover(null), CLOSE_DELAY);
  }, [cancelClose]);
  const enter = useCallback(() => {
    inside.current = true;
    cancelClose();
  }, [cancelClose]);
  const leave = useCallback(() => {
    inside.current = false;
    scheduleClose();
  }, [scheduleClose]);
  const show = useCallback(
    (next: VariableHover) => {
      cancelClose();
      // Popover em uso (editando ou com o segredo à mostra): não troca de variável.
      if (pinned.current) return;
      setHover((current) => (current?.name === next.name ? current : next));
    },
    [cancelClose],
  );
  const pin = useCallback((value: boolean) => {
    pinned.current = value;
  }, []);

  useEffect(() => cancelClose, [cancelClose]);

  return { hover, show, scheduleClose, enter, leave, close, pin };
}

export function VariablePopover({
  hover,
  onEnter,
  onLeave,
  onClose,
  onPin,
}: {
  hover: VariableHover;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
  onPin: (pinned: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const info = useVariableResolver()(hover.name);
  const targets = useVariableTargets();
  const [draft, setDraft] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newTarget, setNewTarget] = useState(0);

  const editing = draft !== null;
  const pinned = editing || revealed !== null;
  useEffect(() => onPin(pinned), [pinned, onPin]);

  // Fixo (editando ou com segredo à mostra): fecha com clique fora ou Esc.
  useEffect(() => {
    if (!pinned) return;
    const down = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [pinned, onClose]);

  const left = Math.max(8, Math.min(hover.x, window.innerWidth - WIDTH - 8));
  const top = Math.min(hover.y, window.innerHeight - 120);

  async function reveal(target: VariableTarget) {
    if (revealed !== null) {
      setRevealed(null);
      setDraft(null);
      return;
    }
    setLoading(true);
    try {
      setRevealed((await api.invoke('secrets:reveal', target, hover.name)) ?? '');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function save(target: VariableTarget, value: string) {
    setSaving(true);
    const done = await runCommand({ type: 'setVariable', target, key: hover.name, value });
    setSaving(false);
    if (!done) return;
    toast.success(`Variável "${hover.name}" salva.`);
    onClose();
  }

  function editKeys(event: KeyboardEvent<HTMLTextAreaElement>, target: VariableTarget) {
    // Enter salva; Shift+Enter quebra a linha (valores de uma linha são a regra).
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (draft !== null) void save(target, draft);
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success('Valor copiado.');
  }

  const valueBox = (text: string, muted = false) => (
    <div
      className={cn(
        'max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-surface-2 px-2 py-1.5 font-mono text-2xs',
        muted ? 'text-fg-subtle' : 'text-fg',
      )}
    >
      {text}
    </div>
  );

  let body: React.ReactNode;
  if (!info) {
    const option = targets[newTarget] ?? targets[0];
    body = (
      <>
        <p className="text-fg-muted">Variável não definida. Crie agora:</p>
        <div className="flex flex-wrap gap-1">
          {targets.map((t, i) => (
            <button
              key={t.label}
              type="button"
              onClick={() => setNewTarget(i)}
              className={cn(
                'rounded-md px-2 py-0.5 text-2xs transition-colors',
                i === newTarget
                  ? 'bg-primary-soft text-primary'
                  : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <textarea
          value={draft ?? ''}
          rows={1}
          spellCheck={false}
          placeholder="Valor"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => option && editKeys(e, option.target)}
          className="max-h-32 w-full resize-none rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-2xs text-fg outline-none focus:border-primary"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="primary"
            disabled={!option || saving}
            onClick={() => option && void save(option.target, draft ?? '')}
          >
            Criar
          </Button>
        </div>
      </>
    );
  } else if (info.source === 'dynamic') {
    body = (
      <>
        {info.description && <p className="text-fg-muted">{info.description}</p>}
        {valueBox(info.display)}
      </>
    );
  } else {
    const target = info.target;
    const current = info.secret ? revealed : info.raw;
    body = (
      <>
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            spellCheck={false}
            rows={Math.min(6, Math.max(1, Math.ceil(draft.length / 52)))}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => target && editKeys(e, target)}
            className="w-full resize-none rounded-md border border-primary bg-surface-2 px-2 py-1.5 font-mono text-2xs text-fg outline-none"
          />
        ) : current !== null ? (
          <button
            type="button"
            title={target ? 'Clique para editar' : undefined}
            disabled={!target}
            onClick={() => setDraft(current)}
            className="block w-full cursor-pointer text-left disabled:cursor-default"
          >
            {valueBox(current || '(vazio)', current === '')}
          </button>
        ) : (
          valueBox(info.display === '' ? '(sem valor salvo)' : '••••••••••••', true)
        )}
        {info.secret || info.display === info.raw ? null : (
          <p className="text-2xs text-fg-subtle">
            Resolvido: <span className="break-all font-mono">{info.display}</span>
          </p>
        )}
        <div className="flex items-center gap-1">
          {info.secret && target && (
            <IconButton
              size="sm"
              icon={loading ? LoaderCircle : revealed !== null ? EyeOff : Eye}
              label={revealed !== null ? 'Ocultar valor' : 'Mostrar valor'}
              onClick={() => void reveal(target)}
            />
          )}
          {current !== null && current !== '' && (
            <IconButton size="sm" icon={Copy} label="Copiar valor" onClick={() => void copy(current)} />
          )}
          <div className="flex-1" />
          {target && !editing && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => (info.secret && revealed === null ? setDraft('') : setDraft(current ?? ''))}
            >
              {info.secret && revealed === null ? 'Trocar valor' : 'Editar'}
            </Button>
          )}
          {editing && target && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Cancelar
              </Button>
              <Button size="sm" variant="primary" disabled={saving} onClick={() => void save(target, draft)}>
                <Check className="size-3.5" /> Salvar
              </Button>
            </>
          )}
        </div>
        {editing && (
          <p className="text-2xs text-fg-subtle">Enter salva · Shift+Enter quebra a linha · Esc fecha</p>
        )}
        {!target && (
          <p className="text-2xs text-fg-subtle">Variável local (definida por script): só leitura.</p>
        )}
      </>
    );
  }

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Variável ${hover.name}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="fixed z-50 flex flex-col gap-2 rounded-lg border border-border bg-elevated p-2.5 text-xs shadow-xl shadow-black/40 animate-fade-in"
      style={{ left, top, width: WIDTH }}
    >
      <div className="flex items-center gap-2">
        <span className={cn('truncate font-mono', info ? 'text-primary' : 'text-danger')}>{hover.name}</span>
        {info && <span className="shrink-0 text-2xs text-fg-subtle">{info.sourceLabel}</span>}
        {info?.secret && (
          <span className="shrink-0 rounded bg-warning/15 px-1.5 text-2xs text-warning">secreta</span>
        )}
      </div>
      {body}
    </div>,
    document.body,
  );
}
