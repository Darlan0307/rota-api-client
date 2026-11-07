import { describe, expect, it } from 'vitest';
import {
  isBlankSql,
  isReadQuery,
  resultToInserts,
  resultToJson,
  resultToTsv,
  splitSqlStatements,
  statementAt,
  tableForQualifier,
  tableFromSql,
} from './sql';

describe('comandos SQL no editor', () => {
  it('separa por ";" ignorando textos e comentários', () => {
    const sql = "SELECT 'a;b' FROM T;\n-- comentário; aqui\nSELECT 2 FROM X /* ; */;  \n";
    expect(splitSqlStatements(sql).map((s) => s.text)).toEqual([
      "SELECT 'a;b' FROM T",
      '-- comentário; aqui\nSELECT 2 FROM X /* ; */',
    ]);
  });

  it('acha o comando sob o cursor', () => {
    const sql = 'SELECT 1 FROM A;\n\nSELECT 2 FROM B;\n';
    expect(statementAt(sql, 3)?.text).toBe('SELECT 1 FROM A');
    expect(statementAt(sql, sql.indexOf('2'))?.text).toBe('SELECT 2 FROM B');
    // Cursor no fim, depois do último ";".
    expect(statementAt(sql, sql.length)?.text).toBe('SELECT 2 FROM B');
  });

  it('ignora trechos só com comentários', () => {
    const sql = '-- cabeçalho\nSELECT 1 FROM A;\n/* SELECT 2 FROM B; */\n-- SELECT 3;\n;\n-- fim';
    expect(splitSqlStatements(sql).map((s) => s.text)).toEqual(['-- cabeçalho\nSELECT 1 FROM A']);
    // Cursor no comentário do fim: vale o último comando de verdade.
    expect(statementAt(sql, sql.length)?.text).toBe('-- cabeçalho\nSELECT 1 FROM A');
    expect(isBlankSql('-- só comentário\n/* e bloco */')).toBe(true);
    expect(isBlankSql('# comentário do MySQL', 'mysql')).toBe(true);
    expect(isBlankSql('# não é comentário fora do MySQL')).toBe(false);
  });

  it('segue as regras do MySQL', () => {
    const sql = "SELECT 'it\\'s; ok' FROM t; # nota; aqui\nSELECT `a;b` FROM u";
    expect(splitSqlStatements(sql, 'mysql').map((s) => s.text)).toEqual([
      "SELECT 'it\\'s; ok' FROM t",
      '# nota; aqui\nSELECT `a;b` FROM u',
    ]);
    const proc = 'DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END$$\nDELIMITER ;\nCALL p();';
    expect(splitSqlStatements(proc, 'mysql').map((s) => s.text)).toEqual([
      'CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END',
      'CALL p()',
    ]);
  });

  it('mantém corpos $$ do Postgres inteiros', () => {
    const sql =
      'CREATE FUNCTION f() RETURNS int AS $body$ BEGIN RETURN 1; END; $body$ LANGUAGE plpgsql;\nDO $$ BEGIN PERFORM 1; END $$;\nSELECT f()';
    expect(splitSqlStatements(sql, 'postgres')).toHaveLength(3);
    expect(splitSqlStatements(sql, 'postgres')[1]?.text).toBe('DO $$ BEGIN PERFORM 1; END $$');
  });

  it('entende [nomes] e GO no SQL Server', () => {
    const sql = 'SELECT [a;b] FROM t\nGO\nSELECT 2\ngo\n  SELECT 3; SELECT 4';
    expect(splitSqlStatements(sql, 'sqlserver').map((s) => s.text)).toEqual([
      'SELECT [a;b] FROM t',
      'SELECT 2',
      'SELECT 3',
      'SELECT 4',
    ]);
    // "GO" no meio da linha é texto comum (ex.: nome de coluna).
    expect(splitSqlStatements('SELECT GO FROM t', 'sqlserver')).toHaveLength(1);
  });

  it('entende SET TERM no Firebird', () => {
    const sql = [
      'SET TERM ^ ;',
      'CREATE PROCEDURE P AS BEGIN',
      '  UPDATE T SET X = 1;',
      'END^',
      'SET TERM ; ^',
      'SELECT 1 FROM RDB$DATABASE;',
    ].join('\n');
    expect(splitSqlStatements(sql, 'firebird').map((s) => s.text)).toEqual([
      'CREATE PROCEDURE P AS BEGIN\n  UPDATE T SET X = 1;\nEND',
      'SELECT 1 FROM RDB$DATABASE',
    ]);
  });

  it('não corta corpo de procedure, trigger ou bloco colado sem separador próprio', () => {
    const fb =
      'EXECUTE BLOCK RETURNS (N INTEGER) AS\nBEGIN\n  N = CASE WHEN 1 = 1 THEN 1 ELSE 2 END;\n  SUSPEND;\nEND;\nSELECT 1 FROM RDB$DATABASE;';
    expect(splitSqlStatements(fb, 'firebird').map((s) => s.text)).toEqual([
      'EXECUTE BLOCK RETURNS (N INTEGER) AS\nBEGIN\n  N = CASE WHEN 1 = 1 THEN 1 ELSE 2 END;\n  SUSPEND;\nEND',
      'SELECT 1 FROM RDB$DATABASE',
    ]);
    const ms =
      'CREATE OR ALTER PROCEDURE p AS BEGIN\n  BEGIN TRANSACTION;\n  SELECT 1;\n  COMMIT;\nEND;\nEXEC p;';
    expect(splitSqlStatements(ms, 'sqlserver')).toHaveLength(2);
    const my =
      'CREATE PROCEDURE p() BEGIN IF 1 = 1 THEN SELECT 1; END IF; CASE WHEN 1 THEN SELECT 2; END CASE; END; CALL p();';
    expect(splitSqlStatements(my, 'mysql').map((s) => s.text)).toEqual([
      'CREATE PROCEDURE p() BEGIN IF 1 = 1 THEN SELECT 1; END IF; CASE WHEN 1 THEN SELECT 2; END CASE; END',
      'CALL p()',
    ]);
    // Comandos comuns com BEGIN TRANSACTION continuam separados.
    expect(splitSqlStatements('BEGIN TRANSACTION; UPDATE t SET a = 1; COMMIT;', 'sqlserver')).toHaveLength(3);
  });

  it('separa scripts grandes rápido (o autocomplete chama a cada sugestão)', () => {
    const line = "INSERT INTO pedidos (id, obs, preco) VALUES (1, 'it''s; ok', 9.9); -- nota\n";
    const script = line.repeat(20_000); // ~1,5 MB
    for (const engine of ['mysql', 'sqlserver', 'postgres', 'firebird'] as const) {
      const started = performance.now();
      expect(splitSqlStatements(script, engine)).toHaveLength(20_000);
      expect(performance.now() - started).toBeLessThan(1500);
    }
  });

  it('resolve aliases de FROM e JOIN', () => {
    const sql = 'SELECT p. FROM PEDIDOS p JOIN CLIENTES AS c ON c.ID = p.CLIENTE_ID';
    const tables = ['PEDIDOS', 'CLIENTES'];
    expect(tableForQualifier(sql, 'p', tables)).toBe('PEDIDOS');
    expect(tableForQualifier(sql, 'C', tables)).toBe('CLIENTES');
    expect(tableForQualifier(sql, 'clientes', tables)).toBe('CLIENTES');
    expect(tableForQualifier(sql, 'x', tables)).toBeUndefined();
  });

  it('no MySQL, "#" no começo é comentário e não bloqueia a consulta', () => {
    expect(isReadQuery('# lista; de clientes\nSELECT * FROM t', 'mysql')).toBe(true);
    expect(isReadQuery('#\nDELETE FROM t', 'mysql')).toBe(false);
    // Fora do MySQL, "#" não é comentário: continua recusado.
    expect(isReadQuery('# nota\nSELECT 1', 'postgres')).toBe(false);
    // Palavra de escrita escondida para uma das leituras continua barrada.
    expect(isReadQuery("SELECT '\\' -- '\nDELETE FROM t", 'postgres')).toBe(false);
  });

  it('reconhece consultas de leitura', () => {
    expect(isReadQuery('-- lista\n select * from t')).toBe(true);
    expect(isReadQuery('WITH x AS (SELECT 1 FROM RDB$DATABASE) SELECT * FROM x')).toBe(true);
    expect(isReadQuery("UPDATE t SET a = 'SELECT'")).toBe(false);
  });
});

describe('copiar resultados', () => {
  const columns = ['ID', 'NOME', 'ID', 'ATIVO'];
  const rows = [
    [1, "D'Ávila\tSilva", 9, true],
    [2, null, 10, false],
  ];

  it('acha a tabela do primeiro FROM', () => {
    expect(tableFromSql('SELECT * FROM vendas."Notas Fiscais" n WHERE 1=1')).toBe('vendas."Notas Fiscais"');
    expect(tableFromSql('select p.id from PEDIDOS p join CLIENTES c on 1=1')).toBe('PEDIDOS');
    expect(tableFromSql('SELECT 1')).toBeUndefined();
  });

  it('JSON com nomes repetidos separados', () => {
    expect(JSON.parse(resultToJson(columns, rows))).toEqual([
      { ID: 1, NOME: "D'Ávila\tSilva", ID_2: 9, ATIVO: true },
      { ID: 2, NOME: null, ID_2: 10, ATIVO: false },
    ]);
  });

  it('texto separado por tabulação, sem quebrar colunas', () => {
    expect(resultToTsv(columns, rows)).toBe("ID\tNOME\tID\tATIVO\n1\tD'Ávila Silva\t9\ttrue\n2\t\t10\tfalse");
  });

  it('INSERT na sintaxe de cada banco', () => {
    expect(resultToInserts('postgres', 'clientes', ['id', 'nome', 'ativo'], [[1, "D'Ávila", true]])).toBe(
      "INSERT INTO clientes (id, nome, ativo) VALUES (1, 'D''Ávila', TRUE);",
    );
    expect(resultToInserts('sqlserver', 'Clientes', ['Id', 'Nome', 'Ativo'], [[1, 'João', false]])).toBe(
      "INSERT INTO Clientes (Id, Nome, Ativo) VALUES (1, N'João', 0);",
    );
    expect(resultToInserts('mysql', '`order`', ['id', 'foto'], [[1, '0x89504E47']])).toBe(
      'INSERT INTO `order` (id, foto) VALUES (1, 0x89504E47);',
    );
    expect(resultToInserts('firebird', 'CLIENTES', ['ID', 'OBS'], [[1, null]])).toBe(
      'INSERT INTO CLIENTES (ID, OBS) VALUES (1, NULL);',
    );
  });
});
