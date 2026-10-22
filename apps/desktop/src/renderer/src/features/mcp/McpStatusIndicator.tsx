import { Bot } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '../../lib/cn';
import { useUiStore } from '../../state/ui';
import { checkMcp, mcpHealth, useMcpStatus } from './mcp-status';

const LABEL = { ok: 'MCP pronto', problem: 'MCP com problema', unconfigured: 'MCP não configurado' };
const TONE = { ok: 'text-success', problem: 'text-warning', unconfigured: 'text-fg-subtle' };

/** Barra de status: resultado da verificação do MCP feita ao abrir o app. */
export function McpStatusIndicator() {
  const status = useMcpStatus((s) => s.status);
  const checking = useMcpStatus((s) => s.checking);
  useEffect(() => {
    void checkMcp();
  }, []);

  const health = status ? mcpHealth(status) : null;
  const title = status
    ? status.server.ok
      ? `Servidor MCP respondeu com ${status.server.tools} ferramentas. Clique para ver os detalhes.`
      : status.server.error
    : 'Verificando o servidor MCP…';
  return (
    <button
      type="button"
      onClick={() => useUiStore.getState().openSettings('mcp')}
      title={title}
      className={cn('flex items-center gap-1 hover:underline', health ? TONE[health] : 'text-fg-subtle')}
    >
      <Bot className="size-3" />
      {checking && !status ? 'verificando MCP…' : health ? LABEL[health] : 'MCP'}
    </button>
  );
}
