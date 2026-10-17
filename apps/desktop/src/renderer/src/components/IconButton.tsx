import type { LucideIcon } from 'lucide-react';
import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/cn';
import { Tooltip } from './Tooltip';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  size?: 'sm' | 'md';
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, shortcut, active, size = 'md', tooltipSide, className, ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'no-drag inline-flex shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors duration-150',
        'hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40',
        size === 'md' ? 'size-8' : 'size-6',
        active && 'bg-surface-2 text-fg',
        className,
      )}
      {...rest}
    >
      <Icon className={size === 'md' ? 'size-[18px]' : 'size-3.5'} strokeWidth={1.75} />
    </button>
  );

  return (
    <Tooltip
      label={label}
      {...(shortcut ? { shortcut } : {})}
      {...(tooltipSide ? { side: tooltipSide } : {})}
    >
      {button}
    </Tooltip>
  );
});
