import { useEffect, useRef } from 'react';

/** Atalho no formato "mod+enter", "mod+shift+p" ("mod" = Ctrl). */
export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

function normalize(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('mod');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  parts.push(event.key.toLowerCase());
  return parts.join('+');
}

/**
 * Registra atalhos globais da janela. Os handlers sempre veem o estado mais
 * recente (via ref) sem precisar re-registrar o listener.
 */
export function useHotkeys(map: HotkeyMap): void {
  const ref = useRef(map);
  ref.current = map;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const handler = ref.current[normalize(event)];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
