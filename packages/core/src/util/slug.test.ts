import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug } from './slug';

describe('slugify', () => {
  it('remove acentos, espaços e pontuação', () => {
    expect(slugify('Listar usuários (v2)')).toBe('listar-usuarios-v2');
    expect(slugify('  Ação / Configuração  ')).toBe('acao-configuracao');
  });

  it('usa um nome padrão quando não sobra nada', () => {
    expect(slugify('')).toBe('sem-nome');
    expect(slugify('!!!')).toBe('sem-nome');
  });

  it('limita o tamanho sem deixar hífen no final', () => {
    const slug = slugify(`${'a'.repeat(59)} b`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('evita nomes reservados do Windows', () => {
    expect(slugify('CON')).toBe('con-1');
    expect(slugify('lpt1')).toBe('lpt1-1');
  });
});

describe('uniqueSlug', () => {
  it('retorna o slug base quando está livre', () => {
    expect(uniqueSlug('Login', ['logout'])).toBe('login');
  });

  it('acrescenta sufixo numérico em caso de colisão (sem diferenciar caixa)', () => {
    expect(uniqueSlug('Login', ['LOGIN'])).toBe('login-2');
    expect(uniqueSlug('Login', ['login', 'login-2', 'login-3'])).toBe('login-4');
  });
});
