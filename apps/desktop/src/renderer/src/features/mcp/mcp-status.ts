import { create } from 'zustand';
import type { McpStatus } from '../../../../shared/ipc';
import { api, errorMessage } from '../../lib/api';

interface McpStatusState {
  status: McpStatus | null;
  checking: boolean;
  error: string | null;
}

export const useMcpStatus = create<McpStatusState>(() => ({ status: null, checking: false, error: null }));

/** Sem `refresh`, reaproveita a verificação feita nesta execução do app. */
export async function checkMcp(refresh = false): Promise<void> {
  useMcpStatus.setState({ checking: true });
  try {
    const status = await api.invoke('mcp:status', refresh);
    useMcpStatus.setState({ status, checking: false, error: null });
  } catch (e) {
    useMcpStatus.setState({ checking: false, error: errorMessage(e) });
  }
}

export type McpHealth = 'ok' | 'problem' | 'unconfigured';

/** Resumo para a barra de status. */
export function mcpHealth(status: McpStatus): McpHealth {
  const configs = [status.claudeDesktop.status, ...status.claudeCode.map((c) => c.status)];
  if (!status.server.ok) return 'problem';
  if (configs.some((s) => s === 'outdated' || s === 'invalid')) return 'problem';
  return configs.includes('installed') ? 'ok' : 'unconfigured';
}
