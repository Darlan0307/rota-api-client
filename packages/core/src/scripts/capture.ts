import { jsAccessor } from '../util/json-path';

/**
 * "Salvar em variável": gera a linha do script pós-resposta que guarda um campo
 * da resposta numa variável a cada envio.
 */

export type CaptureScope = 'environment' | 'collection' | 'globals';

const SCOPE_API: Record<CaptureScope, string> = {
  environment: 'pm.environment',
  collection: 'pm.collectionVariables',
  globals: 'pm.globals',
};

/**
 * Só captura em respostas de sucesso: um 401/500 costuma ter outro formato e
 * quebraria a linha (e as seguintes do script), além de apagar o valor bom.
 */
const SUCCESS_GUARD = 'if (pm.response.code < 400) ';

export function captureLine(scope: CaptureScope, name: string, path: readonly (string | number)[]): string {
  return `${SUCCESS_GUARD}${SCOPE_API[scope]}.set(${JSON.stringify(name)}, pm.response.json()${jsAccessor(path)});`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Inclui a linha no script. Se o script já guarda essa variável (em qualquer
 * escopo), a linha antiga é substituída em vez de duplicada.
 */
export function upsertCaptureLine(script: string, name: string, line: string): string {
  const existing = new RegExp(
    `^[ \\t]*(?:${escapeRegExp(SUCCESS_GUARD)})?pm\\.(?:environment|collectionVariables|globals|variables)\\.set\\(\\s*(["'\`])${escapeRegExp(name)}\\1.*$`,
    'm',
  );
  if (existing.test(script)) return script.replace(existing, line);
  const trimmed = script.replace(/\s+$/, '');
  return trimmed === '' ? line : `${trimmed}\n${line}`;
}
