/** Ponto de entrada completo (Node): app (processo principal) e servidor MCP. */

export { generateCode, shellQuote } from './codegen/codegen';
export { type HistoryQuery, HistoryStore } from './history/history-store';
export type { ExecuteOptions } from './http/execute';
export { executeRequest, HttpError, isBypassed } from './http/execute';
export type { PrepareOptions } from './http/prepare';
export { findHeader, prepareRequest } from './http/prepare';
export type {
  ImportFileInput,
  ImportOptions,
  ImportPreview,
  ImportReport,
  ImportResultItem,
} from './import/import-postman';
export { importPostmanFiles, previewPostmanFiles } from './import/import-postman';
export type { ImportCounts, ImportWarning, PostmanFileKind } from './import/postman';
export {
  convertCollection,
  convertEnvironment,
  convertGlobals,
  detectPostmanFile,
  looksSensitive,
} from './import/postman';
export { type LoadTestOptions, LoadTestRecorder, runLoadTest } from './loadtest/loadtest';
export * from './paths';
export type { RunContext, RunOutcome, RunSettings } from './runner/run-request';
export {
  authChain,
  effectiveAuth,
  prepareForDisplay,
  runRequest,
  variableScopeFor,
} from './runner/run-request';
export { runScript, type ScriptInput, type ScriptOutput } from './scripts/sandbox';
export { VariableState } from './scripts/variable-state';
export { createSecretStore, keyringMasterKey } from './secrets/keyring';
export * from './secrets/secret-store';
export * from './settings';
export * from './shared';
export * from './storage/layout';
export { type FolderInspection, inspectFolder, prepareProjectFolder } from './storage/project';
export type { WorkspaceWatcher } from './storage/watcher';
export { watchWorkspace } from './storage/watcher';
export type { ImportedChild, ImportedCollection, OpenWorkspaceOptions } from './storage/workspace-store';
export { relativeToWorkspace, WorkspaceError, WorkspaceStore } from './storage/workspace-store';
export { Trash, type TrashEntry } from './trash/trash';
export { readJson, readJsonIfExists, stringifyJson, writeFileAtomic, writeJsonAtomic } from './util/fs';
export { newId } from './util/ids';
export { Mutex } from './util/mutex';
export { persistVariables, viewVariables, withSecretValues } from './variables/persist';
