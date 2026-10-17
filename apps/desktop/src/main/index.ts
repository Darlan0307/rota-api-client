import { join } from 'node:path';
import { appDataDir, EncryptedFileSecretStore, keyringMasterKey } from '@rota/core';
import { app, BrowserWindow, Menu, shell } from 'electron';
import { APP_NAME, TITLE_BAR_HEIGHT } from '../shared/constants';
import type { WorkspaceState } from '../shared/ipc';
import { registerIpcHandlers } from './ipc';
import { DatabaseService } from './services/database-service';
import { LoadTestService } from './services/loadtest-service';
import { McpBridge } from './services/mcp-bridge';
import { RequestService } from './services/request-service';
import { SettingsService } from './services/settings-service';
import { TunnelService } from './services/tunnel-service';
import { WorkspaceService } from './services/workspace-service';

// Cores iniciais da janela (antes do renderer aplicar a paleta), evitando
// o "flash" branco ao abrir.
const INITIAL_BG = '#0E0F1A';
const INITIAL_SYMBOL = '#A3A6C2';

app.setName(APP_NAME);
// Dados do Chromium (cache, localStorage) numa subpasta, separados dos dados do
// app em %APPDATA%/Rota (settings.json, workspace padrão, segredos), que o MCP também lê.
app.setPath('userData', join(appDataDir(), 'electron'));

function broadcast(state: WorkspaceState): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('workspace:changed', state);
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    backgroundColor: INITIAL_BG,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: INITIAL_BG, symbolColor: INITIAL_SYMBOL, height: TITLE_BAR_HEIGHT },
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // O renderer nunca navega para fora do app; links externos abrem no navegador.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }

  return win;
}

/**
 * O menu padrão do Electron captura atalhos que o app usa (ex.: Ctrl+W fecharia
 * a janela). Em produção não há menu; em desenvolvimento ficam só recarregar e DevTools.
 */
function installMenu(): void {
  if (app.isPackaged) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Dev',
        submenu: [
          { role: 'reload', accelerator: 'F5' },
          { role: 'toggleDevTools', accelerator: 'F12' },
        ],
      },
    ]),
  );
}

// Uma única instância: abrir o atalho de novo foca a janela existente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  void app.whenReady().then(async () => {
    app.setAppUserModelId('dev.rota.app');
    installMenu();

    const settings = new SettingsService();
    const workspace = new WorkspaceService(broadcast, () => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('trash:changed', null);
    });
    const requests = new RequestService(workspace, settings, `${APP_NAME}/${app.getVersion()}`, () => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('history:changed', null);
    });
    const loaded = await settings.load();
    try {
      await workspace.open(loaded.currentWorkspace);
    } catch {
      // Pasta de projeto removida/inacessível: volta para o workspace padrão.
      await settings.update({ currentWorkspace: null });
      await workspace.open(null);
    }
    const loadTests = new LoadTestService(workspace, settings, `${APP_NAME}/${app.getVersion()}`);
    const mcp = new McpBridge(workspace);
    await mcp.start().catch((error: unknown) => {
      // Outra instância (ou um processo antigo) segurando o pipe: o app segue sem a ponte.
      console.error('Ponte com o MCP indisponível:', error);
    });
    const machineSecrets = new EncryptedFileSecretStore(join(appDataDir(), 'app-secrets.json'), () =>
      keyringMasterKey(),
    );
    const tunnels = new TunnelService(appDataDir(), machineSecrets, (views) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('tunnel:changed', views);
    });
    await tunnels.load();
    // Senhas de banco ficam no mesmo arquivo cifrado da máquina, em escopos próprios.
    const databases = new DatabaseService(appDataDir(), machineSecrets, (state) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('db:changed', state);
    });
    await databases.load();

    // Fechar o app encerra tudo: túneis (cloudflared), ponte com o Claude e o
    // vigia de arquivos. Depois sai de vez (app.exit), sem processo sobrando.
    let quitting = false;
    app.on('before-quit', (event) => {
      if (quitting) return;
      quitting = true;
      event.preventDefault();
      for (const win of BrowserWindow.getAllWindows()) win.hide();
      const cleanup = Promise.allSettled([
        tunnels.stopAll(),
        databases.closeAll(),
        mcp.stop(),
        workspace.close(),
      ]);
      // Limite de segurança: algo travado não pode segurar o processo aberto.
      const limit = new Promise((resolve) => setTimeout(resolve, 3000));
      void Promise.race([cleanup, limit]).then(() => app.exit(0));
    });
    registerIpcHandlers({ workspace, requests, settings, loadTests, mcp, tunnels, databases });
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
