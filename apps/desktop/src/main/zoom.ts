import type { BrowserWindow } from 'electron';
import { TITLE_BAR_HEIGHT } from '../shared/constants';
import { ZOOM_STEPS } from '../shared/zoom';

/**
 * Aplica o zoom na página e na faixa dos botões nativos da janela: o
 * titleBarOverlay não acompanha o zoom do conteúdo, e sem isso a barra de
 * título do app ficaria mais alta (ou mais baixa) que os botões do Windows.
 */
export function applyZoom(win: BrowserWindow, zoom: number): void {
  win.webContents.setZoomFactor(zoom);
  win.setTitleBarOverlay({ height: Math.round(TITLE_BAR_HEIGHT * zoom) });
}

/** Próximo passo da lista (o zoom atual pode estar fora dela, vindo do settings.json). */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction === 1) return ZOOM_STEPS.find((z) => z > current + 0.001) ?? current;
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? current;
}

/**
 * Ctrl+= / Ctrl+- / Ctrl+0 (e os do teclado numérico). Fica no processo
 * principal para valer com o foco em qualquer lugar, inclusive no Monaco.
 */
export function installZoomShortcuts(
  win: BrowserWindow,
  current: () => number,
  change: (zoom: number) => void,
): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return;
    let next: number | undefined;
    if (input.key === '=' || input.key === '+' || input.code === 'NumpadAdd') next = stepZoom(current(), 1);
    else if (input.key === '-' || input.code === 'NumpadSubtract') next = stepZoom(current(), -1);
    else if (input.key === '0' || input.code === 'Numpad0') next = 1;
    if (next === undefined) return;
    event.preventDefault();
    if (next !== current()) change(next);
  });
}
