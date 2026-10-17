import { describe, expect, it } from 'vitest';
import { isReadQuery, splitSqlStatements, statementAt, tableForQualifier } from './sql';

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
