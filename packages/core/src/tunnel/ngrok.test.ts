import { describe, expect, it } from 'vitest';
import { cleanNgrokAuthtoken, describeNgrokError, normalizeNgrokDomain } from './ngrok';

describe('ngrok', () => {
  it('normaliza o domínio colado de vários jeitos', () => {
    expect(normalizeNgrokDomain('https://Loja-Exemplo.ngrok-free.app/webhooks?x=1')).toBe(
      'loja-exemplo.ngrok-free.app',
    );
    expect(normalizeNgrokDomain('  loja.ngrok-free.dev ')).toBe('loja.ngrok-free.dev');
    expect(normalizeNgrokDomain('')).toBe('');
    expect(normalizeNgrokDomain('não é domínio')).toBeNull();
    expect(normalizeNgrokDomain('localhost')).toBeNull();
  });

  it('aceita o comando inteiro copiado do painel', () => {
    expect(cleanNgrokAuthtoken('ngrok config add-authtoken 2abcDEF_123')).toBe('2abcDEF_123');
    expect(cleanNgrokAuthtoken(' "2abcDEF_123" ')).toBe('2abcDEF_123');
  });

  it('explica os erros mais comuns em português', () => {
    expect(describeNgrokError('authentication failed ... ERR_NGROK_4018')).toMatch(
      /authtoken do ngrok foi recusado/,
    );
    expect(describeNgrokError('limited to 1 simultaneous ngrok agent sessions. ERR_NGROK_108')).toMatch(
      /um por vez/,
    );
    expect(describeNgrokError('The endpoint is already online. ERR_NGROK_334')).toMatch(/já está em uso/);
    expect(describeNgrokError('failed to dial ngrok server')).toMatch(/Sem conexão/);
    expect(describeNgrokError('algo novo\ndetalhe')).toBe('O ngrok recusou o túnel: algo novo');
  });
});
