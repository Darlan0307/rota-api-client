import { contextBridge, ipcRenderer } from 'electron';
import { isIpcChannel, type RendererApi } from '../shared/ipc';

const api: RendererApi = {
  invoke(channel, ...args) {
    if (!isIpcChannel(channel)) {
      return Promise.reject(new Error(`Canal IPC não permitido: ${String(channel)}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
};

contextBridge.exposeInMainWorld('api', api);
