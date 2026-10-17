import type { CommandResult, WorkspaceCommand } from '../../../shared/ipc';
import { toast } from '../state/toasts';

export const api = window.api;

/**
 * Executa um comando no workspace mostrando o erro num toast (o chamador
 * recebe `undefined` em caso de falha).
 */
export async function runCommand(command: WorkspaceCommand): Promise<CommandResult | undefined> {
  try {
    return await api.invoke('workspace:command', command);
  } catch (error) {
    toast.error(errorMessage(error));
    return undefined;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
