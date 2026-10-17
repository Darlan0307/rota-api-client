import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Nome da pasta de dados do app em %APPDATA%. Compartilhado entre app e MCP. */
export const APP_DATA_FOLDER = 'Rota';

/** Pasta de dados local do app (fora de qualquer workspace). */
export function appDataDir(): string {
  const override = process.env.ROTA_DATA_DIR;
  if (override) return resolve(override);
  const base =
    process.env.APPDATA ??
    (process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')));
  return join(base, APP_DATA_FOLDER);
}

/** Workspace padrão (usado quando nenhuma pasta de projeto está aberta). */
export function defaultWorkspaceDir(dataDir = appDataDir()): string {
  return join(dataDir, 'workspace');
}

/** Normaliza o caminho de um workspace para comparação (Windows não diferencia caixa). */
export function normalizeWorkspacePath(root: string): string {
  const abs = resolve(root);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/**
 * Pasta de dados locais de um workspace: histórico, lixeira, ambiente ativo,
 * segredos cifrados. Fica em %APPDATA% para nunca ir parar no Git do projeto.
 */
export function workspaceLocalDir(root: string, dataDir = appDataDir()): string {
  const hash = createHash('sha256').update(normalizeWorkspacePath(root)).digest('hex').slice(0, 16);
  return join(dataDir, 'workspaces', hash);
}
