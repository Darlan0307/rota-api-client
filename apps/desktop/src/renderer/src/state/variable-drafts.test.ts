import { describe, expect, it } from 'vitest';
import { draftsFromViews, draftsToInputs, emptyDraft, variablesDirty } from './variable-drafts';

const base = [
  { key: 'URL', type: 'default' as const, enabled: true, value: 'http://x' },
  { key: 'TOKEN', type: 'secret' as const, enabled: true, hasValue: true },
];

describe('variable drafts', () => {
  it('não fica "sujo" logo após carregar, mesmo com a linha vazia do fim', () => {
    const drafts = [...draftsFromViews(base), emptyDraft()];
    expect(variablesDirty(drafts, base)).toBe(false);
  });

  it('detecta valores, tipos e segredos alterados', () => {
    const drafts = draftsFromViews(base);
    expect(variablesDirty([{ ...drafts[0]!, value: 'http://y' }, drafts[1]!], base)).toBe(true);
    expect(variablesDirty([drafts[0]!, { ...drafts[1]!, value: 'novo', secretDirty: true }], base)).toBe(
      true,
    );
    // Revelar um segredo não altera nada.
    expect(variablesDirty([drafts[0]!, { ...drafts[1]!, value: 'revelado' }], base)).toBe(false);
  });

  it('só envia o valor secreto quando foi alterado e informa renomeações', () => {
    const drafts = draftsFromViews(base);
    const inputs = draftsToInputs(
      [
        drafts[0]!,
        { ...drafts[1]!, key: 'JWT', value: 'revelado' },
        { ...emptyDraft(), key: 'NOVO', type: 'secret', value: 's' },
      ],
      base,
    );
    expect(inputs).toEqual([
      {
        key: 'URL',
        type: 'default',
        enabled: true,
        description: undefined,
        value: 'http://x',
        previousKey: undefined,
      },
      {
        key: 'JWT',
        type: 'secret',
        enabled: true,
        description: undefined,
        value: undefined,
        previousKey: 'TOKEN',
      },
      {
        key: 'NOVO',
        type: 'secret',
        enabled: true,
        description: undefined,
        value: 's',
        previousKey: undefined,
      },
    ]);
  });
});
