import { describe, expect, it } from 'vitest';
import {
  DYNAMIC_VARIABLES,
  generateCnpj,
  generateCpf,
  generateDynamic,
  isValidCnpj,
  isValidCpf,
} from './dynamic';
import { resolveTemplate, VariableScope } from './template';

describe('documentos', () => {
  it('valida CPF e CNPJ conhecidos', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-80')).toBe(false);
  });

  it('gera CPF e CNPJ com dígitos verificadores válidos', () => {
    for (let i = 0; i < 200; i++) {
      expect(isValidCpf(generateCpf())).toBe(true);
      expect(isValidCnpj(generateCnpj())).toBe(true);
    }
    expect(generateDynamic('$cpfFormatado')).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
    expect(generateDynamic('$cnpjFormatado')).toMatch(/^\d{2}\.\d{3}\.\d{3}\/0001-\d{2}$/);
  });
});

describe('catálogo', () => {
  it('formatos esperados', () => {
    expect(generateDynamic('$celular')).toMatch(/^\(\d{2}\) 9\d{4}-\d{4}$/);
    expect(generateDynamic('$celularNumeros')).toMatch(/^\d{2}9\d{8}$/);
    expect(generateDynamic('$cep')).toMatch(/^\d{5}-\d{3}$/);
    expect(generateDynamic('$placa')).toMatch(/^[A-Z]{3}\d[A-Z]\d{2}$/);
    expect(generateDynamic('$email')).toMatch(/^[a-z.]+\d+@[a-z.]+$/);
    expect(generateDynamic('$hoje')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(generateDynamic('$preco')).toMatch(/^\d+\.\d{2}$/);
    expect(generateDynamic('$naoExiste')).toBeUndefined();
  });

  it('nomes únicos e todos geram texto', () => {
    const names = DYNAMIC_VARIABLES.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    for (const v of DYNAMIC_VARIABLES) {
      expect(v.name.startsWith('$')).toBe(true);
      expect(typeof v.generate()).toBe('string');
    }
  });

  it('cada ocorrência gera um valor novo', () => {
    const scope = new VariableScope([]);
    const [a, b] = resolveTemplate('{{$guid}} {{$guid}}', scope).split(' ');
    expect(a).not.toBe(b);
    expect(resolveTemplate('{{$cpf}}', scope)).toMatch(/^\d{11}$/);
  });
});
