import { describe, expect, it } from 'vitest';
import {
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

  it('resolve aliases de FROM e JOIN', () => {
    const sql = 'SELECT p. FROM PEDIDOS p JOIN CLIENTES AS c ON c.ID = p.CLIENTE_ID';
    const tables = ['PEDIDOS', 'CLIENTES'];
    expect(tableForQualifier(sql, 'p', tables)).toBe('PEDIDOS');
    expect(tableForQualifier(sql, 'C', tables)).toBe('CLIENTES');
    expect(tableForQualifier(sql, 'clientes', tables)).toBe('CLIENTES');
    expect(tableForQualifier(sql, 'x', tables)).toBeUndefined();
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
