import { readFile } from 'node:fs/promises';
import { importPostmanFiles, previewPostmanFiles } from '@rota/core';
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain, shell } from 'electron';
import { IPC_ERROR_PREFIX, type IpcArgs, type IpcChannel, type IpcResult } from '../shared/ipc';
import type { RequestService } from './services/request-service';
import type { SettingsService } from './services/settings-service';
import type { WorkspaceService } from './services/workspace-service';

type Handler<C extends IpcChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcArgs<C>
) => IpcResult<C> | Promise<IpcResult<C>>;

function handle<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...(args as IpcArgs<C>));
    } catch (error) {
      // Prefixo permite ao preload recuperar a mensagem original para o usuário.
      throw new Error(`${IPC_ERROR_PREFIX}${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

export interface Services {
  workspace: WorkspaceService;
  requests: RequestService;
  settings: SettingsService;
}

export function registerIpcHandlers({ workspace, requests, settings }: Services): void {
  handle('app:getInfo', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    userDataPath: app.getPath('userData'),
  }));

  handle('window:setTitleBarColors', (event, colors) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && process.platform === 'win32') {
      win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor });
    }
  });

  handle('settings:get', () => settings.get());
  handle('settings:update', (_e, patch) => settings.update(patch));

  handle('workspace:get', () => workspace.state());
  handle('workspace:command', (_e, command) => workspace.command(command));
  handle('workspace:setActiveEnvironment', (_e, id) => workspace.setActiveEnvironment(id));
  handle('workspace:revealInExplorer', (_e, id) => {
    const path = id ? workspace.current.pathOf(id) : workspace.current.root;
    if (path) shell.showItemInFolder(path);
  });

  handle('secrets:reveal', (_e, target, key) => workspace.revealSecret(target, key));

  handle('request:send', (_e, input) => requests.send(input));
  handle('request:cancel', (_e, runId) => requests.cancel(runId));

  handle('dialog:openFiles', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: Electron.OpenDialogOptions = {
      title: options.title ?? 'Selecionar arquivo',
      properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    };
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? [] : result.filePaths;
  });

  // Importação do Postman: o renderer só passa caminhos; o main lê os arquivos.
  const readFiles = (paths: string[]) =>
    Promise.all(paths.map(async (path) => ({ fileName: path, content: await readFile(path, 'utf8') })));

  handle('import:pickFiles', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Importar do Postman',
      buttonLabel: 'Selecionar',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Exportações do Postman (JSON)', extensions: ['json'] }],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });
  handle('import:preview', async (_e, paths) => previewPostmanFiles(await readFiles(paths)));
  handle('import:run', async (_e, paths, secretKeys) => {
    const report = await importPostmanFiles(workspace.current, await readFiles(paths), { secretKeys });
    workspace.emit();
    return report;
  });
}
