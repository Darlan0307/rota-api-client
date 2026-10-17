import { looksLikeCurl, parseCurl } from '@rota/core/shared';
import type { ClipboardEvent } from 'react';
import { type RequestTab, useTabs } from '../../state/tabs';
import { toast } from '../../state/toasts';

/**
 * Colar um comando cURL no campo de URL preenche a requisição inteira
 * (método, URL, query, headers, body e auth).
 */
export function handleUrlPaste(tab: RequestTab, event: ClipboardEvent<HTMLInputElement>): void {
  const text = event.clipboardData.getData('text/plain');
  if (!looksLikeCurl(text)) return;
  event.preventDefault();
  try {
    const { data, warnings } = parseCurl(text);
    useTabs.getState().update<RequestTab>(tab.id, (t) => ({
      ...t,
      // Mantém scripts e descrição de uma requisição já existente.
      draft: {
        ...data,
        scripts: t.draft.scripts,
        ...(t.draft.description ? { description: t.draft.description } : {}),
      },
      section: data.body.mode !== 'none' ? 'body' : 'params',
    }));
    toast.success('Requisição preenchida a partir do cURL.');
    for (const warning of warnings) toast.info(warning);
  } catch (error) {
    toast.error(
      `Não foi possível interpretar o cURL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
