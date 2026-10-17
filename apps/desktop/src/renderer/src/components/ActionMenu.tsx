import * as ContextMenu from '@radix-ui/react-context-menu';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type MenuEntry =
  | {
      label: string;
      icon?: LucideIcon;
      onSelect: () => void;
      danger?: boolean;
      shortcut?: string;
      disabled?: boolean;
    }
  | 'separator';

const CONTENT =
  'z-50 min-w-48 rounded-lg border border-border bg-elevated p-1 text-[13px] shadow-xl shadow-black/40 animate-pop-in';
const ITEM =
  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-40';

function EntryContent({ entry }: { entry: Exclude<MenuEntry, 'separator'> }) {
  const Icon = entry.icon;
  return (
    <>
      {Icon ? (
        <Icon
          className={cn('size-3.5', entry.danger ? 'text-danger' : 'text-fg-subtle')}
          strokeWidth={1.75}
        />
      ) : (
        <span className="w-3.5" />
      )}
      <span className={cn('flex-1', entry.danger ? 'text-danger' : 'text-fg')}>{entry.label}</span>
      {entry.shortcut && <span className="text-2xs text-fg-subtle">{entry.shortcut}</span>}
    </>
  );
}

/** Menu de contexto (clique direito) para qualquer elemento. */
export function ContextActions({ entries, children }: { entries: MenuEntry[]; children: ReactNode }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={CONTENT}>
          {entries.map((entry, i) =>
            entry === 'separator' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: lista estática
              <ContextMenu.Separator key={i} className="my-1 h-px bg-border" />
            ) : (
              <ContextMenu.Item
                key={entry.label}
                className={ITEM}
                onSelect={entry.onSelect}
                disabled={entry.disabled ?? false}
              >
                <EntryContent entry={entry} />
              </ContextMenu.Item>
            ),
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** Mesmo menu, aberto por um botão ("…"). */
export function DropdownActions({
  entries,
  trigger,
  align = 'start',
}: {
  entries: MenuEntry[];
  trigger: ReactNode;
  align?: 'start' | 'end';
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align={align} sideOffset={4} className={CONTENT}>
          {entries.map((entry, i) =>
            entry === 'separator' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: lista estática
              <Dropdown.Separator key={i} className="my-1 h-px bg-border" />
            ) : (
              <Dropdown.Item
                key={entry.label}
                className={ITEM}
                onSelect={entry.onSelect}
                disabled={entry.disabled ?? false}
              >
                <EntryContent entry={entry} />
              </Dropdown.Item>
            ),
          )}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
