import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { Kbd } from './Kbd';

interface TooltipProps {
  label: ReactNode;
  shortcut?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}

export function Tooltip({ label, shortcut, side = 'bottom', children }: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 flex items-center gap-2 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-fg shadow-lg shadow-black/30 animate-fade-in"
        >
          {label}
          {shortcut && <Kbd keys={shortcut} />}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export const TooltipProvider = RadixTooltip.Provider;
