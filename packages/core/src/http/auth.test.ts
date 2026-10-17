import { describe, expect, it } from 'vitest';
import { type AuthOwner, resolveEffectiveAuth } from './auth';

const req = (auth: AuthOwner['auth']): AuthOwner => ({ kind: 'request', id: 'r', name: 'Req', auth });
const folder = (auth: AuthOwner['auth']): AuthOwner => ({ kind: 'folder', id: 'f', name: 'Pasta', auth });
const col = (auth: AuthOwner['auth']): AuthOwner => ({ kind: 'collection', id: 'c', name: 'Col', auth });

describe('resolveEffectiveAuth', () => {
  it('usa a auth da própria requisição quando definida', () => {
    const result = resolveEffectiveAuth([req({ type: 'bearer', token: 't' }), col({ type: 'none' })]);
    expect(result).toEqual({
      auth: { type: 'bearer', token: 't' },
      source: { kind: 'request', id: 'r', name: 'Req' },
    });
  });

  it('herda da pasta e depois da coleção', () => {
    const basic = { type: 'basic', username: 'u', password: 'p' } as const;
    expect(
      resolveEffectiveAuth([req({ type: 'inherit' }), folder(basic), col({ type: 'none' })]).source?.kind,
    ).toBe('folder');
    expect(
      resolveEffectiveAuth([req({ type: 'inherit' }), folder({ type: 'inherit' }), col(basic)]).auth,
    ).toEqual(basic);
  });

  it('"sem auth" explícito interrompe a herança', () => {
    const result = resolveEffectiveAuth([req({ type: 'none' }), col({ type: 'bearer', token: 'x' })]);
    expect(result.auth).toEqual({ type: 'none' });
    expect(result.source?.kind).toBe('request');
  });

  it('sem nenhuma definição, não há auth', () => {
    expect(resolveEffectiveAuth([req({ type: 'inherit' }), col({ type: 'inherit' })])).toEqual({
      auth: { type: 'none' },
      source: null,
    });
  });
});
