import { readFile } from 'node:fs/promises';
import {
  generateCode,
  importPostmanFiles,
  inspectFolder,
  maskSecretValues,
  prepareForDisplay,
  prepareProjectFolder,
  previewPostmanFiles,
  variableScopeFor,
  withRecentWorkspace,
} from '@rota/core';
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

  // Histórico
  handle('history:list', (_e, query, limit) => workspace.history.list({ query, limit }));
  handle('history:get', async (_e, id) => (await workspace.history.get(id)) ?? null);
  handle('history:remove', async (event, id) => {
    await workspace.history.remove(id);
    event.sender.send('history:changed', null);
  });
  handle('history:clear', async (event) => {
    await workspace.history.clear();
    event.sender.send('history:changed', null);
  });

  // Gerar código (segredos mascarados, a menos que o usuário peça para revelar)
  handle('codegen:generate', (_e, input) => {
    const prepared = prepareForDisplay(input.data, {
      store: workspace.current,
      requestId: input.requestId,
      parentId: input.parentId,
      environmentId: workspace.activeEnvironmentId,
      defaultTimeoutMs: settings.get().defaultTimeoutMs,
      reveal: input.reveal,
    });
    return generateCode(prepared, input.target);
  });

  // Lixeira
  const trashChanged = (sender: Electron.WebContents) => sender.send('trash:changed', null);
  handle('trash:list', () => workspace.trash.list());
  handle('trash:restore', async (event, id) => {
    await workspace.trash.restore(id);
    workspace.emit();
    trashChanged(event.sender);
  });
  handle('trash:remove', async (event, id) => {
    await workspace.trash.remove(id);
    trashChanged(event.sender);
  });
  handle('trash:empty', async (event) => {
    const count = await workspace.trash.empty();
    trashChanged(event.sender);
    return count;
  });

  // Workspaces de projeto
  handle('workspace:pickFolder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Abrir pasta como workspace',
      buttonLabel: 'Abrir',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle('workspace:inspectFolder', (_e, path) => inspectFolder(path));
  handle('workspace:open', async (event, path, prepare) => {
    if (path && prepare) await prepareProjectFolder(path, prepare);
    const state = await workspace.open(path);
    const current = settings.get();
    await settings.update({
      currentWorkspace: path,
      ...(path ? { recentWorkspaces: withRecentWorkspace(current, path).recentWorkspaces } : {}),
    });
    trashChanged(event.sender);
    event.sender.send('history:changed', null);
    workspace.emit();
    return state;
  });
  handle('workspace:recent', () => ({
    current: settings.get().currentWorkspace,
    recent: settings.get().recentWorkspaces,
  }));
  handle('workspace:forgetRecent', async (_e, path) => {
    const current = settings.get();
    await settings.update({ recentWorkspaces: current.recentWorkspaces.filter((p) => p !== path) });
  });

  // Exemplos: o arquivo é versionado, então valores secretos são mascarados antes de gravar.
  handle('examples:save', async (_e, input) => {
    const store = workspace.current;
    const secrets = variableScopeFor(store, {
      requestId: input.requestId,
      environmentId: workspace.activeEnvironmentId,
    }).secretValues();
    const mask = (text: string) => maskSecretValues(text, secrets);
    const res = input.response;
    const body =
      res.body.encoding === 'utf8' ? mask(res.body.data) : '(resposta binária não salva no exemplo)';
    const id = await store.saveExample(input.requestId, {
      name: input.name,
      ...(input.request
        ? {
            request: {
              method: input.request.method,
              url: mask(input.request.url),
              headers: input.request.headers.map(([key, value]) => ({
                key,
                value: mask(value),
                enabled: true,
              })),
              ...(input.request.body.kind === 'text' ? { body: mask(input.request.body.text) } : {}),
            },
          }
        : {}),
      response: {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers.map(([key, value]) => ({ key, value: mask(value), enabled: true })),
        body,
        timeMs: res.timings.total,
      },
      savedAt: new Date().toISOString(),
    });
    workspace.emit();
    return id;
  });
}
