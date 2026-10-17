import { parse as parseYaml } from 'yaml';
import type { WorkspaceStore } from '../storage/workspace-store';
import { convertOpenApi, detectOpenApi } from './openapi';
import {
  convertCollection,
  convertEnvironment,
  convertGlobals,
  detectPostmanFile,
  type ImportCounts,
  type ImportWarning,
  type PostmanFileKind,
  sensitiveVariableKeys,
} from './postman';

export interface ImportFileInput {
  fileName: string;
  content: string;
}

/** Tipos de arquivo aceitos: exportações do Postman e documentos OpenAPI/Swagger. */
export type ImportFileKind = PostmanFileKind | 'openapi';

export interface ImportPreview {
  fileName: string;
  kind: ImportFileKind;
  name: string;
  /** Postman: "2.1"/"2.0"; OpenAPI: "3.0", "3.1" ou "2.0" (Swagger). */
  version?: string | undefined;
  counts: ImportCounts;
  /** Variáveis "comuns" com nome de segredo (sugestão: marcar como secretas). */
  sensitiveKeys: string[];
  error?: string | undefined;
}

export interface ImportResultItem {
  fileName: string;
  kind: ImportFileKind;
  name: string;
  /** Id criado (coleção/ambiente). */
  id?: string | undefined;
  counts: ImportCounts;
  warnings: ImportWarning[];
  error?: string | undefined;
}

export interface ImportReport {
  items: ImportResultItem[];
}

export interface ImportOptions {
  /** Por arquivo: variáveis que devem virar secretas. */
  secretKeys?: Record<string, string[]>;
}

const EMPTY_COUNTS: ImportCounts = { folders: 0, requests: 0, examples: 0, variables: 0, secrets: 0 };

function parse(file: ImportFileInput): unknown {
  const text = file.content.charCodeAt(0) === 0xfeff ? file.content.slice(1) : file.content;
  try {
    return JSON.parse(text);
  } catch (error) {
    // Documentos OpenAPI costumam vir em YAML.
    if (/.ya?ml$/i.test(file.fileName) || !/^s*[[{]/.test(text)) {
      try {
        return parseYaml(text, { maxAliasCount: 1000 });
      } catch (yamlError) {
        throw new Error(
          `Arquivo inválido (nem JSON nem YAML): ${yamlError instanceof Error ? yamlError.message : String(yamlError)}`,
        );
      }
    }
    throw new Error(`JSON inválido: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Analisa os arquivos sem gravar nada (para o usuário revisar antes de importar). */
export function previewPostmanFiles(files: readonly ImportFileInput[]): ImportPreview[] {
  return files.map((file): ImportPreview => {
    try {
      const json = parse(file);
      const openapi = detectOpenApi(json);
      if (openapi) {
        return {
          fileName: file.fileName,
          kind: 'openapi',
          name: openapi.title,
          version: openapi.version,
          counts: convertOpenApi(json).counts,
          // Variáveis de auth já vêm como secretas.
          sensitiveKeys: [],
        };
      }
      const detected = detectPostmanFile(json);
      const base = {
        fileName: file.fileName,
        kind: detected.kind,
        name: detected.name ?? file.fileName,
        version: detected.version,
      };
      switch (detected.kind) {
        case 'collection':
          return {
            ...base,
            counts: convertCollection(json).counts,
            sensitiveKeys: sensitiveVariableKeys(json),
          };
        case 'environment':
          return {
            ...base,
            counts: convertEnvironment(json).counts,
            sensitiveKeys: sensitiveVariableKeys(json),
          };
        case 'globals':
          return { ...base, counts: convertGlobals(json).counts, sensitiveKeys: sensitiveVariableKeys(json) };
        default:
          return {
            ...base,
            counts: EMPTY_COUNTS,
            sensitiveKeys: [],
            error:
              'Formato não reconhecido. Use uma exportação do Postman (coleção v2.1, ambiente ou globais) ou um documento OpenAPI 3 / Swagger 2.0.',
          };
      }
    } catch (error) {
      return {
        fileName: file.fileName,
        kind: 'unknown',
        name: file.fileName,
        counts: EMPTY_COUNTS,
        sensitiveKeys: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

/** Importa coleções, ambientes e globais do Postman para o workspace. */
export async function importPostmanFiles(
  store: WorkspaceStore,
  files: readonly ImportFileInput[],
  options: ImportOptions = {},
): Promise<ImportReport> {
  const items: ImportResultItem[] = [];
  for (const file of files) {
    const secretKeys = new Set(options.secretKeys?.[file.fileName] ?? []);
    try {
      const json = parse(file);
      if (detectOpenApi(json)) {
        const { collection, warnings, counts } = convertOpenApi(json);
        const id = await store.importCollection(collection);
        items.push({ fileName: file.fileName, kind: 'openapi', name: collection.name, id, counts, warnings });
        continue;
      }
      const detected = detectPostmanFile(json);
      switch (detected.kind) {
        case 'collection': {
          const { collection, warnings, counts } = convertCollection(json, { secretKeys });
          const id = await store.importCollection(collection);
          items.push({
            fileName: file.fileName,
            kind: 'collection',
            name: collection.name,
            id,
            counts,
            warnings,
          });
          break;
        }
        case 'environment': {
          const { name, variables, warnings, counts } = convertEnvironment(json, { secretKeys });
          const id = await store.createEnvironment(name, variables);
          items.push({ fileName: file.fileName, kind: 'environment', name, id, counts, warnings });
          break;
        }
        case 'globals': {
          const { variables, warnings, counts } = convertGlobals(json, { secretKeys });
          await store.mergeGlobals(variables);
          items.push({
            fileName: file.fileName,
            kind: 'globals',
            name: 'Variáveis globais',
            counts,
            warnings,
          });
          break;
        }
        default:
          items.push({
            fileName: file.fileName,
            kind: 'unknown',
            name: file.fileName,
            counts: EMPTY_COUNTS,
            warnings: [],
            error: 'Formato não reconhecido.',
          });
      }
    } catch (error) {
      items.push({
        fileName: file.fileName,
        kind: 'unknown',
        name: file.fileName,
        counts: EMPTY_COUNTS,
        warnings: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { items };
}
