import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DatabaseError, describeFieldType, FirebirdSession, readOnlyViolation } from './firebird';
import type { DbConnectionConfig } from './types';

describe('trava de somente leitura', () => {
  it('recusa GEN_ID e NEXT VALUE FOR, que avançam generators mesmo em transação READ ONLY', () => {
    expect(readOnlyViolation('SELECT GEN_ID(GEN_PEDIDOS, 1) FROM RDB$DATABASE')).not.toBeNull();
    expect(readOnlyViolation('select next value for seq from rdb$database')).not.toBeNull();
  });

  it('ignora as palavras dentro de textos e comentários', () => {
    expect(readOnlyViolation("SELECT 'GEN_ID(' AS X FROM RDB$DATABASE -- GEN_ID(")).toBeNull();
    expect(readOnlyViolation('SELECT /* NEXT VALUE FOR */ 1 FROM RDB$DATABASE')).toBeNull();
  });
});

describe('tipos do RDB$FIELDS', () => {
  it('descreve os tipos mais comuns', () => {
    const base = { subType: 0, length: 4, charLength: null, precision: null, scale: 0 };
    expect(describeFieldType({ ...base, type: 8 })).toBe('INTEGER');
    expect(describeFieldType({ ...base, type: 16, subType: 1, precision: 15, scale: -2 })).toBe(
      'NUMERIC(15,2)',
    );
    expect(describeFieldType({ ...base, type: 37, length: 240, charLength: 60 })).toBe('VARCHAR(60)');
    expect(describeFieldType({ ...base, type: 261, subType: 1 })).toBe('BLOB SUB_TYPE TEXT');
  });
});

/**
 * Integração com um Firebird de verdade. Para rodar:
 *   node packages/core/scripts/firebird/setup.mjs   (Docker: Firebird 2.5 com LOJA_WIN e LOJA_NONE)
 *   ROTA_FIREBIRD_TEST=127.0.0.1:3051 pnpm --filter @rota/core test
 */
const server = process.env.ROTA_FIREBIRD_TEST;
const [host = '', port = '3050'] = (server ?? '').split(':');

function config(database: string, patch: Partial<DbConnectionConfig> = {}): DbConnectionConfig {
  return {
    id: database,
    name: database,
    engine: 'firebird',
    host,
    port: Number(port),
    database,
    user: 'SYSDBA',
    charset: 'auto',
    environment: 'teste',
    readOnly: true,
    ...patch,
  };
}

describe.skipIf(!server)('Firebird 2.5 (integração)', () => {
  let win: FirebirdSession;
  let none: FirebirdSession;
  beforeAll(async () => {
    win = await FirebirdSession.connect(config('LOJA_WIN'), 'masterkey');
    none = await FirebirdSession.connect(config('LOJA_NONE'), 'masterkey');
  });
  afterAll(async () => {
    await win?.close();
    await none?.close();
  });

  it('conecta pelo alias e escolhe o charset sozinho', () => {
    expect(win.info).toMatchObject({ databaseCharset: 'WIN1252', connectionCharset: 'UTF8' });
    expect(win.info.version).toMatch(/^2\.5/);
    expect(none.info).toMatchObject({ databaseCharset: 'NONE', connectionCharset: 'WIN1252' });
  });

  it('lê acentos certos nos dois bancos (WIN1252 e NONE)', async () => {
    for (const session of [win, none]) {
      const result = await session.run('SELECT NOME, CIDADE, OBS FROM CLIENTES ORDER BY ID', {
        readOnly: true,
      });
      expect(result.rows[0]).toEqual([
        'João da Conceição',
        'São Paulo',
        'Cliente antigo. Prefere contato à tarde; pagamento via boleto ç ã é ü',
      ]);
      expect(result.rows[2]?.[0]).toBe('Ágatha Ümit Çelik');
    }
  });

  it('formata datas no horário local e não perde precisão', async () => {
    const result = await win.run(
      'SELECT SALDO, PONTOS, DATA_CADASTRO, ATUALIZADO_EM, HORA_CONTATO, FOTO, CPF FROM CLIENTES WHERE ID = 1',
      { readOnly: true },
    );
    expect(result.columns.map((c) => c.type)).toEqual([
      'NUMERIC(2)',
      'BIGINT',
      'DATE',
      'TIMESTAMP',
      'TIME',
      'BLOB',
      'CHAR',
    ]);
    expect(result.rows[0]).toEqual([
      1520.75,
      '9007199254740993',
      '2024-03-15',
      '2024-03-15 14:32:10',
      '09:30:00',
      '(BLOB binário)',
      '12345678909',
    ]);
  });

  it('mantém colunas de mesmo nome num JOIN e respeita o limite de linhas', async () => {
    const result = await win.run(
      'SELECT P.ID, C.ID FROM PEDIDOS P JOIN CLIENTES C ON C.ID = P.CLIENTE_ID ORDER BY P.ID',
      { readOnly: true, limit: 2 },
    );
    expect(result.columns.map((c) => c.name)).toEqual(['ID', 'ID']);
    expect(result.rows).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(result.truncated).toBe(true);
  });

  it('lê a estrutura: tabelas, views, PK, FK, tipos e generators', async () => {
    const schema = await win.schema();
    expect(schema.tables.map((t) => `${t.name}:${t.kind}`)).toEqual([
      'CLIENTES:table',
      'PEDIDOS:table',
      'VW_PEDIDOS_CLIENTE:view',
    ]);
    const clientes = schema.tables[0]?.columns ?? [];
    expect(clientes.find((c) => c.name === 'ID')).toMatchObject({
      type: 'INTEGER',
      primaryKey: true,
      nullable: false,
    });
    expect(clientes.find((c) => c.name === 'NOME')).toMatchObject({ type: 'VARCHAR(60)', nullable: false });
    expect(clientes.find((c) => c.name === 'SALDO')).toMatchObject({
      type: 'NUMERIC(15,2)',
      defaultValue: '0',
    });
    expect(schema.tables[1]?.columns.find((c) => c.name === 'CLIENTE_ID')?.references).toBe('CLIENTES.ID');
    expect(schema.generators).toContain('GEN_PEDIDOS');
  });

  it('somente leitura: recusa escrita antes de executar e o banco fica intacto', async () => {
    await expect(win.run("UPDATE PEDIDOS SET STATUS = 'x'", { readOnly: true })).rejects.toThrow(
      /só consultas SELECT/,
    );
    await expect(
      win.run('SELECT GEN_ID(GEN_PEDIDOS, 1) FROM RDB$DATABASE', { readOnly: true }),
    ).rejects.toThrow(/generator/);
    const result = await win.run('SELECT STATUS FROM PEDIDOS ORDER BY ID', { readOnly: true });
    expect(result.rows.flat()).toEqual(['pago', 'cancelado', 'aguardando']);
  });

  it('com escrita liberada, executa e informa as linhas afetadas', async () => {
    const result = await win.run("UPDATE PEDIDOS SET STATUS = STATUS WHERE STATUS = 'pago'", {
      readOnly: false,
    });
    expect(result.affected).toBe(1);
  });

  it('cancela uma consulta longa e a conexão continua utilizável', async () => {
    const slow = win.run('SELECT COUNT(*) FROM RDB$FIELDS A, RDB$FIELDS B, RDB$FIELDS C, RDB$FIELDS D', {
      readOnly: true,
    });
    setTimeout(() => void win.cancel(), 300);
    await expect(slow).rejects.toThrow('Consulta cancelada.');
    expect((await win.run('SELECT 1 FROM RDB$DATABASE', { readOnly: true })).rows).toEqual([[1]]);
  });

  it('explica os erros de conexão em português', async () => {
    const fail = (patch: Partial<DbConnectionConfig>, password = 'masterkey') =>
      FirebirdSession.connect(config('LOJA_WIN', patch), password).then(
        () => 'conectou',
        (e: DatabaseError) => e.message,
      );
    expect(await fail({}, 'errada')).toBe('Usuário ou senha inválidos para este servidor.');
    expect(await fail({ database: 'NAO_EXISTE' })).toMatch(/não foi encontrado no servidor/);
    expect(await fail({ port: 3999 })).toMatch(/Nada respondeu em/);
  });
});
