/**
 * Layout dos arquivos de um workspace:
 *
 * <workspace>/
 * ├─ rota.workspace.json
 * ├─ globals.json
 * ├─ environments/<slug>.env.json
 * └─ collections/<slug>/
 *    ├─ _collection.json
 *    ├─ <pasta>/_folder.json
 *    ├─ <slug>.req.json
 *    └─ <slug>.examples/<slug>.json
 */
export const MANIFEST_FILE = 'rota.workspace.json';
export const GLOBALS_FILE = 'globals.json';
export const ENVIRONMENTS_DIR = 'environments';
export const ENVIRONMENT_EXT = '.env.json';
export const COLLECTIONS_DIR = 'collections';
export const COLLECTION_FILE = '_collection.json';
export const FOLDER_FILE = '_folder.json';
export const REQUEST_EXT = '.req.json';
export const EXAMPLES_SUFFIX = '.examples';
export const EXAMPLE_EXT = '.json';

/** Nome-base do arquivo, sem a extensão composta (ex.: "login.req.json" -> "login"). */
export function stem(fileName: string, ext: string): string {
  return fileName.slice(0, fileName.length - ext.length);
}
