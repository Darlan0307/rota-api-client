import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, description, action, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex h-full flex-col items-center justify-center text-center animate-fade-in',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-8 py-12',
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-xl border border-border bg-surface-2 text-fg-subtle',
          compact ? 'size-10' : 'size-12',
        )}
      >
        <Icon className={compact ? 'size-5' : 'size-6'} strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <p className={cn('font-medium text-fg', compact ? 'text-[13px]' : 'text-sm')}>{title}</p>
        {description && (
          <p className="mx-auto max-w-xs text-xs leading-relaxed text-fg-muted">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
