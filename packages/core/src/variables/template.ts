/**
 * Templates no padrão do Postman: `{{nome}}`. Funções puras, usadas tanto no
 * processo principal (envio) quanto no renderer (destaque e tooltip).
 */

export const SECRET_MASK = '••••••';

const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export interface VariableRef {
  name: string;
  /** Índice do primeiro "{". */
  start: number;
  /** Índice logo após o último "}". */
  end: number;
}

export function findVariableRefs(text: string): VariableRef[] {
  const refs: VariableRef[] = [];
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const name = match[1];
    if (name === undefined || match.index === undefined) continue;
    refs.push({ name, start: match.index, end: match.index + match[0].length });
  }
  return refs;
}

/** Referência de variável que contém a posição `index` (para tooltip/hover). */
export function variableRefAt(text: string, index: number): VariableRef | undefined {
  return findVariableRefs(text).find((ref) => index >= ref.start && index < ref.end);
}

export type VariableSource = 'global' | 'collection' | 'environment' | 'local' | 'dynamic';

export interface ScopeVariable {
  key: string;
  value: string;
  secret?: boolean;
  enabled?: boolean;
}

export interface ScopeLayer {
  source: Exclude<VariableSource, 'dynamic'>;
  variables: readonly ScopeVariable[];
}

export interface ResolvedVariable {
  key: string;
  value: string;
  source: VariableSource;
  secret: boolean;
}

/**
 * Prioridade igual à do Postman: global < coleção < ambiente < local.
 * As camadas são informadas da menor para a maior prioridade.
 */
export const SOURCE_PRIORITY: Record<Exclude<VariableSource, 'dynamic'>, number> = {
  global: 0,
  collection: 1,
  environment: 2,
  local: 3,
};

export class VariableScope {
  private readonly map = new Map<string, ResolvedVariable>();

  constructor(layers: readonly ScopeLayer[]) {
    const sorted = [...layers].sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]);
    for (const layer of sorted) {
      for (const v of layer.variables) {
        if (v.enabled === false || v.key === '') continue;
        this.map.set(v.key, { key: v.key, value: v.value, source: layer.source, secret: v.secret ?? false });
      }
    }
  }

  get(key: string): ResolvedVariable | undefined {
    return this.map.get(key) ?? dynamicVariable(key);
  }

  entries(): ResolvedVariable[] {
    return [...this.map.values()];
  }

  /** Valores de todas as variáveis secretas visíveis neste escopo. */
  secretValues(): string[] {
    return this.entries()
      .filter((v) => v.secret && v.value !== '')
      .map((v) => v.value);
  }
}

export interface ResolveOptions {
  /** Substitui valores secretos por •••••• (para exibir ou entregar ao MCP). */
  maskSecrets?: boolean;
  /** Profundidade máxima para variáveis que referenciam outras. */
  maxDepth?: number;
}

/**
 * Substitui `{{nome}}` pelos valores do escopo, recursivamente (variáveis
 * podem conter outras). Referências desconhecidas são mantidas como estão.
 */
export function resolveTemplate(text: string, scope: VariableScope, options: ResolveOptions = {}): string {
  const maxDepth = options.maxDepth ?? 10;

  function resolve(input: string, depth: number): string {
    if (depth > maxDepth || !input.includes('{{')) return input;
    return input.replace(VARIABLE_PATTERN, (whole, rawName: string) => {
      const variable = scope.get(rawName.trim());
      if (!variable) return whole;
      if (variable.secret && options.maskSecrets) return SECRET_MASK;
      return resolve(variable.value, depth + 1);
    });
  }

  return resolve(text, 0);
}

/** Referências que não existem em nenhum escopo (para avisos na UI). */
export function unresolvedRefs(text: string, scope: VariableScope): VariableRef[] {
  return findVariableRefs(text).filter((ref) => !scope.get(ref.name));
}

/**
 * Mascara ocorrências literais de valores secretos num texto (respostas,
 * histórico, saída de scripts entregue ao MCP). Valores muito curtos são
 * ignorados para não mascarar trechos aleatórios.
 */
export function maskSecretValues(text: string, secretValues: readonly string[]): string {
  let result = text;
  const values = [...new Set(secretValues)].filter((v) => v.length >= 4).sort((a, b) => b.length - a.length);
  for (const value of values) result = result.split(value).join(SECRET_MASK);
  return result;
}

// ---------------------------------------------------------------------------
// Variáveis dinâmicas do Postman (subconjunto mais usado)

const DYNAMIC: Record<string, () => string> = {
  $guid: () => crypto.randomUUID(),
  $randomUUID: () => crypto.randomUUID(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(Math.floor(Math.random() * 1001)),
};

export const DYNAMIC_VARIABLE_NAMES = Object.keys(DYNAMIC);

function dynamicVariable(key: string): ResolvedVariable | undefined {
  const generate = DYNAMIC[key];
  if (!generate) return undefined;
  return { key, value: generate(), source: 'dynamic', secret: false };
}
