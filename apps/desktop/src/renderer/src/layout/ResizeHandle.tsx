import { Separator } from 'react-resizable-panels';
import { cn } from '../lib/cn';

export function ResizeHandle({ vertical = false }: { vertical?: boolean }) {
  return (
    <Separator
      className={cn(
        'group relative shrink-0 bg-border outline-none transition-colors',
        'data-[separator=hover]:bg-primary data-[separator=active]:bg-primary focus-visible:bg-primary',
        vertical ? 'h-px w-full' : 'h-full w-px',
      )}
    />
  );
}
