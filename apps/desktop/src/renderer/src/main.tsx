import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerFeatures } from './features/register';
import { defineMonacoTheme, monaco } from './lib/monaco';
import { useUiStore } from './state/ui';
import { applyPalette } from './theme/apply';
import { applyDensity } from './theme/display';
import { PALETTES } from './theme/palettes';

// Aplica a paleta antes do primeiro render para não piscar.
function applyAll(id: keyof typeof PALETTES) {
  applyPalette(PALETTES[id]);
  defineMonacoTheme(PALETTES[id]);
}
applyAll(useUiStore.getState().paletteId);
applyDensity(useUiStore.getState().density);
useUiStore.subscribe((state, prev) => {
  if (state.paletteId !== prev.paletteId) applyAll(state.paletteId);
  if (state.density !== prev.density) applyDensity(state.density);
  // O Monaco guarda a largura dos caracteres: sem remedir, o cursor desalinha com a fonte nova.
  if (state.editorFont !== prev.editorFont || state.editorFontSize !== prev.editorFontSize)
    setTimeout(() => monaco.editor.remeasureFonts(), 50);
});

registerFeatures();

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
