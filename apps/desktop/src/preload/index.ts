import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_ERROR_PREFIX, isIpcChannel, isIpcEvent, type RendererApi } from '../shared/ipc';

const api: RendererApi = {
  async invoke(channel, ...args) {
    if (!isIpcChannel(channel)) throw new Error(`Canal IPC não permitido: ${String(channel)}`);
    try {
      return await ipcRenderer.invoke(channel, ...args);
    } catch (error) {
      // O Electron embrulha a mensagem ("Error invoking remote method ..."); recupera a original.
      const message = error instanceof Error ? error.message : String(error);
      const index = message.indexOf(IPC_ERROR_PREFIX);
      throw new Error(index >= 0 ? message.slice(index + IPC_ERROR_PREFIX.length) : message);
    }
  },
  on(event, listener) {
    if (!isIpcEvent(event)) throw new Error(`Evento IPC não permitido: ${String(event)}`);
    const handler = (_: Electron.IpcRendererEvent, payload: unknown) => listener(payload as never);
    ipcRenderer.on(event, handler);
    return () => ipcRenderer.removeListener(event, handler);
  },
  pathForFile(file) {
    return webUtils.getPathForFile(file);
  },
};

contextBridge.exposeInMainWorld('api', api);
