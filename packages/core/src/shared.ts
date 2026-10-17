/**
 * Ponto de entrada sem dependências de Node: pode ser importado pelo renderer
 * (navegador). Tudo que lê disco, rede ou usa `node:*` fica em `index.ts`.
 */

export { CODEGEN_LABELS, CODEGEN_TARGETS, type CodegenTarget } from './codegen/codegen';
export { type CurlParseResult, looksLikeCurl, parseCurl } from './curl/parse-curl';
export type { HistoryEntry, HistorySummary } from './history/history-store';
export * from './http/auth';
export type {
  HttpErrorCode,
  HttpResponse,
  ProxySettings,
  ResponseBody,
  ResponseTimings,
} from './http/execute';
export type { PreparedBody, PreparedRequest } from './http/prepare';
export * from './http/url';
export type { ImportPreview, ImportReport, ImportResultItem } from './import/import-postman';
export type { ImportCounts, ImportWarning, PostmanFileKind } from './import/postman';
export * from './loadtest/config';
export * from './model/schemas';
export * from './model/tree';
export type {
  RunConsoleEntry,
  RunError,
  RunResult,
  RunScriptError,
  RunTest,
  ScriptOrigin,
} from './runner/run-request';
export type { ConsoleEntry, TestResult, TestStatus } from './scripts/sandbox';
export * from './search/search';
export type { AppSettings } from './settings';
export type { FolderInspection } from './storage/project';
export type { ItemKind, VariableTarget } from './storage/workspace-store';
export type { TrashEntry } from './trash/trash';
export { contrastRatio, relativeLuminance, WCAG } from './util/contrast';
export * from './util/diff';
export { slugify, uniqueSlug } from './util/slug';
export type { VariableInput } from './variables/persist';
export * from './variables/template';
