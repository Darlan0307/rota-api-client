import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/cn';

// ---------------------------------------------------------------------------
// Checkbox

export function Checkbox({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
        checked
          ? 'border-primary bg-primary text-primary-fg'
          : 'border-border-strong bg-transparent hover:border-fg-subtle',
        className,
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Switch

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <p className="text-[13px] text-fg">{label}</p>
        {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-150',
          checked ? 'bg-primary' : 'bg-border-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0 size-4 rounded-full bg-fg shadow transition-transform duration-150',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Select (lista de opções num dropdown)

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  className?: string;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
  triggerClassName,
  ariaLabel,
  align = 'start',
}: {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  triggerClassName?: string;
  ariaLabel?: string;
  align?: 'start' | 'end';
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            'flex h-7 items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-xs text-fg transition-colors hover:border-border-strong data-[state=open]:border-border-strong',
            triggerClassName,
          )}
        >
          <span className={cn('truncate', current?.className)}>{current?.label ?? value}</span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align={align}
          sideOffset={4}
          className={cn(
            'z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-40 overflow-y-auto rounded-lg border border-border bg-elevated p-1 text-xs shadow-xl shadow-black/40 animate-pop-in',
            className,
          )}
        >
          {options.map((o) => (
            <Dropdown.Item
              key={o.value}
              onSelect={() => onChange(o.value)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-surface-2"
            >
              <Check
                className={cn('size-3.5 text-primary', o.value !== value && 'invisible')}
                strokeWidth={2}
              />
              <span className={cn('flex-1', o.className ?? 'text-fg')}>{o.label}</span>
              {o.hint && <span className="text-2xs text-fg-subtle">{o.hint}</span>}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

// ---------------------------------------------------------------------------
// Campos de texto simples

export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }
>(function TextInput({ className, mono, ...rest }, ref) {
  return (
    <input
      ref={ref}
      spellCheck={false}
      className={cn(
        'h-8 w-full rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-fg outline-none transition-colors',
        'placeholder:text-fg-subtle hover:border-border-strong focus:border-primary',
        mono && 'font-mono text-xs',
        className,
      )}
      {...rest}
    />
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full resize-y rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[13px] text-fg outline-none transition-colors',
          'placeholder:text-fg-subtle hover:border-border-strong focus:border-primary',
          className,
        )}
        {...rest}
      />
    );
  },
);

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-medium text-fg-muted">{label}</span>
      {children}
      {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}
