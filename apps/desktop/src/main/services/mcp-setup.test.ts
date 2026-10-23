import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claudeCodeCommand,
  claudeCodeStatuses,
  claudeDesktopConfigPath,
  claudeDesktopSnippet,
  claudeDesktopStatus,
  findClaudeDesktopConfigPath,
  installInClaudeDesktop,
  mcpLaunchConfig,
  mergeClaudeDesktopConfig,
  testMcpServer,
} from './mcp-setup';

const config = mcpLaunchConfig(
  'C:\\Program Files\\Rota\\Rota.exe',
  'C:\\Program Files\\Rota\\resources\\app.asar',
);

describe('configuração do MCP para o Claude', () => {
  it('usa o executável do Rota em modo Node', () => {
    expect(config.command).toBe('C:\\Program Files\\Rota\\Rota.exe');
    expect(config.args).toEqual([
      join('C:\\Program Files\\Rota\\resources\\app.asar', 'out', 'mcp', 'index.mjs'),
    ]);
    expect(config.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    expect(mcpLaunchConfig('x', 'y', 'D:\\dados').env.ROTA_DATA_DIR).toBe('D:\\dados');
  });

  it('gera o trecho do Claude Desktop e o comando do Claude Code', () => {
    expect(JSON.parse(claudeDesktopSnippet(config))).toEqual({ mcpServers: { rota: config } });
    const command = claudeCodeCommand(config);
    expect(command).toMatch(
      /^claude mcp add rota --scope user -e ELECTRON_RUN_AS_NODE=1 -- "C:\\Program Files/,
    );
    expect(command).toContain('"C:\\Program Files\\Rota\\Rota.exe"');
  });

  it('detecta a situação no arquivo do Claude Desktop', () => {
    expect(claudeDesktopStatus(undefined, config)).toBe('missing');
    expect(claudeDesktopStatus('{ isso não é json', config)).toBe('invalid');
    expect(claudeDesktopStatus('{"mcpServers": []}', config)).toBe('invalid');
    expect(claudeDesktopStatus('', config)).toBe('not-installed');
    expect(claudeDesktopStatus('{"mcpServers": {"outro": {}}}', config)).toBe('not-installed');
    expect(claudeDesktopStatus(claudeDesktopSnippet(config), config)).toBe('installed');
    expect(claudeDesktopStatus('{"mcpServers": {"rota": {"command": "antigo"}}}', config)).toBe('outdated');
  });

  it('preserva o restante do arquivo ao incluir o Rota', () => {
    const text = JSON.stringify({ theme: 'dark', mcpServers: { outro: { command: 'npx' } } });
    expect(JSON.parse(mergeClaudeDesktopConfig(text, config))).toEqual({
      theme: 'dark',
      mcpServers: { outro: { command: 'npx' }, rota: config },
    });
    expect(() => mergeClaudeDesktopConfig('{ quebrado', config)).toThrow(/não é um JSON válido/);
  });

  describe('instalação no Claude Desktop', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'rota-mcp-setup-'));
    });
    afterEach(() => rm(dir, { recursive: true, force: true }));

    it('cria o arquivo quando não existe', async () => {
      const path = join(dir, 'Claude', 'claude_desktop_config.json');
      expect(await installInClaudeDesktop(path, config)).toEqual({ backupPath: null });
      expect(claudeDesktopStatus(await readFile(path, 'utf8'), config)).toBe('installed');
    });

    it('guarda cópia do arquivo anterior', async () => {
      const path = join(dir, 'claude_desktop_config.json');
      await writeFile(path, '{"mcpServers": {"outro": {"command": "npx"}}}');
      const { backupPath } = await installInClaudeDesktop(path, config, new Date('2026-10-17T12:00:00Z'));
      expect(backupPath).toBe(`${path}.rota-backup-2026-10-17T12-00-00-000Z`);
      expect(await readFile(backupPath as string, 'utf8')).toBe(
        '{"mcpServers": {"outro": {"command": "npx"}}}',
      );
      expect(JSON.parse(await readFile(path, 'utf8')).mcpServers.outro).toEqual({ command: 'npx' });
    });

    it('usa o arquivo de dentro do pacote MSIX quando o Claude Desktop está instalado assim', async () => {
      const appData = join(dir, 'Roaming');
      const local = join(dir, 'Local');
      expect(await findClaudeDesktopConfigPath(appData, local)).toBe(claudeDesktopConfigPath(appData));

      const pkg = join(local, 'Packages', 'Claude_abc123', 'LocalCache', 'Roaming', 'Claude');
      await mkdir(pkg, { recursive: true });
      // Sem arquivo em lugar nenhum: o Claude vai ler (e criar) o do pacote.
      expect(await findClaudeDesktopConfigPath(appData, local)).toBe(join(pkg, 'claude_desktop_config.json'));
      // Só o real existe: o pacote enxerga ele, então é nele que se grava.
      await mkdir(join(appData, 'Claude'), { recursive: true });
      await writeFile(claudeDesktopConfigPath(appData), '{}');
      expect(await findClaudeDesktopConfigPath(appData, local)).toBe(claudeDesktopConfigPath(appData));
      // A cópia do pacote tem prioridade.
      await writeFile(join(pkg, 'claude_desktop_config.json'), '{}');
      expect(await findClaudeDesktopConfigPath(appData, local)).toBe(join(pkg, 'claude_desktop_config.json'));
      // Versões recentes guardam os dados fora do pacote: essa pasta vence as outras.
      const data = join(local, 'Claude-Data', 'claude_abc123');
      await mkdir(data, { recursive: true });
      await writeFile(join(local, 'Claude-Data', 'README.txt'), 'x');
      expect(await findClaudeDesktopConfigPath(appData, local)).toBe(
        join(data, 'claude_desktop_config.json'),
      );
    });

    it('procura o Rota em todas as pastas de configuração do Claude Code', async () => {
      const entry = { type: 'stdio', ...config };
      await mkdir(join(dir, '.claude-b'));
      await mkdir(join(dir, '.claude-c'));
      await mkdir(join(dir, '.outra'));
      await writeFile(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { rota: entry } }));
      await writeFile(join(dir, '.claude-b', '.claude.json'), JSON.stringify({ projects: {} }));
      await writeFile(join(dir, '.outra', '.claude.json'), '{}');
      const statuses = await claudeCodeStatuses(config, dir, '');
      expect(statuses).toEqual([
        { path: join(dir, '.claude.json'), status: 'installed' },
        { path: join(dir, '.claude-b', '.claude.json'), status: 'not-installed' },
      ]);
    });

    it('verifica o servidor iniciando-o como o Claude faria', async () => {
      const script = join(dir, 'fake-mcp.mjs');
      await writeFile(
        script,
        [
          "import { createInterface } from 'node:readline';",
          'const out = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\\n");',
          'createInterface({ input: process.stdin }).on("line", (line) => {',
          '  const m = JSON.parse(line);',
          '  if (m.method === "initialize") out({ id: m.id, result: { capabilities: {} } });',
          '  if (m.method === "tools/list") out({ id: m.id, result: { tools: [{ name: "a" }, { name: "b" }] } });',
          '});',
        ].join('\n'),
      );
      const fake = { command: process.execPath, args: [script], env: {} };
      expect(await testMcpServer(fake)).toMatchObject({ ok: true, tools: 2 });

      await writeFile(script, 'process.stderr.write("falhou ao abrir"); process.exit(3);');
      const failed = await testMcpServer(fake);
      expect(failed.ok).toBe(false);
      expect(!failed.ok && failed.error).toMatch(/código 3.*falhou ao abrir/);

      const missing = await testMcpServer({ ...fake, args: [join(dir, 'nao-existe.mjs')] });
      expect(!missing.ok && missing.error).toMatch(/não foi encontrado/);
    });

    it('não mexe em arquivo inválido', async () => {
      const path = join(dir, 'claude_desktop_config.json');
      await writeFile(path, '{ quebrado');
      await expect(installInClaudeDesktop(path, config)).rejects.toThrow(/JSON válido/);
      expect(await readFile(path, 'utf8')).toBe('{ quebrado');
      expect(await readdir(dir)).toEqual(['claude_desktop_config.json']);
    });
  });
});
