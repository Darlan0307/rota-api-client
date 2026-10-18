// Sobe PostgreSQL, MySQL e SQL Server de teste no Docker, com o mesmo banco
// fictício "loja" (acentos, números grandes, datas, schema extra e nomes que
// precisam de aspas). Senhas abaixo são só destes containers locais.
//
// Uso: node packages/core/scripts/databases/setup.mjs [postgres] [mysql] [sqlserver]
// Depois:
//   ROTA_PG_TEST=127.0.0.1:5433 ROTA_MYSQL_TEST=127.0.0.1:3307 ROTA_MSSQL_TEST=127.0.0.1:14330 \
//     pnpm --filter @rota/core test
import { execFileSync } from 'node:child_process';

const PASSWORD = 'Rota_teste_123';

const docker = (args, input) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    input,
    stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
const sleep = (ms) => execFileSync(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`]);

function retry(label, fn, tries = 60) {
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (error) {
      if (i >= tries) throw new Error(`${label}: ${error.stderr || error.message}`);
      sleep(2000);
    }
  }
}

function fresh(name, args) {
  try {
    docker(['rm', '-f', name]);
  } catch {
    // Não existia.
  }
  docker(['run', '-d', '--name', name, ...args]);
}

const POSTGRES_SEED = `
CREATE TABLE clientes (
  id integer PRIMARY KEY,
  nome varchar(60) NOT NULL,
  cidade varchar(40),
  saldo numeric(15,2) DEFAULT 0,
  pontos bigint,
  ativo boolean DEFAULT true,
  data_cadastro date,
  atualizado_em timestamp,
  dados jsonb,
  foto bytea
);
CREATE TABLE pedidos (
  id serial PRIMARY KEY,
  cliente_id integer NOT NULL REFERENCES clientes(id),
  total numeric(15,2),
  status varchar(20)
);
CREATE VIEW vw_pedidos AS SELECT p.id, c.nome, p.total FROM pedidos p JOIN clientes c ON c.id = p.cliente_id;
CREATE SCHEMA vendas;
CREATE TABLE vendas."Notas Fiscais" (id integer PRIMARY KEY, "Numero" integer, pedido_id integer REFERENCES pedidos(id));
CREATE TABLE "order" (id integer PRIMARY KEY);
INSERT INTO clientes VALUES
  (1, 'João da Conceição', 'São Paulo', 1520.75, 9007199254740993, true, '2024-03-15', '2024-03-15 14:32:10', '{"vip": true}', '\\x89504e47'),
  (2, 'Maria Antônia Gonçalves', 'Goiânia', -35.10, 42, false, '2023-11-02', NULL, NULL, NULL),
  (3, 'Ágatha Ümit Çelik', 'Florianópolis', 0, NULL, true, NULL, NULL, NULL, NULL);
INSERT INTO pedidos (cliente_id, total, status) VALUES (1, 299.90, 'pago'), (1, 49.90, 'cancelado'), (2, 1200.00, 'aguardando');
INSERT INTO vendas."Notas Fiscais" VALUES (1, 1001, 1);
`;

const MYSQL_SEED = `
CREATE TABLE clientes (
  id int PRIMARY KEY,
  nome varchar(60) NOT NULL,
  cidade varchar(40),
  saldo decimal(15,2) DEFAULT 0,
  pontos bigint,
  ativo tinyint(1) DEFAULT 1,
  data_cadastro date,
  atualizado_em datetime,
  dados json,
  foto blob
) DEFAULT CHARSET=utf8mb4;
CREATE TABLE pedidos (
  id int AUTO_INCREMENT PRIMARY KEY,
  cliente_id int NOT NULL,
  total decimal(15,2),
  status varchar(20),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
) DEFAULT CHARSET=utf8mb4;
CREATE VIEW vw_pedidos AS SELECT p.id, c.nome, p.total FROM pedidos p JOIN clientes c ON c.id = p.cliente_id;
CREATE TABLE \`order\` (id int PRIMARY KEY);
INSERT INTO clientes VALUES
  (1, 'João da Conceição', 'São Paulo', 1520.75, 9007199254740993, 1, '2024-03-15', '2024-03-15 14:32:10', '{"vip": true}', 0x89504E47),
  (2, 'Maria Antônia Gonçalves', 'Goiânia', -35.10, 42, 0, '2023-11-02', NULL, NULL, NULL),
  (3, 'Ágatha Ümit Çelik', 'Florianópolis', 0, NULL, 1, NULL, NULL, NULL, NULL);
INSERT INTO pedidos (cliente_id, total, status) VALUES (1, 299.90, 'pago'), (1, 49.90, 'cancelado'), (2, 1200.00, 'aguardando');
`;

const SQLSERVER_SEED = `
CREATE DATABASE Loja;
GO
USE Loja;
GO
CREATE TABLE Clientes (
  Id int PRIMARY KEY,
  Nome nvarchar(60) NOT NULL,
  Cidade nvarchar(40),
  Saldo decimal(15,2) DEFAULT 0,
  Pontos bigint,
  Ativo bit DEFAULT 1,
  DataCadastro date,
  AtualizadoEm datetime2(0),
  Foto varbinary(max),
  Codigo uniqueidentifier
);
CREATE TABLE Pedidos (
  Id int IDENTITY PRIMARY KEY,
  ClienteId int NOT NULL REFERENCES Clientes(Id),
  Total decimal(15,2),
  Status nvarchar(20)
);
GO
CREATE VIEW VwPedidos AS SELECT p.Id, c.Nome, p.Total FROM Pedidos p JOIN Clientes c ON c.Id = p.ClienteId;
GO
CREATE SCHEMA vendas;
GO
CREATE TABLE vendas.[Notas Fiscais] (Id int PRIMARY KEY, Numero int);
CREATE TABLE [Order] (Id int PRIMARY KEY);
INSERT INTO Clientes VALUES
  (1, N'João da Conceição', N'São Paulo', 1520.75, 9007199254740993, 1, '2024-03-15', '2024-03-15T14:32:10', 0x89504E47, '6F9619FF-8B86-D011-B42D-00C04FC964FF'),
  (2, N'Maria Antônia Gonçalves', N'Goiânia', -35.10, 42, 0, '2023-11-02', NULL, NULL, NULL),
  (3, N'Ágatha Ümit Çelik', N'Florianópolis', 0, NULL, 1, NULL, NULL, NULL, NULL);
INSERT INTO Pedidos (ClienteId, Total, Status) VALUES (1, 299.90, N'pago'), (1, 49.90, N'cancelado'), (2, 1200.00, N'aguardando');
GO
`;

const wanted = process.argv.slice(2);
const want = (name) => wanted.length === 0 || wanted.includes(name);

if (want('postgres')) {
  fresh('rota-pg', [
    '-p',
    '5433:5432',
    '-e',
    `POSTGRES_PASSWORD=${PASSWORD}`,
    '-e',
    'POSTGRES_DB=loja',
    'postgres:16-alpine',
  ]);
  retry('postgres', () =>
    docker(['exec', 'rota-pg', 'psql', '-U', 'postgres', '-d', 'loja', '-c', 'SELECT 1']),
  );
  docker(
    ['exec', '-i', 'rota-pg', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'loja'],
    POSTGRES_SEED,
  );
  console.log('PostgreSQL pronto em 127.0.0.1:5433 (postgres / banco loja).');
}

if (want('mysql')) {
  fresh('rota-mysql', [
    '-p',
    '3307:3306',
    '-e',
    `MYSQL_ROOT_PASSWORD=${PASSWORD}`,
    '-e',
    'MYSQL_DATABASE=loja',
    'mysql:8.4',
  ]);
  retry('mysql', () =>
    docker(['exec', 'rota-mysql', 'mysql', '-uroot', `-p${PASSWORD}`, '-e', 'USE loja; SELECT 1']),
  );
  docker(
    [
      'exec',
      '-i',
      'rota-mysql',
      'mysql',
      '-uroot',
      `-p${PASSWORD}`,
      '--default-character-set=utf8mb4',
      'loja',
    ],
    MYSQL_SEED,
  );
  console.log('MySQL pronto em 127.0.0.1:3307 (root / banco loja).');
}

if (want('sqlserver')) {
  fresh('rota-mssql', [
    '-p',
    '14330:1433',
    '-e',
    'ACCEPT_EULA=Y',
    '-e',
    `MSSQL_SA_PASSWORD=${PASSWORD}`,
    'mcr.microsoft.com/mssql/server:2022-latest',
  ]);
  const sqlcmd = [
    'exec',
    '-i',
    'rota-mssql',
    '/opt/mssql-tools18/bin/sqlcmd',
    '-C',
    '-S',
    'localhost',
    '-U',
    'sa',
    '-P',
    PASSWORD,
  ];
  retry('sqlserver', () => docker([...sqlcmd, '-Q', 'SELECT 1']));
  docker([...sqlcmd, '-b', '-f', '65001'], SQLSERVER_SEED);
  console.log('SQL Server pronto em 127.0.0.1:14330 (sa / banco Loja).');
}
