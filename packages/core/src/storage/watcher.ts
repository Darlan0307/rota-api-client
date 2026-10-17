import { watch } from 'chokidar';
import { TEMP_SUFFIX } from '../util/fs';

export interface WorkspaceWatcher {
  close(): Promise<void>;
}

/**
 * Observa a pasta do workspace e chama `onChange` (com debounce) quando algo
 * muda por fora — edição manual, `git pull`, ou o servidor MCP.
 */
export function watchWorkspace(root: string, onChange: () => void, debounceMs = 150): WorkspaceWatcher {
  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(root, {
    ignoreInitial: true,
    ignored: (path) => path.endsWith(TEMP_SUFFIX) || /[\\/](\.git|node_modules)([\\/]|$)/.test(path),
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
  });

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };
  watcher.on('all', schedule);
  watcher.on('error', () => undefined);

  return {
    async close() {
      clearTimeout(timer);
      await watcher.close();
    },
  };
}
