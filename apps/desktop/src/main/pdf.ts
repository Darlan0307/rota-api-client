import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow } from 'electron';

/**
 * Converte um HTML completo em PDF com o próprio Chromium do Electron, numa
 * janela invisível sem JavaScript. O HTML vai para um arquivo temporário
 * porque URLs data: grandes falham ao carregar.
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'rota-pdf-'));
  const file = join(dir, 'relatorio.html');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true },
  });
  try {
    await writeFile(file, html, 'utf8');
    await win.loadFile(file);
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });
  } finally {
    win.destroy();
    await rm(dir, { recursive: true, force: true });
  }
}
