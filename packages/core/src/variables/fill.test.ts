import { describe, expect, it } from 'vitest';
import { applyTestData, needsQuotes, normalizeKey, suggestTestData, suggestVariableFor } from './fill';

describe('sugestão de dados de teste pelo nome do campo', () => {
  it('normaliza nomes', () => {
    expect(normalizeKey('Data_Nascimento')).toBe('datanascimento');
    expect(normalizeKey('endereço-entrega')).toBe('enderecoentrega');
  });

  it('escolhe a variável pelo nome e pelo formato atual', () => {
    expect(suggestVariableFor('cpf', '123.456.789-09')).toBe('$cpfFormatado');
    expect(suggestVariableFor('cpfCliente', '12345678909')).toBe('$cpf');
    expect(suggestVariableFor('CNPJ', '11.222.333/0001-81')).toBe('$cnpjFormatado');
    expect(suggestVariableFor('e-mail')).toBe('$email');
    expect(suggestVariableFor('telefone', '(11) 98888-7777')).toBe('$celular');
    expect(suggestVariableFor('celular', '11988887777')).toBe('$celularNumeros');
    expect(suggestVariableFor('dataNascimento')).toBe('$dataNascimento');
    expect(suggestVariableFor('nome')).toBeUndefined();
    expect(suggestVariableFor('nome', '', 'string', { parent: 'cliente' })).toBe('$nomeCompleto');
    expect(suggestVariableFor('nome', '', 'string', { siblings: ['nome', 'cpf'] })).toBe('$nomeCompleto');
    expect(suggestVariableFor('estado', '', 'string', { parent: 'enderecoEntrega' })).toBe('$uf');
    expect(suggestVariableFor('estado')).toBeUndefined();
    expect(suggestVariableFor('razao_social')).toBe('$empresa');
    expect(suggestVariableFor('nomeProduto')).toBeUndefined();
    expect(suggestVariableFor('id')).toBeUndefined();
  });

  it('acha os campos com posição, inclusive em objetos e listas', () => {
    const text = `{
  "nome": "Fulano",
  "cpf": "123.456.789-09",
  "produto": { "nome": "Caneta", "estado": "novo" },
  "ativo": true,
  "endereco": { "cep": "01001-000", "cidade": "São Paulo" },
  "itens": [{ "produto": "Caneta", "preco": 2.5 }],
  "email": null
}`;
    const list = suggestTestData(text) ?? [];
    expect(list.map((s) => [s.path, s.variable, s.quoted])).toEqual([
      ['nome', '$nomeCompleto', true],
      ['cpf', '$cpfFormatado', true],
      ['endereco.cep', '$cep', true],
      ['endereco.cidade', '$cidade', true],
      ['itens[0].preco', '$preco', false],
      ['email', '$email', true],
    ]);
    expect(list[0]?.current).toBe('"Fulano"');
  });

  it('ignora o que já é variável (com ou sem aspas)', () => {
    const text = '{ "cpf": "{{CPF}}", "email": {{EMAIL}}, "nome": "x {{SUFIXO}}" }';
    expect(suggestTestData(text)).toEqual([]);
  });

  it('devolve null para JSON inválido ou vazio', () => {
    expect(suggestTestData('{ "a": }')).toBeNull();
    expect(suggestTestData('  ')).toBeNull();
  });

  it('aplica só as escolhidas e mantém a formatação', () => {
    const text = '{\n  "nome": "Fulano",\n  "preco": 10,\n  "cpf": "1"\n}';
    const list = suggestTestData(text) ?? [];
    const chosen = list.filter((s) => s.key !== 'cpf');
    expect(applyTestData(text, chosen)).toBe(
      '{\n  "nome": "{{$nomeCompleto}}",\n  "preco": {{$preco}},\n  "cpf": "1"\n}',
    );
  });
});

describe('aspas da variável escolhida', () => {
  it('só tira as aspas de variável numérica no lugar de número', () => {
    expect(needsQuotes('$preco', '10')).toBe(false);
    expect(needsQuotes('$preco', '"10"')).toBe(true);
    expect(needsQuotes('$cpf', '10')).toBe(true);
    expect(needsQuotes('$randomInt', '-3')).toBe(false);
    expect(needsQuotes('$preco', 'null')).toBe(true);
  });
});
