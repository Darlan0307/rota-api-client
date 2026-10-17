import { type ScopeLayer, VariableScope } from '../variables/template';

export type ScriptScope = 'global' | 'collection' | 'environment' | 'local';

export interface VariableChange {
  scope: Exclude<ScriptScope, 'local'>;
  key: string;
  /** null = variável removida (unset). */
  value: string | null;
}

const PRIORITY: ScriptScope[] = ['local', 'environment', 'collection', 'global'];

/**
 * Variáveis vistas pelos scripts durante uma execução (pré + envio + pós).
 * Leituras e escritas acontecem em memória; as alterações em ambiente,
 * coleção e globais são devolvidas para o runner persistir no final.
 */
export class VariableState {
  private readonly values: Record<ScriptScope, Map<string, string>> = {
    global: new Map(),
    collection: new Map(),
    environment: new Map(),
    local: new Map(),
  };
  private readonly secretKeys: Record<ScriptScope, Set<string>> = {
    global: new Set(),
    collection: new Set(),
    environment: new Set(),
    local: new Set(),
  };
  private readonly changes = new Map<string, VariableChange>();

  constructor(
    layers: readonly ScopeLayer[],
    /** Escopos que existem nesta execução (sem ambiente ativo, não há "environment"). */
    readonly available: ReadonlySet<ScriptScope>,
  ) {
    for (const layer of layers) {
      for (const v of layer.variables) {
        if (v.enabled === false || !v.key) continue;
        this.values[layer.source].set(v.key, v.value);
        if (v.secret) this.secretKeys[layer.source].add(v.key);
      }
    }
  }

  get(scope: ScriptScope, key: string): string | undefined {
    return this.values[scope].get(key);
  }

  has(scope: ScriptScope, key: string): boolean {
    return this.values[scope].has(key);
  }

  set(scope: ScriptScope, key: string, value: string): void {
    this.values[scope].set(key, value);
    if (scope !== 'local') this.changes.set(`${scope}:${key}`, { scope, key, value });
  }

  unset(scope: ScriptScope, key: string): void {
    this.values[scope].delete(key);
    if (scope !== 'local') this.changes.set(`${scope}:${key}`, { scope, key, value: null });
  }

  clear(scope: ScriptScope): void {
    for (const key of [...this.values[scope].keys()]) this.unset(scope, key);
  }

  toObject(scope: ScriptScope): Record<string, string> {
    return Object.fromEntries(this.values[scope]);
  }

  /** pm.variables.get: local > ambiente > coleção > global. */
  resolve(key: string): string | undefined {
    for (const scope of PRIORITY) {
      const value = this.values[scope].get(key);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  /** Escopo de variáveis atualizado (para resolver a requisição após o pré-script). */
  scope(): VariableScope {
    const layers: ScopeLayer[] = (['global', 'collection', 'environment', 'local'] as const).map(
      (source) => ({
        source,
        variables: [...this.values[source]].map(([key, value]) => ({
          key,
          value,
          secret: this.secretKeys[source].has(key),
        })),
      }),
    );
    return new VariableScope(layers);
  }

  /** Valores atuais de variáveis secretas (inclusive os definidos pelos scripts). */
  secretValues(): string[] {
    const result: string[] = [];
    for (const scope of PRIORITY) {
      for (const key of this.secretKeys[scope]) {
        const value = this.values[scope].get(key);
        if (value) result.push(value);
      }
    }
    return result;
  }

  pendingChanges(): VariableChange[] {
    return [...this.changes.values()];
  }
}
