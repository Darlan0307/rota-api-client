import { describe, expect, it } from 'vitest';
import { applyUrlText, composeUrl, ensureProtocol, splitUrl } from './url';

describe('splitUrl / composeUrl', () => {
  it('separa base e query sem decodificar', () => {
    expect(splitUrl('{{base}}/users?page=1&q=a%20b&flag')).toEqual({
      url: '{{base}}/users',
      query: [
        { key: 'page', value: '1', enabled: true },
        { key: 'q', value: 'a%20b', enabled: true },
        { key: 'flag', value: '', enabled: true },
      ],
    });
  });

  it('ignora o fragmento e "&" vazios', () => {
    expect(splitUrl('http://x/?a=1&&b=2#topo').query.map((p) => p.key)).toEqual(['a', 'b']);
  });

  it('compõe só os parâmetros habilitados', () => {
    expect(
      composeUrl('http://x', [
        { key: 'a', value: '1', enabled: true },
        { key: 'b', value: '2', enabled: false },
        { key: 'c', value: '', enabled: true },
      ]),
    ).toBe('http://x?a=1&c');
    expect(composeUrl('http://x', [])).toBe('http://x');
  });

  it('é idempotente (split + compose)', () => {
    const url = 'https://api.dev/v1/items?limit=10&sort=-date';
    const { url: base, query } = splitUrl(url);
    expect(composeUrl(base, query)).toBe(url);
  });
});

describe('applyUrlText', () => {
  it('preserva parâmetros desabilitados e descrições', () => {
    const previous = [
      { key: 'a', value: '1', enabled: true, description: 'página' },
      { key: 'debug', value: 'true', enabled: false },
    ];
    expect(applyUrlText('http://x?a=2&b=3', previous).query).toEqual([
      { key: 'a', value: '2', enabled: true, description: 'página' },
      { key: 'b', value: '3', enabled: true },
      { key: 'debug', value: 'true', enabled: false },
    ]);
  });
});

describe('ensureProtocol', () => {
  it('acrescenta http:// quando falta protocolo', () => {
    expect(ensureProtocol('localhost:3000/x')).toBe('http://localhost:3000/x');
    expect(ensureProtocol('https://a.com')).toBe('https://a.com');
  });
});
