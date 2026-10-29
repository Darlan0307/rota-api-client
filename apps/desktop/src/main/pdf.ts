import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, type NativeImage, nativeImage } from 'electron';

/**
 * Renderiza um HTML completo (gerado pelo Rota, sem scripts: a CSP do próprio
 * documento bloqueia tudo) numa janela invisível. O HTML vai para um arquivo
 * temporário porque URLs data: grandes falham ao carregar.
 */
async function withHtmlWindow<T>(
  html: string,
  width: number,
  javascript: boolean,
  work: (win: BrowserWindow) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'rota-render-'));
  const file = join(dir, 'relatorio.html');
  const win = new BrowserWindow({
    show: false,
    width,
    height: VIEWPORT,
    useContentSize: true,
    webPreferences: { javascript, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  try {
    await writeFile(file, html, 'utf8');
    await win.loadFile(file);
    return await work(win);
  } finally {
    win.destroy();
    await rm(dir, { recursive: true, force: true });
  }
}

export function htmlToPdf(html: string): Promise<Buffer> {
  return withHtmlWindow(html, 900, false, (win) =>
    win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    }),
  );
}

/** Altura de cada fatia capturada (px CSS). */
const VIEWPORT = 1000;
/** Altura máxima de cada imagem (px CSS): acima disso o relatório vira partes. */
export const MAX_PART_HEIGHT = 8000;

/**
 * Converte o HTML em uma ou mais imagens PNG. A janela só captura o que está
 * visível, então a página é fotografada em fatias (rolando) e as fatias são
 * emendadas pelo bitmap, sem biblioteca de imagem.
 */
export function htmlToImages(html: string, width: number): Promise<NativeImage[]> {
  // O JavaScript da janela fica ligado só para medir e rolar (executeJavaScript);
  // a CSP do documento continua bloqueando qualquer script do conteúdo.
  return withHtmlWindow(html, width, true, async (win) => {
    // O Windows limita a janela à altura da tela: a fatia é a área visível
    // medida, nunca a pedida. A barra de rolagem não pode entrar na foto.
    const measured = (await win.webContents.executeJavaScript(`
      (async () => {
        const style = document.createElement('style');
        style.textContent = '::-webkit-scrollbar{display:none}';
        document.head.appendChild(style);
        await document.fonts.ready;
        return {
          total: Math.ceil(document.documentElement.scrollHeight),
          view: window.innerHeight,
          cssWidth: window.innerWidth,
        };
      })()
    `)) as { total: number; view: number; cssWidth: number };
    const view = Math.max(200, Math.floor(measured.view));
    const total = Math.max(1, measured.total);
    const slices = Math.ceil(total / view);
    // Completa a página até um múltiplo da fatia: a última não sobrepõe a anterior.
    await win.webContents.executeJavaScript(
      `document.documentElement.style.minHeight = '${slices * view}px'; true`,
    );

    const captured: NativeImage[] = [];
    for (let i = 0; i < slices; i++) {
      await win.webContents.executeJavaScript(
        `window.scrollTo(0, ${i * view}); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`,
      );
      captured.push(
        await win.webContents.capturePage({ x: 0, y: 0, width: measured.cssWidth, height: view }),
      );
    }

    const first = captured[0] as NativeImage;
    const { width: pixelWidth, height: sliceHeight } = first.getSize();
    const scale = sliceHeight / view;
    const perPart = Math.max(1, Math.floor(MAX_PART_HEIGHT / view));
    const parts: NativeImage[] = [];
    for (let start = 0; start < slices; start += perPart) {
      const group = captured.slice(start, start + perPart);
      // Todas as fatias precisam ter o mesmo tamanho para emendar pelo bitmap.
      const same = group.map((img) => {
        const size = img.getSize();
        return size.width === pixelWidth && size.height === sliceHeight
          ? img
          : img.resize({ width: pixelWidth, height: sliceHeight });
      });
      const joined = nativeImage.createFromBitmap(Buffer.concat(same.map((img) => img.toBitmap())), {
        width: pixelWidth,
        height: sliceHeight * group.length,
      });
      // Corta a sobra da última fatia (o espaço acrescentado pelo minHeight).
      const cssHeight = Math.min(total - start * view, group.length * view);
      parts.push(
        joined.crop({
          x: 0,
          y: 0,
          width: pixelWidth,
          height: Math.min(sliceHeight * group.length, Math.round(cssHeight * scale)),
        }),
      );
    }
    return parts;
  });
}
