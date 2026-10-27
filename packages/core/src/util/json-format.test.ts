import { describe, expect, it } from 'vitest';
import { formatJson, hasLossyNumbers, parseJsonLossless } from './json-format';

describe('formatJson', () => {
  it('formata igual ao JSON.stringify quando não há números sensíveis', () => {
    const samples = [
      '{"a":1,"b":[1,2,{"c":null}],"d":{},"e":[],"f":true,"g":"x"}',
      '[]',
      '"texto"',
      '  { "aninhado" : { "x" : [ { } , [ ] ] } }  ',
      '{"escape":"linha\\nnova \\"aspas\\" \\\\ barra","unicode":"Jo\\u00e3o"}',
      '{"chave:com,simbolos{}":"valor[,]:"}',
    ];
    for (const s of samples) expect(formatJson(s)).toBe(JSON.stringify(JSON.parse(s), null, 2));
  });

  it('mantém os números exatamente como vieram', () => {
    const text = '{"id":12345678901234567890,"preco":10.50,"exp":1e3,"neg":-0.0}';
    expect(formatJson(text)).toBe(
      '{\n  "id": 12345678901234567890,\n  "preco": 10.50,\n  "exp": 1e3,\n  "neg": -0.0\n}',
    );
  });

  it('devolve null para JSON inválido', () => {
    expect(formatJson('{"a":')).toBeNull();
    expect(formatJson('')).toBeNull();
  });
});

describe('parseJsonLossless', () => {
  it('mantém como texto só os números que perderiam precisão', () => {
    expect(parseJsonLossless('{"id":12345678901234567890,"n":42,"p":10.5}')).toEqual({
      id: '12345678901234567890',
      n: 42,
      p: 10.5,
    });
  });
});

describe('hasLossyNumbers', () => {
  it('detecta inteiros grandes e decimais longos fora de strings', () => {
    expect(hasLossyNumbers('{"id":9007199254740993}')).toBe(true);
    expect(hasLossyNumbers('[0.123456789012345678901]')).toBe(true);
    expect(hasLossyNumbers('{"id":9007199254740991,"p":10.50,"t":"12345678901234567890"}')).toBe(false);
  });
});
