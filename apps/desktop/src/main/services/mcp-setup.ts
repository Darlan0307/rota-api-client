import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
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

/**
 * Arquivo que o Claude Desktop realmente lê. Gravar no lugar errado deixaria
 * o Rota "configurado" sem o Claude ver. Em ordem:
 * 1. Versões recentes (MSIX) guardam os dados fora do pacote, em
 *    %LOCALAPPDATA%\Claude-Data\claude_<id do pacote>.
 * 2. MSIX mais antigo virtualiza o %APPDATA%: o app enxerga primeiro a cópia
 *    dentro do pacote (LocalCache) e só cai no %APPDATA% real sem ela.
 * 3. Instalador clássico: %APPDATA%\Claude.
 */
export async function findClaudeDesktopConfigPath(
  appData = process.env.APPDATA ?? '',
  localAppData = process.env.LOCALAPPDATA ?? '',
): Promise<string> {
  const real = claudeDesktopConfigPath(appData);
  if (!localAppData) return real;
  const dataRoot = join(localAppData, 'Claude-Data');
  const dataDirs = await readdir(dataRoot, { withFileTypes: true }).catch(() => []);
  const dataDir = dataDirs.find((e) => e.isDirectory() && /^claude_[a-z0-9]+$/i.test(e.name));
  if (dataDir) return join(dataRoot, dataDir.name, 'claude_desktop_config.json');
  const packages = join(localAppData, 'Packages');
  const entries = await readdir(packages).catch(() => [] as string[]);
  const pkg = entries.find((name) => /^Claude_[a-z0-9]+$/i.test(name));
  if (!pkg) return real;
  const packaged = join(packages, pkg, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json');
  if ((await readIfExists(packaged)) !== undefined) return packaged;
  return (await readIfExists(real)) !== undefined ? real : packaged;
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
  return sameLaunch(entry, config) ? 'installed' : 'outdated';
}

/** O Claude Code acrescenta `type: "stdio"`; compara só o que define como o servidor inicia. */
function sameLaunch(entry: unknown, config: McpLaunchConfig): boolean {
  if (!isObject(entry)) return false;
  const pick = (e: Record<string, unknown>) => JSON.stringify([e.command, e.args, e.env ?? {}]);
  return pick(entry) === pick(config as unknown as Record<string, unknown>);
}

/**
 * Arquivos de configuração do Claude Code (`.claude.json`) onde o servidor
 * aparece com escopo de usuário. Quem usa CLAUDE_CONFIG_DIR tem mais de uma
 * pasta (~/.claude-*), e o `claude mcp add` só grava na que estava ativa no
 * terminal: por isso todas são verificadas.
 */
export async function claudeCodeStatuses(
  config: McpLaunchConfig,
  home = homedir(),
  configDir = process.env.CLAUDE_CONFIG_DIR,
): Promise<{ path: string; status: Exclude<ClaudeDesktopStatus, 'missing'> }[]> {
  const dirs = new Set<string>([home]);
  if (configDir) dirs.add(configDir);
  for (const entry of await readdir(home, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && /^\.claude(-|$)/.test(entry.name)) dirs.add(join(home, entry.name));
  }
  const result: { path: string; status: Exclude<ClaudeDesktopStatus, 'missing'> }[] = [];
  for (const dir of dirs) {
    const path = join(dir, '.claude.json');
    const text = await readIfExists(path).catch(() => undefined);
    if (text === undefined) continue;
    const status = claudeDesktopStatus(text, config);
    if (status !== 'missing') result.push({ path, status });
  }
  return result;
}

export type McpServerCheck = { ok: true; tools: number; ms: number } | { ok: false; error: string };

/**
 * Inicia o servidor MCP do mesmo jeito que o Claude faria e pede a lista de
 * ferramentas. Tudo local: não fala com o Claude nem gasta tokens.
 */
export function testMcpServer(config: McpLaunchConfig, timeoutMs = 15_000): Promise<McpServerCheck> {
  const script = config.args[0];
  if (script && !existsSync(script)) {
    return Promise.resolve({
      ok: false,
      error: `O servidor MCP não foi encontrado em ${script}. Rode "pnpm build" (ou reinstale o Rota).`,
    });
  }
  const started = Date.now();
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(config.command, config.args, {
        env: { ...process.env, ...config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolve({ ok: false, error: `Não foi possível iniciar o servidor MCP: ${String(error)}` });
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (result: McpServerCheck) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: 'O servidor MCP não respondeu a tempo.' }),
      timeoutMs,
    );
    const send = (message: object) =>
      child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

    child.on('error', (error) =>
      finish({ ok: false, error: `Não foi possível iniciar o servidor MCP: ${error.message}` }),
    );
    child.on('exit', (code) =>
      finish({
        ok: false,
        error: `O servidor MCP encerrou (código ${code ?? '?'}).${stderr.trim() ? ` ${stderr.trim().slice(-400)}` : ''}`,
      }),
    );
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      let newline = stdout.indexOf('\n');
      while (newline >= 0) {
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        newline = stdout.indexOf('\n');
        let message: { id?: number; result?: { tools?: unknown[] }; error?: { message?: string } };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.error) {
          finish({
            ok: false,
            error: `O servidor MCP recusou a verificação: ${message.error.message ?? ''}`,
          });
        } else if (message.id === 1) {
          send({ method: 'notifications/initialized' });
          send({ id: 2, method: 'tools/list' });
        } else if (message.id === 2) {
          finish({ ok: true, tools: message.result?.tools?.length ?? 0, ms: Date.now() - started });
        }
      }
    });
    send({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'rota-verificacao', version: '1' },
      },
    });
  });
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
