import { beforeEach, describe, expect, it } from 'vitest';
import { isDirty, type RequestTab, useTabs } from './tabs';

const tab = (id: string) => useTabs.getState().tabs.find((t) => t.id === id) as RequestTab;

describe('requisição rápida', () => {
  beforeEach(() => useTabs.setState({ tabs: [], activeId: null, workspaceRoot: null }));

  it('intocada não conta como alterada (fecha sem perguntar)', () => {
    const id = useTabs.getState().openNewRequest();
    expect(tab(id).title).toBe('Requisição rápida');
    expect(isDirty(tab(id))).toBe(false);
  });

  it('com qualquer mudança, ou aberta já com conteúdo, conta como alterada', () => {
    const id = useTabs.getState().openNewRequest();
    useTabs
      .getState()
      .update<RequestTab>(id, (t) => ({ ...t, draft: { ...t.draft, url: 'http://localhost:3000' } }));
    expect(isDirty(tab(id))).toBe(true);
    // Ex.: aberta do histórico ou de uma chamada do túnel.
    const fromHistory = useTabs.getState().openNewRequest({ data: { method: 'POST', url: 'http://x/y' } });
    expect(isDirty(tab(fromHistory))).toBe(true);
  });
});
