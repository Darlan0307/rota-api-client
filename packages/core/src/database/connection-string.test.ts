import { describe, expect, it } from 'vitest';
import { parseConnectionString } from './connection-string';

describe('leitura de URL / connection string de banco', () => {
  it('URL do PostgreSQL com senha codificada e TLS', () => {
    expect(
      parseConnectionString('postgresql://joao:s3nh%40forte@db.exemplo.com:6543/loja?sslmode=require'),
    ).toEqual({
      engine: 'postgres',
      host: 'db.exemplo.com',
      port: 6543,
      database: 'loja',
      user: 'joao',
      password: 's3nh@forte',
      ssl: true,
      warnings: [],
    });
  });

  it('URL sem porta, senha com @ sem codificar, aspas e prefixos de driver', () => {
    expect(parseConnectionString('"postgres://joao:a@b@localhost/loja"')).toMatchObject({
      host: 'localhost',
      password: 'a@b',
      database: 'loja',
    });
    expect(parseConnectionString('postgres://joao@localhost/loja')).not.toHaveProperty('port');
    expect(parseConnectionString('postgresql+psycopg2://u:p@h/loja').engine).toBe('postgres');
    expect(parseConnectionString('mysql://root@127.0.0.1:3307/loja?ssl-mode=DISABLED')).toMatchObject({
      engine: 'mysql',
      port: 3307,
      ssl: false,
    });
    expect(parseConnectionString('mysql://u:p@aws.connect.psdb.cloud/loja?sslaccept=strict').ssl).toBe(true);
  });

  it('JDBC do PostgreSQL e do SQL Server', () => {
    expect(
      parseConnectionString('jdbc:postgresql://db.exemplo.com:5432/loja?user=joao&password=x%26y&ssl=true'),
    ).toMatchObject({ engine: 'postgres', user: 'joao', password: 'x&y', ssl: true, database: 'loja' });
    expect(
      parseConnectionString(
        'jdbc:sqlserver://db.exemplo.com:1433;databaseName=loja;user=joao;password=segredo;encrypt=true',
      ),
    ).toMatchObject({
      engine: 'sqlserver',
      host: 'db.exemplo.com',
      port: 1433,
      database: 'loja',
      user: 'joao',
      password: 'segredo',
      ssl: true,
    });
  });

  it('connection string do .NET (SQL Server), Npgsql e MySQL', () => {
    expect(
      parseConnectionString(
        'Server=tcp:db.exemplo.com,1433;Initial Catalog=loja;User ID=joao;Password=s3nh@;Encrypt=True;',
      ),
    ).toEqual({
      engine: 'sqlserver',
      host: 'db.exemplo.com',
      port: 1433,
      database: 'loja',
      user: 'joao',
      password: 's3nh@',
      ssl: true,
      warnings: [],
    });
    expect(
      parseConnectionString(
        'Host=localhost;Port=5433;Database=loja;Username=postgres;Password=x;SSL Mode=Disable',
      ),
    ).toMatchObject({ engine: 'postgres', host: 'localhost', port: 5433, ssl: false });
    expect(parseConnectionString('Server=localhost;Database=loja;Uid=root;Pwd=;')).toMatchObject({
      engine: 'mysql',
      user: 'root',
      password: '',
    });
  });

  it('avisa sobre login do Windows e instância nomeada', () => {
    const parsed = parseConnectionString(
      'Data Source=.\\SQLEXPRESS;Initial Catalog=loja;Integrated Security=True',
    );
    expect(parsed).toMatchObject({ engine: 'sqlserver', host: 'localhost', database: 'loja' });
    expect(parsed.warnings).toHaveLength(2);
    expect(parsed.warnings.join(' ')).toMatch(/login do Windows/);
    expect(parsed.warnings.join(' ')).toMatch(/SQLEXPRESS/);
  });

  it('Firebird: URL e formato clássico', () => {
    expect(
      parseConnectionString('firebird://SYSDBA:masterkey@servidor:3050/C:/Dados/LOJA.FDB'),
    ).toMatchObject({
      engine: 'firebird',
      host: 'servidor',
      database: 'C:/Dados/LOJA.FDB',
    });
    expect(parseConnectionString('servidor/3051:C:\\Dados\\LOJA.FDB')).toEqual({
      engine: 'firebird',
      host: 'servidor',
      port: 3051,
      database: 'C:\\Dados\\LOJA.FDB',
      warnings: [],
    });
    expect(parseConnectionString('cliente.ddns.net:LOJA')).toMatchObject({
      host: 'cliente.ddns.net',
      database: 'LOJA',
    });
    expect(parseConnectionString('C:\\Dados\\LOJA.FDB')).toMatchObject({ host: 'localhost' });
  });

  it('recusa o que não reconhece, com mensagem útil', () => {
    expect(() => parseConnectionString('')).toThrow(/Cole uma URL/);
    expect(() => parseConnectionString('servidor:5432')).toThrow(/Formato não reconhecido/);
    expect(() => parseConnectionString('mongodb://h/db')).toThrow(/não suportado/);
    expect(() => parseConnectionString('Foo=bar')).toThrow(/Não encontrei/);
  });
});
