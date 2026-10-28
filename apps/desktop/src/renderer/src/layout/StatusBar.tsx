import * as Popover from '@radix-ui/react-popover';
import { AlertTriangle, FolderOpen, ZoomIn } from 'lucide-react';
import { formatZoom } from '../../../shared/zoom';
import { ContextPackIndicator } from '../features/context-pack/ContextPackDialog';
import { McpStatusIndicator } from '../features/mcp/McpStatusIndicator';
import { TunnelStatusIndicator } from '../features/tunnels/TunnelsPanel';
import { api } from '../lib/api';
import { setUiZoom, useUiZoom } from '../lib/zoom';
import { useWorkspace } from '../state/workspace';

/** Só aparece fora dos 100%, para lembrar que o zoom está ligado e voltar com um clique. */
function ZoomIndicator() {
  const zoom = useUiZoom();
  if (Math.abs(zoom - 1) < 0.001) return null;
  return (
    <button
      type="button"
      onClick={() => setUiZoom(1)}
      title="Zoom da interface (Ctrl+= aumenta, Ctrl+- diminui). Clique para voltar a 100%."
      className="flex items-center gap-1 hover:text-fg-muted"
    >
      <ZoomIn className="size-3" />
      {formatZoom(zoom)}
    </button>
  );
}

/** Barra inferior: workspace aberto e avisos de arquivos que não puderam ser lidos. */
export function StatusBar() {
  const state = useWorkspace((s) => s.state);
  if (!state) return null;
  const { snapshot } = state;

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-surface px-3 text-2xs text-fg-subtle">
      <button
        type="button"
        onClick={() => void api.invoke('workspace:revealInExplorer')}
        className="flex min-w-0 items-center gap-1.5 hover:text-fg-muted"
        title={snapshot.root}
      >
        <FolderOpen className="size-3" />
        <span className="truncate">{state.isDefault ? 'Workspace principal' : snapshot.root}</span>
      </button>
      <div className="flex-1" />
      <ZoomIndicator />
      <ContextPackIndicator />
      <TunnelStatusIndicator />
      <McpStatusIndicator />
      {snapshot.problems.length > 0 && (
        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button" className="flex items-center gap-1 text-warning hover:underline">
              <AlertTriangle className="size-3" />
              {snapshot.problems.length}{' '}
              {snapshot.problems.length === 1 ? 'arquivo com problema' : 'arquivos com problema'}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="top"
              align="end"
              sideOffset={6}
              className="z-50 max-h-96 w-[min(560px,90vw)] overflow-auto rounded-lg border border-border bg-elevated p-3 text-xs shadow-xl shadow-black/40 animate-pop-in"
            >
              <p className="mb-2 font-medium text-fg">Arquivos ignorados ao carregar o workspace</p>
              <p className="mb-3 text-fg-muted">
                Estes arquivos não puderam ser lidos (JSON inválido ou formato inesperado). Corrija-os num
                editor; o app recarrega sozinho.
              </p>
              <ul className="space-y-2">
                {snapshot.problems.map((p) => (
                  <li key={p.path} className="rounded-md border border-border bg-bg p-2">
                    <p className="break-all font-mono text-fg">{p.path.replace(snapshot.root, '.')}</p>
                    <pre className="mt-1 whitespace-pre-wrap font-mono text-2xs text-danger">{p.message}</pre>
                  </li>
                ))}
              </ul>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </footer>
  );
}
