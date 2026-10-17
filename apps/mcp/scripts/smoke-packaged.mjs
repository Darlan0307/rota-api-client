// Teste rápido do MCP empacotado: node apps/mcp/scripts/smoke-packaged.mjs <Rota.exe> <dataDir>
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [exe, dataDir] = process.argv.slice(2);
const mcp = join(exe, '..', 'resources', 'app.asar', 'out', 'mcp', 'index.mjs');
const transport = new StdioClientTransport({
  command: exe,
  args: [mcp],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ROTA_DATA_DIR: dataDir },
  stderr: 'inherit',
});
const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(transport);
const { tools } = await client.listTools();
console.log('ferramentas:', tools.length);
const r1 = await client.callTool({ name: 'criar_colecao', arguments: { nome: 'Smoke' } });
console.log('criar_colecao:', JSON.stringify(r1.content).slice(0, 200));
const r2 = await client.callTool({
  name: 'criar_ambiente',
  arguments: { nome: 'Dev', variaveis: [{ chave: 'token', valor: 'abc', secreta: true }] },
});
console.log('criar_ambiente:', r2.isError ? 'ERRO ' : '', JSON.stringify(r2.content).slice(0, 300));
const r3 = await client.callTool({ name: 'listar_colecoes', arguments: {} });
console.log('listar_colecoes:', JSON.stringify(r3.content).slice(0, 200));
await client.close();
