import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover font-semibold',
  secondary: 'border border-border bg-surface-2 text-fg hover:border-border-strong',
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  danger: 'border border-border bg-surface-2 text-danger hover:border-danger/60',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'no-drag inline-flex items-center justify-center gap-1.5 rounded-md transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98]',
        'disabled:pointer-events-none disabled:opacity-40',
        size === 'md' ? 'h-8 px-3 text-[13px]' : 'h-7 px-2.5 text-xs',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
});
