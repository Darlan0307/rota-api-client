import { join } from 'node:path';
import { z } from 'zod';
import { appDataDir, normalizeWorkspacePath, workspaceLocalDir } from './paths';
import { readJsonIfExists, writeJsonAtomic } from './util/fs';

// ---------------------------------------------------------------------------
// Configurações globais do app (%APPDATA%/Rota/settings.json)

export const AppSettingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** Timeout padrão das requisições (ms). 0 = sem limite. */
  defaultTimeoutMs: z.number().int().min(0).default(30_000),
  proxy: z
    .object({
      enabled: z.boolean().default(false),
      url: z.string().default(''),
      bypass: z.string().default('localhost, 127.0.0.1'),
    })
    .default({ enabled: false, url: '', bypass: 'localhost, 127.0.0.1' }),
  /** Workspace aberto (null = workspace principal, em %APPDATA%). */
  currentWorkspace: z.string().nullable().default(null),
  recentWorkspaces: z.array(z.string()).default([]),
  /**
   * Workspace que abre ao iniciar o app (path null = o principal). Sem
   * escolha (null), abre o último usado.
   */
  startupWorkspace: z.object({ path: z.string().nullable() }).nullable().default(null),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export function settingsPath(dataDir = appDataDir()): string {
  return join(dataDir, 'settings.json');
}

export async function loadAppSettings(dataDir = appDataDir()): Promise<AppSettings> {
  const raw = await readJsonIfExists(settingsPath(dataDir)).catch(() => undefined);
  const parsed = AppSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : AppSettingsSchema.parse({});
}

export async function saveAppSettings(settings: AppSettings, dataDir = appDataDir()): Promise<void> {
  await writeJsonAtomic(settingsPath(dataDir), AppSettingsSchema.parse(settings));
}

/** Registra um workspace como recente (o mais recente primeiro, sem duplicatas). */
export function withRecentWorkspace(settings: AppSettings, root: string, max = 30): AppSettings {
  const key = normalizeWorkspacePath(root);
  const recent = [root, ...settings.recentWorkspaces.filter((r) => normalizeWorkspacePath(r) !== key)];
  return { ...settings, recentWorkspaces: recent.slice(0, max) };
}

// ---------------------------------------------------------------------------
// Estado local de cada workspace (ambiente ativo etc.), fora do Git

export const WorkspaceStateSchema = z.object({
  activeEnvironmentId: z.string().nullable().default(null),
});
export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;

export function workspaceStatePath(root: string, dataDir = appDataDir()): string {
  return join(workspaceLocalDir(root, dataDir), 'state.json');
}

export async function loadWorkspaceState(root: string, dataDir = appDataDir()): Promise<WorkspaceState> {
  const raw = await readJsonIfExists(workspaceStatePath(root, dataDir)).catch(() => undefined);
  const parsed = WorkspaceStateSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : WorkspaceStateSchema.parse({});
}

export async function saveWorkspaceState(
  root: string,
  state: WorkspaceState,
  dataDir = appDataDir(),
): Promise<void> {
  await writeJsonAtomic(workspaceStatePath(root, dataDir), WorkspaceStateSchema.parse(state));
}
