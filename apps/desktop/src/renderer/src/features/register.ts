import { registerOverlay } from '../layout/DialogHost';
import { registerWelcomeExtensions } from '../layout/MainArea';
import { registerSidebarExtensions } from '../layout/Sidebar';
import { ImportDialog, openImportDialog } from './import/ImportDialog';

/**
 * Registra as funcionalidades que se conectam ao layout por pontos de
 * extensão (importação, histórico, cURL, scripts, lixeira, workspaces, MCP).
 * Cada fase acrescenta o seu registro aqui.
 */
export function registerFeatures(): void {
  // Fase 3: importação do Postman.
  registerOverlay(ImportDialog);
  registerSidebarExtensions({ onImport: openImportDialog });
  registerWelcomeExtensions({ onImport: openImportDialog });
}
