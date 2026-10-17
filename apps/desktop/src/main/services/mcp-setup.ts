import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from '@rota/core';
import type { McpLaunchConfig } from '../../shared/ipc';

/** Nome do servidor nas configurações do Claude. */
export const MCP_SERVER_NAME = 'rota';

/**
 * Como o Claude deve iniciar o servidor MCP: o próprio executável do Rota em
 * modo Node (ELECTRON_RUN_AS_NODE), rodando o bundle de out/mcp. Assim não é
 * preciso ter o Node instalado; no app instalado o bundle fica dentro do asar,
 * que o Electron lê normalmente.
 */
export function mcpLaunchConfig(
  execPath: string,
  appPath: string,
  dataDirOverride?: string,
): McpLaunchConfig {
  return {
    command: execPath,
    args: [join(appPath, 'out', 'mcp', 'index.mjs')],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      ...(dataDirOverride ? { ROTA_DATA_DIR: dataDirOverride } : {}),
    },
  };
}

/** Trecho de JSON para colar em claude_desktop_config.json. */
export function claudeDesktopSnippet(config: McpLaunchConfig): string {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: config } }, null, 2);
}

/** Comando para registrar o servidor no Claude Code (escopo do usuário). */
export function claudeCodeCommand(config: McpLaunchConfig): string {
  const env = Object.entries(config.env).map(([k, v]) => `-e ${k}=${quote(v)}`);
  return [
    'claude mcp add',
    MCP_SERVER_NAME,
    '--scope user',
    ...env,
    '--',
    quote(config.command),
    ...config.args.map(quote),
  ].join(' ');
}

function quote(value: string): string {
  return /^[\w.:/\\=-]+$/.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`;
}

export function claudeDesktopConfigPath(appData = process.env.APPDATA ?? ''): string {
  return join(appData, 'Claude', 'claude_desktop_config.json');
}

export type ClaudeDesktopStatus = 'missing' | 'not-installed' | 'installed' | 'outdated' | 'invalid';

/** Situação do Rota na configuração do Claude Desktop (texto do arquivo ou undefined). */
export function claudeDesktopStatus(text: string | undefined, config: McpLaunchConfig): ClaudeDesktopStatus {
  if (text === undefined) return 'missing';
  let parsed: unknown;
  try {
    parsed = text.trim() ? JSON.parse(text) : {};
  } catch {
    return 'invalid';
  }
  if (!isObject(parsed)) return 'invalid';
  const servers = parsed.mcpServers;
  if (servers !== undefined && !isObject(servers)) return 'invalid';
  const entry = servers?.[MCP_SERVER_NAME];
  if (entry === undefined) return 'not-installed';
  return JSON.stringify(entry) === JSON.stringify(config) ? 'installed' : 'outdated';
}

/**
 * Inclui (ou atualiza) o Rota em mcpServers preservando o resto do arquivo.
 * Lança erro se o arquivo atual não for um JSON válido, para não sobrescrever
 * algo que o usuário editou à mão.
 */
export function mergeClaudeDesktopConfig(text: string | undefined, config: McpLaunchConfig): string {
  const status = claudeDesktopStatus(text, config);
  if (status === 'invalid') {
    throw new Error(
      'O arquivo de configuração do Claude Desktop não é um JSON válido. Corrija-o (ou copie o trecho manualmente) antes de instalar.',
    );
  }
  const current = text?.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
  const servers = (current.mcpServers as Record<string, unknown> | undefined) ?? {};
  return `${JSON.stringify({ ...current, mcpServers: { ...servers, [MCP_SERVER_NAME]: config } }, null, 2)}\n`;
}

export async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Grava a configuração do Claude Desktop, guardando uma cópia do arquivo anterior. */
export async function installInClaudeDesktop(
  path: string,
  config: McpLaunchConfig,
  now = new Date(),
): Promise<{ backupPath: string | null }> {
  const text = await readIfExists(path);
  const next = mergeClaudeDesktopConfig(text, config);
  let backupPath: string | null = null;
  if (text !== undefined) {
    const stamp = now.toISOString().replaceAll(/[:.]/g, '-');
    backupPath = `${path}.rota-backup-${stamp}`;
    await copyFile(path, backupPath);
  } else {
    await mkdir(dirname(path), { recursive: true });
  }
  await writeFileAtomic(path, next);
  return { backupPath };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
