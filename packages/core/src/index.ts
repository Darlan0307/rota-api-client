/** Ponto de entrada completo (Node): app (processo principal) e servidor MCP. */

export type { ExecuteOptions } from './http/execute';
export { executeRequest, HttpError, isBypassed } from './http/execute';
export type { PrepareOptions } from './http/prepare';
export { findHeader, prepareRequest } from './http/prepare';
export * from './paths';
export type { RunContext, RunOutcome, RunSettings } from './runner/run-request';
export { authChain, effectiveAuth, runRequest, variableScopeFor } from './runner/run-request';
export { createSecretStore, keyringMasterKey } from './secrets/keyring';
export * from './secrets/secret-store';
export * from './settings';
export * from './shared';
export * from './storage/layout';
export type { WorkspaceWatcher } from './storage/watcher';
export { watchWorkspace } from './storage/watcher';
export type { OpenWorkspaceOptions } from './storage/workspace-store';
export { relativeToWorkspace, WorkspaceError, WorkspaceStore } from './storage/workspace-store';
export { readJson, readJsonIfExists, stringifyJson, writeFileAtomic, writeJsonAtomic } from './util/fs';
export { newId } from './util/ids';
export { Mutex } from './util/mutex';
export { persistVariables, viewVariables, withSecretValues } from './variables/persist';
