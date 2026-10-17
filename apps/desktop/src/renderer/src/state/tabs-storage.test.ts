import { describe, expect, it } from 'vitest';
import { forStorage, type Tab } from './tabs';
import { draftsFromViews } from './variable-drafts';

describe('abas salvas no localStorage', () => {
  it('não guardam valores secretos revelados ou digitados', () => {
    const [plain, secret] = draftsFromViews([
      { key: 'URL', type: 'default', enabled: true, value: 'http://x' },
      { key: 'TOKEN', type: 'secret', enabled: true, hasValue: true },
    ]);
    if (!plain || !secret) throw new Error('drafts');
    const tab: Tab = {
      kind: 'environment',
      id: 't1',
      title: 'Dev',
      itemId: 'e1',
      conflict: null,
      base: [],
      draft: [plain, { ...secret, value: 'revelado-123', secretDirty: true }],
    };
    const stored = JSON.stringify(forStorage(tab));
    expect(stored).not.toContain('revelado-123');
    expect(stored).toContain('http://x');
  });
});
