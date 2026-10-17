// Empacota o servidor MCP num único arquivo dentro do app desktop
// (apps/desktop/out/mcp/index.mjs). Dependências do app (nativas, WASM ou que
// leem arquivos do próprio pacote) ficam externas e são resolvidas pelo
// node_modules do app — no instalador, de dentro do app.asar.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = JSON.parse(readFileSync(join(here, '../desktop/package.json'), 'utf8'));
const external = Object.keys(desktop.dependencies).filter((name) => !name.startsWith('@rota/'));

await build({
  entryPoints: [join(here, 'src/index.ts')],
  outfile: join(here, '../desktop/out/mcp/index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
  sourcemap: 'linked',
  // Alguns pacotes CommonJS usam require() dinâmico.
  banner: {
    js: "import { createRequire as __rotaCreateRequire } from 'node:module'; const require = __rotaCreateRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
console.log('MCP empacotado em apps/desktop/out/mcp/index.mjs');
