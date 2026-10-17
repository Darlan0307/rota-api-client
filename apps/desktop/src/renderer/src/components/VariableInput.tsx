import { findVariableRefs, variableRefAt } from '@rota/core/shared';
import {
  type ClipboardEvent,
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { useVariableNames, useVariableResolver, type VariableInfo } from '../lib/variables';

interface VariableInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Altura/tamanho da fonte. */
  size?: 'sm' | 'md';
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  ariaLabel?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}

const FONT_SIZE = { sm: 12, md: 13 } as const;
const PADDING_X = { sm: 8, md: 12 } as const;

/** Largura de um caractere da fonte monoespaçada (cacheada por tamanho). */
const charWidthCache = new Map<number, number>();
function charWidth(fontSize: number): number {
  const cached = charWidthCache.get(fontSize);
  if (cached) return cached;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return fontSize * 0.6;
  ctx.font = `${fontSize}px 'JetBrains Mono Variable', Consolas, monospace`;
  const width = ctx.measureText('M'.repeat(100)).width / 100;
  // Só cacheia depois que a fonte carregou (senão mediria a fonte fallback).
  if (document.fonts.check(`${fontSize}px 'JetBrains Mono Variable'`)) charWidthCache.set(fontSize, width);
  return width;
}

/**
 * Campo de texto de uma linha que destaca `{{variáveis}}`: verde-primário se
 * definidas, vermelho se não; mostra o valor resolvido ao passar o mouse e
 * sugere nomes ao digitar `{{`.
 */
export const VariableInput = forwardRef<HTMLInputElement, VariableInputProps>(function VariableInput(
  {
    value,
    onChange,
    placeholder,
    className,
    size = 'md',
    onKeyDown,
    onPaste,
    onBlur,
    ariaLabel,
    autoFocus,
    disabled,
  },
  forwardedRef,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

  const resolve = useVariableResolver();
  const names = useVariableNames();
  const [hover, setHover] = useState<{
    info: VariableInfo | undefined;
    name: string;
    x: number;
    y: number;
  } | null>(null);
  const [suggest, setSuggest] = useState<{ start: number; query: string; index: number } | null>(null);

  const syncScroll = useCallback(() => {
    if (overlayRef.current && inputRef.current) overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: precisa ressincronizar a cada mudança de texto
  useLayoutEffect(syncScroll, [value, syncScroll]);

  // Foco com o cursor no fim (o autoFocus nativo deixaria o cursor no início).
  // biome-ignore lint/correctness/useExhaustiveDependencies: só na montagem
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!autoFocus || !input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const segments = useMemo(() => {
    const parts: ReactNode[] = [];
    let last = 0;
    for (const ref of findVariableRefs(value)) {
      if (ref.start > last) parts.push(value.slice(last, ref.start));
      const defined = resolve(ref.name) !== undefined;
      parts.push(
        <span
          key={ref.start}
          className={cn(
            'rounded-[3px]',
            defined ? 'bg-primary-soft text-primary' : 'bg-danger/15 text-danger',
          )}
        >
          {value.slice(ref.start, ref.end)}
        </span>,
      );
      last = ref.end;
    }
    if (last < value.length) parts.push(value.slice(last));
    return parts;
  }, [value, resolve]);

  const suggestions = useMemo(() => {
    if (!suggest) return [];
    const q = suggest.query.toLowerCase();
    return names.filter((n) => n.toLowerCase().includes(q)).slice(0, 8);
  }, [suggest, names]);

  function updateSuggest(text: string, caret: number) {
    const before = text.slice(0, caret);
    const open = before.lastIndexOf('{{');
    if (open >= 0 && !before.slice(open).includes('}}') && /^[\w.$-]*$/.test(before.slice(open + 2))) {
      setSuggest((s) => ({ start: open, query: before.slice(open + 2), index: s?.index ?? 0 }));
    } else {
      setSuggest(null);
    }
  }

  function applySuggestion(name: string) {
    const input = inputRef.current;
    if (!input || !suggest) return;
    const caret = input.selectionStart ?? value.length;
    const after = value.slice(caret).replace(/^[\w.$-]*\}{0,2}/, '');
    const next = `${value.slice(0, suggest.start)}{{${name}}}${after}`;
    onChange(next);
    setSuggest(null);
    const pos = suggest.start + name.length + 4;
    requestAnimationFrame(() => {
      input.setSelectionRange(pos, pos);
      syncScroll();
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (suggest && suggestions.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setSuggest({ ...suggest, index: (suggest.index + delta + suggestions.length) % suggestions.length });
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        applySuggestion(suggestions[suggest.index] ?? suggestions[0] ?? '');
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setSuggest(null);
        return;
      }
    }
    onKeyDown?.(event);
  }

  function handleMouseMove(event: React.MouseEvent<HTMLInputElement>) {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const x = event.clientX - rect.left - PADDING_X[size] + input.scrollLeft;
    const index = Math.floor(x / charWidth(FONT_SIZE[size]));
    const ref = variableRefAt(value, index);
    if (!ref) {
      if (hover) setHover(null);
      return;
    }
    if (hover?.name === ref.name) return;
    const refX = rect.left + PADDING_X[size] + ref.start * charWidth(FONT_SIZE[size]) - input.scrollLeft;
    setHover({ info: resolve(ref.name), name: ref.name, x: Math.max(8, refX), y: rect.bottom + 6 });
  }

  const inputRect = inputRef.current?.getBoundingClientRect();

  return (
    <div className={cn('relative min-w-0 flex-1', className)}>
      <div
        ref={overlayRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre font-mono text-fg"
        style={{ fontSize: FONT_SIZE[size], paddingLeft: PADDING_X[size], paddingRight: PADDING_X[size] }}
      >
        <span>{segments}</span>
      </div>
      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          updateSuggest(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={syncScroll}
        onSelect={syncScroll}
        onScroll={syncScroll}
        onPaste={onPaste}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
        onBlur={() => {
          setSuggest(null);
          onBlur?.();
        }}
        className={cn(
          'relative w-full bg-transparent font-mono text-transparent caret-fg outline-none',
          'placeholder:font-sans placeholder:text-fg-subtle selection:bg-primary-soft selection:text-fg',
          size === 'md' ? 'h-full' : 'h-7',
        )}
        style={{ fontSize: FONT_SIZE[size], paddingLeft: PADDING_X[size], paddingRight: PADDING_X[size] }}
      />

      {hover &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 max-w-md rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs shadow-lg shadow-black/30 animate-fade-in"
            style={{ left: hover.x, top: hover.y }}
          >
            {hover.info ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-primary">{hover.name}</span>
                  <span className="text-2xs text-fg-subtle">{hover.info.sourceLabel}</span>
                </div>
                <div className="mt-0.5 break-all font-mono text-fg">{hover.info.display || '(vazio)'}</div>
              </>
            ) : (
              <div>
                <span className="font-mono text-danger">{hover.name}</span>
                <span className="text-fg-muted">: variável não definida no ambiente ativo</span>
              </div>
            )}
          </div>,
          document.body,
        )}

      {suggest &&
        suggestions.length > 0 &&
        inputRect &&
        createPortal(
          <ul
            role="listbox"
            className="fixed z-50 min-w-48 overflow-hidden rounded-lg border border-border bg-elevated p-1 shadow-xl shadow-black/40 animate-pop-in"
            style={{
              left:
                inputRect.left +
                PADDING_X[size] +
                suggest.start * charWidth(FONT_SIZE[size]) -
                (inputRef.current?.scrollLeft ?? 0),
              top: inputRect.bottom + 4,
            }}
          >
            {suggestions.map((name, i) => {
              const info = resolve(name);
              return (
                <li
                  key={name}
                  role="option"
                  aria-selected={i === suggest.index}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(name);
                  }}
                  className={cn(
                    'flex items-center justify-between gap-4 rounded-md px-2 py-1 text-xs',
                    i === suggest.index ? 'bg-surface-2 text-fg' : 'text-fg-muted',
                  )}
                >
                  <span className="font-mono">{name}</span>
                  <span className="max-w-40 truncate font-mono text-2xs text-fg-subtle">{info?.display}</span>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
});
