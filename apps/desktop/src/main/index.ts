import { join } from 'node:path';
import { app, BrowserWindow, Menu, shell } from 'electron';
import { APP_NAME, TITLE_BAR_HEIGHT } from '../shared/constants';
import { registerIpcHandlers } from './ipc';

// Cores iniciais da janela (antes do renderer aplicar a paleta), evitando
// o "flash" branco ao abrir.
const INITIAL_BG = '#0E0F1A';
const INITIAL_SYMBOL = '#A3A6C2';

app.setName(APP_NAME);

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
// (Também será a base para a ponte com o servidor MCP.)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  void app.whenReady().then(() => {
    app.setAppUserModelId('dev.rota.app');
    installMenu();
    registerIpcHandlers();
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
