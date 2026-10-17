import { createElement } from 'react';
import { registerOverlay } from '../layout/DialogHost';
import { registerWelcomeExtensions } from '../layout/MainArea';
import { registerSearchContent } from '../layout/SearchDialog';
import { registerSidebarExtensions } from '../layout/Sidebar';
import { CodegenButton, CodegenDialog } from './codegen/CodegenDialog';
import { handleUrlPaste } from './curl/paste-curl';
import { SaveExampleButton } from './examples/ExampleTabView';
import { HistoryActions, HistoryPanel } from './history/HistoryPanel';
import { ImportDialog, openImportDialog } from './import/ImportDialog';
import { registerRequestEditorExtensions } from './request/RequestEditor';
import { SearchPalette } from './search/SearchPalette';

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

  // Fase 4: histórico, gerar código, colar cURL, exemplos e busca global.
  registerSidebarExtensions({
    history: (filter) => createElement(HistoryPanel, { filter }),
    historyActions: () => createElement(HistoryActions),
  });
  registerOverlay(CodegenDialog);
  registerRequestEditorExtensions({
    onUrlPaste: handleUrlPaste,
    headerActions: (tab) => createElement(CodegenButton, { tabId: tab.id }),
    responseActions: (tab) => createElement(SaveExampleButton, { tab }),
  });
  registerSearchContent((close) => createElement(SearchPalette, { close }));
}
