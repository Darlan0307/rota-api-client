import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claudeCodeCommand,
  claudeDesktopSnippet,
  claudeDesktopStatus,
  installInClaudeDesktop,
  mcpLaunchConfig,
  mergeClaudeDesktopConfig,
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

    it('não mexe em arquivo inválido', async () => {
      const path = join(dir, 'claude_desktop_config.json');
      await writeFile(path, '{ quebrado');
      await expect(installInClaudeDesktop(path, config)).rejects.toThrow(/JSON válido/);
      expect(await readFile(path, 'utf8')).toBe('{ quebrado');
      expect(await readdir(dir)).toEqual(['claude_desktop_config.json']);
    });
  });
});
