/**
 * Ponto de entrada sem dependências de Node: pode ser importado pelo renderer
 * (navegador). Tudo que lê disco, rede ou usa `node:*` fica em `index.ts`.
 */

export { CODEGEN_LABELS, CODEGEN_TARGETS, type CodegenTarget } from './codegen/codegen';
export * from './contract/reference';
export * from './contract/shape';
export { type CurlParseResult, looksLikeCurl, parseCurl } from './curl/parse-curl';
export * from './export/markdown';
export * from './export/postman-export';
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
export type { ImportFileKind, ImportPreview, ImportReport, ImportResultItem } from './import/import-postman';
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
export * from './scripts/capture';
export type { ConsoleEntry, TestResult, TestStatus } from './scripts/sandbox';
export * from './search/search';
export type { AppSettings } from './settings';
export type { FolderInspection } from './storage/project';
export type { ItemKind, VariableTarget } from './storage/workspace-store';
export type { TrashEntry } from './trash/trash';
export * from './tunnel/types';
export { contrastRatio, relativeLuminance, WCAG } from './util/contrast';
export * from './util/diff';
export * from './util/json-path';
export * from './util/json-table';
export { slugify, uniqueSlug } from './util/slug';
export * from './variables/dynamic';
export type { VariableInput } from './variables/persist';
export * from './variables/template';
