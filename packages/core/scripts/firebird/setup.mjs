// Sobe um Firebird 2.5 de teste no Docker com dois bancos acentuados:
//   LOJA_WIN  (charset WIN1252)  e  LOJA_NONE (charset NONE, bytes do Windows).
// Uso: node packages/core/scripts/firebird/setup.mjs
// Depois: ROTA_FIREBIRD_TEST=127.0.0.1:3051 pnpm --filter @rota/core test
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONTAINER = 'rota-fb25';
const docker = (args, input) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    input,
    stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
const sh = (script) => docker(['exec', '-i', CONTAINER, 'sh', '-c', script]);

try {
  docker(['rm', '-f', CONTAINER]);
} catch {
  // Não existia.
}
docker([
  'run',
  '-d',
  '--name',
  CONTAINER,
  '-p',
  '3051:3050',
  '-e',
  'ISC_PASSWORD=masterkey',
  '-e',
  'TZ=America/Sao_Paulo',
  'jacobalberty/firebird:2.5-ss',
]);

// Espera o servidor aceitar conexões.
for (let i = 0; ; i++) {
  try {
    sh(
      "echo 'SELECT 1 FROM RDB$DATABASE;' | /usr/local/firebird/bin/isql -u SYSDBA -p masterkey localhost:employee",
    );
    break;
  } catch (error) {
    if (i > 30) throw error;
    execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)']);
  }
}

const seed = readFileSync(join(import.meta.dirname, 'seed.sql'), 'utf8');
docker(['exec', '-i', CONTAINER, 'sh', '-c', 'cat > /tmp/seed.sql'], seed);
// Logo depois de subir, o container ainda pode estar ajustando a senha do SYSDBA.
const createDatabases = `
set -e
rm -f /firebird/data/loja_win1252.fdb /firebird/data/loja_none.fdb
B=/usr/local/firebird/bin
printf "SET NAMES UTF8;\\nCREATE DATABASE '/firebird/data/loja_win1252.fdb' USER 'SYSDBA' PASSWORD 'masterkey' DEFAULT CHARACTER SET WIN1252;\\n" > /tmp/win.sql
cat /tmp/seed.sql >> /tmp/win.sql
$B/isql -q -i /tmp/win.sql
iconv -f UTF-8 -t CP1252 /tmp/seed.sql > /tmp/seed1252.sql
printf "SET NAMES NONE;\\nCREATE DATABASE '/firebird/data/loja_none.fdb' USER 'SYSDBA' PASSWORD 'masterkey' DEFAULT CHARACTER SET NONE;\\n" > /tmp/none.sql
cat /tmp/seed1252.sql >> /tmp/none.sql
$B/isql -q -i /tmp/none.sql
`;
for (let i = 0; ; i++) {
  try {
    sh(createDatabases);
    break;
  } catch (error) {
    if (i > 5) throw error;
    execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 2000)']);
  }
}
sh(
  'grep -q LOJA_WIN /firebird/etc/aliases.conf || printf "LOJA_WIN = /firebird/data/loja_win1252.fdb\\nLOJA_NONE = /firebird/data/loja_none.fdb\\n" >> /firebird/etc/aliases.conf',
);
console.log('Firebird 2.5 pronto em 127.0.0.1:3051 (SYSDBA/masterkey), aliases LOJA_WIN e LOJA_NONE.');
