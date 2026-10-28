/**
 * Templates no padrão do Postman: `{{nome}}`. Funções puras, usadas tanto no
 * processo principal (envio) quanto no renderer (destaque e tooltip).
 */

import { generateDynamic } from './dynamic';

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

  constructor(
    private readonly layers: readonly ScopeLayer[],
    private readonly dynamic: (key: string) => ResolvedVariable | undefined = dynamicVariable,
  ) {
    const sorted = [...layers].sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]);
    for (const layer of sorted) {
      for (const v of layer.variables) {
        if (v.enabled === false || v.key === '') continue;
        this.map.set(v.key, { key: v.key, value: v.value, source: layer.source, secret: v.secret ?? false });
      }
    }
  }

  get(key: string): ResolvedVariable | undefined {
    return this.map.get(key) ?? this.dynamic(key);
  }

  /**
   * Dois escopos para preparar a mesma requisição duas vezes (a enviada e a
   * mascarada, que vai para a tela e o histórico): o primeiro gera as
   * variáveis dinâmicas e o segundo repete os mesmos valores, na ordem. Sem
   * isso, cada preparo sortearia outro {{$cpf}} e a tela mostraria um valor
   * que não foi enviado.
   */
  pairForReplay(): [VariableScope, VariableScope] {
    const generated: ResolvedVariable[] = [];
    let next = 0;
    const record = new VariableScope(this.layers, (key) => {
      const value = this.dynamic(key);
      if (value) generated.push(value);
      return value;
    });
    const replay = new VariableScope(this.layers, (key) => {
      // A versão mascarada não entra em variáveis secretas: pula o que só a enviada resolveu.
      const index = generated.findIndex((v, i) => i >= next && v.key === key);
      if (index < 0) return this.dynamic(key);
      next = index + 1;
      return generated[index];
    });
    return [record, replay];
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
// Variáveis dinâmicas ({{$cpf}}, {{$guid}}...): catálogo em dynamic.ts

function dynamicVariable(key: string): ResolvedVariable | undefined {
  const value = generateDynamic(key);
  if (value === undefined) return undefined;
  return { key, value, source: 'dynamic', secret: false };
}
