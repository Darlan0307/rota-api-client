import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

interface DialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  /** Oculta o título visualmente (continua disponível para leitores de tela). */
  hideTitle?: boolean;
  placement?: 'center' | 'top';
  className?: string;
  children: ReactNode;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  hideTitle,
  placement = 'center',
  className,
  children,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/50 animate-fade-in" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={cn(
            'fixed left-1/2 z-50 flex -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-elevated shadow-2xl shadow-black/50 outline-none animate-pop-in',
            placement === 'top' ? 'top-[12vh]' : 'top-1/2 -translate-y-1/2',
            className,
          )}
        >
          {hideTitle ? (
            <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
          ) : (
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border pl-5 pr-3">
              <RadixDialog.Title className="text-sm font-semibold">{title}</RadixDialog.Title>
              <RadixDialog.Close
                aria-label="Fechar"
                className="flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                <X className="size-4" />
              </RadixDialog.Close>
            </div>
          )}
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
