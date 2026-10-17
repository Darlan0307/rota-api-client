import { createElement, Fragment } from 'react';
import { registerOverlay } from '../layout/DialogHost';
import { registerWelcomeExtensions } from '../layout/MainArea';
import { registerSearchContent } from '../layout/SearchDialog';
import { registerMcpSettings } from '../layout/SettingsDialog';
import { registerSidebarExtensions } from '../layout/Sidebar';
import { registerWorkspaceMenu } from '../layout/TitleBar';
import { BackupDialog, openBackupDialog } from './backup/BackupDialog';
import { AskClaudeButton } from './claude/AskClaude';
import { CodegenButton, CodegenDialog } from './codegen/CodegenDialog';
import { compareSections } from './compare/ResponseCompare';
import { handleUrlPaste } from './curl/paste-curl';
import { DynamicVariablesButton, DynamicVariablesDialog } from './dynamic/DynamicVariablesDialog';
import { SaveExampleButton } from './examples/ExampleTabView';
import { HistoryActions, HistoryPanel } from './history/HistoryPanel';
import { ImportDialog, openImportDialog } from './import/ImportDialog';
import { LoadTestButton } from './loadtest/LoadTestView';
import { McpConfirmDialog, subscribeMcpEvents } from './mcp/McpConfirmDialog';
import { McpSettings } from './mcp/McpSettings';
import { registerRequestEditorExtensions } from './request/RequestEditor';
import { SaveToVariableDialog } from './response/SaveToVariableDialog';
import { scriptResultSections } from './scripts/ScriptResults';
import { ScriptsEditor } from './scripts/ScriptsEditor';
import { SearchPalette } from './search/SearchPalette';
import { TrashActions, TrashPanel } from './trash/TrashPanel';
import { subscribeTunnelEvents } from './tunnels/state';
import { TunnelGuideDialog } from './tunnels/TunnelGuide';
import { TunnelsActions, TunnelsPanel } from './tunnels/TunnelsPanel';
import { WebhookSimulatorDialog } from './tunnels/WebhookSimulator';
import { NewWorkspaceDialog, openFolderAsWorkspace, WorkspaceMenu } from './workspaces/WorkspaceMenu';

/**
 * Registra as funcionalidades que se conectam ao layout por pontos de
 * extensão (importação, histórico, cURL, scripts, lixeira, workspaces, MCP).
 */
export function registerFeatures(): void {
  // Importação.
  registerOverlay(ImportDialog);
  registerSidebarExtensions({ onImport: openImportDialog });
  registerWelcomeExtensions({ onImport: openImportDialog });

  // Histórico, gerar código, colar cURL, exemplos e busca global.
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
        createElement(AskClaudeButton, { tab }),
        createElement(DynamicVariablesButton),
      ),
    responseActions: (tab) => createElement(SaveExampleButton, { tab }),
  });
  registerSearchContent((close) => createElement(SearchPalette, { close }));

  // Scripts e testes no padrão pm.*.
  registerRequestEditorExtensions({
    renderScripts: (tab, onChange) =>
      createElement(ScriptsEditor, {
        scripts: tab.draft.scripts,
        onChange: (scripts) => onChange({ ...tab.draft, scripts }),
        scopeNote: 'Scripts da coleção e das pastas rodam antes deste.',
      }),
    responseSections: (tab) => [...scriptResultSections(tab), ...compareSections(tab)],
  });

  // Lixeira e workspaces de projeto.
  registerSidebarExtensions({
    trash: (filter) => createElement(TrashPanel, { filter }),
    trashActions: () => createElement(TrashActions),
  });
  registerWorkspaceMenu(() => createElement(WorkspaceMenu));
  registerOverlay(NewWorkspaceDialog);
  registerWelcomeExtensions({ onOpenFolder: () => void openFolderAsWorkspace() });

  // Claude (MCP): confirmações, avisos e configuração.
  registerOverlay(McpConfirmDialog);
  subscribeMcpEvents();
  registerMcpSettings(() => createElement(McpSettings));

  // Dados de teste e salvar em variável.
  registerOverlay(DynamicVariablesDialog);
  registerOverlay(SaveToVariableDialog);

  // Túneis (cloudflared) para receber webhooks.
  registerSidebarExtensions({
    tunnels: (filter) => createElement(TunnelsPanel, { filter }),
    tunnelsActions: () => createElement(TunnelsActions),
  });
  registerOverlay(TunnelGuideDialog);
  registerOverlay(WebhookSimulatorDialog);
  subscribeTunnelEvents();

  // Backup completo no formato do Postman.
  registerOverlay(BackupDialog);
  registerSidebarExtensions({ onBackup: openBackupDialog });
  registerWelcomeExtensions({ onBackup: openBackupDialog });
}
