import { app, BrowserWindow, type IpcMainInvokeEvent, ipcMain } from 'electron';
import type { IpcArgs, IpcChannel, IpcResult } from '../shared/ipc';

type Handler<C extends IpcChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcArgs<C>
) => IpcResult<C> | Promise<IpcResult<C>>;

function handle<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, (event, ...args) => handler(event, ...(args as IpcArgs<C>)));
}

export function registerIpcHandlers(): void {
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
}
