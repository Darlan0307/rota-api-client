import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

// O @rota/core é publicado como TypeScript puro dentro do monorepo, então
// precisa ser empacotado junto (e não tratado como dependência externa).
const bundleWorkspaceDeps = { exclude: ['@rota/core'] };

/**
 * Em desenvolvimento o React Refresh injeta um <script> inline no HTML, que a
 * CSP de produção (script-src 'self') bloquearia. Só o servidor de dev relaxa a regra.
 */
function devCspPlugin(): Plugin {
  return {
    name: 'rota:dev-csp',
    apply: 'serve',
    transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
  };
}

export default defineConfig({
  main: {
    build: { externalizeDeps: bundleWorkspaceDeps },
  },
  preload: {
    build: {
      externalizeDeps: bundleWorkspaceDeps,
      // Preload em sandbox precisa ser CommonJS.
      rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss(), devCspPlugin()],
    resolve: {
      alias: { '@renderer': resolve(import.meta.dirname, 'src/renderer/src') },
    },
  },
});
