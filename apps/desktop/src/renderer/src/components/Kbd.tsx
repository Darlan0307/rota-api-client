import { cn } from '../lib/cn';

/** Mostra um atalho: "Ctrl+Enter" vira [Ctrl] [Enter]. */
export function Kbd({ keys, className }: { keys: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {keys.split('+').map((key) => (
        <kbd
          key={key}
          className="min-w-[1.25rem] rounded border border-border bg-surface px-1 text-center font-sans text-2xs text-fg-muted"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
