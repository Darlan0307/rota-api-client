import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useUiStore } from './state/ui';
import { applyPalette } from './theme/apply';
import { PALETTES } from './theme/palettes';

// Aplica a paleta antes do primeiro render para não piscar.
applyPalette(PALETTES[useUiStore.getState().paletteId]);
useUiStore.subscribe((state, prev) => {
  if (state.paletteId !== prev.paletteId) applyPalette(PALETTES[state.paletteId]);
});

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
