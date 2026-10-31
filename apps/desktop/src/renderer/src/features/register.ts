import { createElement, Fragment } from 'react';
import { type MenuEntry, MoreActions } from '../components/ActionMenu';
import { registerOverlay } from '../layout/DialogHost';
import { registerWelcomeExtensions } from '../layout/MainArea';
import { registerSearchContent } from '../layout/SearchDialog';
import { registerMcpSettings } from '../layout/SettingsDialog';
import { registerSidebarExtensions } from '../layout/Sidebar';
import { registerWorkspaceMenu } from '../layout/TitleBar';
import { AppearanceDialog } from './appearance/AppearanceDialog';
import { BackupDialog, openBackupDialog } from './backup/BackupDialog';
import { AskClaudeButton } from './claude/AskClaude';
import { CodegenButton, CodegenDialog } from './codegen/CodegenDialog';
import { compareSections } from './compare/ResponseCompare';
import { addToPackAction, ContextPackDialog } from './context-pack/ContextPackDialog';
import { handleUrlPaste } from './curl/paste-curl';
import { ConnectionDialog } from './databases/ConnectionDialog';
import { CredentialsDialog } from './databases/CredentialsDialog';
import { DatabaseGuideDialog } from './databases/DatabaseGuide';
import { DatabasesActions, DatabasesPanel } from './databases/DatabasesPanel';
import { SqlBuilderDialog } from './databases/SqlBuilderDialog';
import { SqlExamplesDialog } from './databases/SqlExamplesDialog';
import { subscribeDatabaseEvents } from './databases/state';
import { DynamicVariablesDialog, dynamicVariablesAction } from './dynamic/DynamicVariablesDialog';
import { FillTestDataDialog } from './dynamic/FillTestDataDialog';
import { EvidenceDialog, evidenceAction } from './evidence/EvidenceDialog';
import { SaveExampleButton } from './examples/ExampleTabView';
import { HistoryActions, HistoryPanel } from './history/HistoryPanel';
import { ImportDialog, openImportDialog } from './import/ImportDialog';
import { loadTestAction } from './loadtest/LoadTestView';
import { McpConfirmDialog, subscribeMcpEvents } from './mcp/McpConfirmDialog';
import { McpSettings } from './mcp/McpSettings';
import { registerRequestEditorExtensions } from './request/RequestEditor';
import { SaveToVariableDialog } from './response/SaveToVariableDialog';
import { scriptResultSections } from './scripts/ScriptResults';
import { ScriptsEditor } from './scripts/ScriptsEditor';
import { SearchPalette } from './search/SearchPalette';
import { SendHistoryBanner, SendHistoryButton } from './send-history/SendHistory';
import { TrashActions, TrashPanel } from './trash/TrashPanel';
import { subscribeTunnelEvents } from './tunnels/state';
import { TunnelGuideDialog } from './tunnels/TunnelGuide';
import { TunnelsActions, TunnelsPanel } from './tunnels/TunnelsPanel';
import { WebhookSimulatorDialog } from './tunnels/WebhookSimulator';
import { generateTypesAction, TypesDialog } from './types/TypesDialog';
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
  registerOverlay(TypesDialog);
  registerOverlay(ContextPackDialog);
  registerOverlay(EvidenceDialog);
  registerRequestEditorExtensions({
    onUrlPaste: handleUrlPaste,
    // Principais à vista; as secundárias ficam no "⋯" de cada barra.
    headerActions: (tab) =>
      createElement(
        Fragment,
        null,
        createElement(CodegenButton, { tabId: tab.id }),
        createElement(AskClaudeButton, { tab }),
      ),
    headerMoreActions: (tab) => [loadTestAction(tab), dynamicVariablesAction],
    responseActions: (tab) =>
      createElement(
        Fragment,
        null,
        createElement(SendHistoryButton, { tab }),
        createElement(SaveExampleButton, { tab }),
        createElement(MoreActions, {
          entries: [evidenceAction(tab), generateTypesAction(tab), addToPackAction(tab)].filter(
            (e): e is MenuEntry => e !== null,
          ),
        }),
      ),
    responseBanner: (tab) => createElement(SendHistoryBanner, { tab }),
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
  registerOverlay(FillTestDataDialog);
  registerOverlay(SaveToVariableDialog);

  // Túneis (cloudflared) para receber webhooks.
  registerSidebarExtensions({
    tunnels: (filter) => createElement(TunnelsPanel, { filter }),
    tunnelsActions: () => createElement(TunnelsActions),
  });
  registerOverlay(TunnelGuideDialog);
  registerOverlay(WebhookSimulatorDialog);
  subscribeTunnelEvents();

  // Bancos de dados (Firebird).
  registerSidebarExtensions({
    databases: (filter) => createElement(DatabasesPanel, { filter }),
    databasesActions: () => createElement(DatabasesActions),
  });
  registerOverlay(ConnectionDialog);
  registerOverlay(CredentialsDialog);
  // Depois do ConnectionDialog: abre por cima dele.
  registerOverlay(DatabaseGuideDialog);
  registerOverlay(SqlBuilderDialog);
  // Depois do SqlBuilderDialog: os exemplos abrem por cima dele.
  registerOverlay(SqlExamplesDialog);
  subscribeDatabaseEvents();

  // Backup completo no formato do Postman.
  registerOverlay(BackupDialog);

  // Ícone e cor de coleções e pastas.
  registerOverlay(AppearanceDialog);
  registerSidebarExtensions({ onBackup: openBackupDialog });
  registerWelcomeExtensions({ onBackup: openBackupDialog });
}
