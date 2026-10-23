import { describe, expect, it } from 'vitest';
import { looksPersonal, MAX_SAVED_EVENTS, normalizeSavedEvents } from './saved-events';

describe('eventos salvos do simulador', () => {
  it('descarta itens inválidos e completa os campos', () => {
    const list = normalizeSavedEvents([
      { id: 'a', name: '  Pagamento aprovado ', body: '{}', path: '/webhooks', provider: 'stripe' },
      { id: 'b', name: '', body: '{"x":1}', savedAt: '2026-10-23T10:00:00.000Z' },
      { id: 1, name: 'x', body: '{}' },
      null,
      'texto',
    ]);
    expect(list).toEqual([
      {
        id: 'a',
        name: 'Pagamento aprovado',
        body: '{}',
        path: '/webhooks',
        provider: 'stripe',
        savedAt: new Date(0).toISOString(),
      },
      { id: 'b', name: 'Evento', body: '{"x":1}', provider: null, savedAt: '2026-10-23T10:00:00.000Z' },
    ]);
    expect(normalizeSavedEvents('nada')).toEqual([]);
  });

  it('limita a quantidade', () => {
    const many = Array.from({ length: MAX_SAVED_EVENTS + 5 }, (_, i) => ({
      id: `${i}`,
      name: 'e',
      body: '{}',
    }));
    expect(normalizeSavedEvents(many)).toHaveLength(MAX_SAVED_EVENTS);
  });

  it('reconhece dados pessoais no payload', () => {
    expect(looksPersonal('{"cpf":"123.456.789-09"}')).toBe(true);
    expect(looksPersonal('{"email":"joao@exemplo.com"}')).toBe(true);
    expect(looksPersonal('{"fone":"(11) 98888-7777"}')).toBe(true);
    expect(looksPersonal('{"id":"evt_123","amount":1000}')).toBe(false);
  });
});
