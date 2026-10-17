import { createElement, Fragment } from 'react';
import { registerOverlay } from '../layout/DialogHost';
import { registerWelcomeExtensions } from '../layout/MainArea';
import { registerSearchContent } from '../layout/SearchDialog';
import { registerMcpSettings } from '../layout/SettingsDialog';
import { registerSidebarExtensions } from '../layout/Sidebar';
import { registerWorkspaceMenu } from '../layout/TitleBar';
import { CodegenButton, CodegenDialog } from './codegen/CodegenDialog';
import { handleUrlPaste } from './curl/paste-curl';
import { SaveExampleButton } from './examples/ExampleTabView';
import { HistoryActions, HistoryPanel } from './history/HistoryPanel';
import { ImportDialog, openImportDialog } from './import/ImportDialog';
import { LoadTestButton } from './loadtest/LoadTestView';
import { McpConfirmDialog, subscribeMcpEvents } from './mcp/McpConfirmDialog';
import { McpSettings } from './mcp/McpSettings';
import { registerRequestEditorExtensions } from './request/RequestEditor';
import { scriptResultSections } from './scripts/ScriptResults';
import { ScriptsEditor } from './scripts/ScriptsEditor';
import { SearchPalette } from './search/SearchPalette';
import { TrashActions, TrashPanel } from './trash/TrashPanel';
import { NewWorkspaceDialog, openFolderAsWorkspace, WorkspaceMenu } from './workspaces/WorkspaceMenu';

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
    headerActions: (tab) =>
      createElement(
        Fragment,
        null,
        createElement(LoadTestButton, { tab }),
        createElement(CodegenButton, { tabId: tab.id }),
      ),
    responseActions: (tab) => createElement(SaveExampleButton, { tab }),
  });
  registerSearchContent((close) => createElement(SearchPalette, { close }));

  // Fase 5: scripts e testes no padrão pm.*.
  registerRequestEditorExtensions({
    renderScripts: (tab, onChange) =>
      createElement(ScriptsEditor, {
        scripts: tab.draft.scripts,
        onChange: (scripts) => onChange({ ...tab.draft, scripts }),
        scopeNote: 'Scripts da coleção e das pastas rodam antes deste.',
      }),
    responseSections: scriptResultSections,
  });

  // Fase 6: lixeira e workspaces de projeto.
  registerSidebarExtensions({
    trash: (filter) => createElement(TrashPanel, { filter }),
    trashActions: () => createElement(TrashActions),
  });
  registerWorkspaceMenu(() => createElement(WorkspaceMenu));
  registerOverlay(NewWorkspaceDialog);
  registerWelcomeExtensions({ onOpenFolder: () => void openFolderAsWorkspace() });

  // Fase 8: confirmações e avisos do Claude (MCP).
  registerOverlay(McpConfirmDialog);
  subscribeMcpEvents();

  // Fase 9: configuração do Claude Desktop / Claude Code.
  registerMcpSettings(() => createElement(McpSettings));
}
