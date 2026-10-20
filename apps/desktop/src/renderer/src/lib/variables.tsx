import {
  collectionOf,
  DYNAMIC_VARIABLES,
  findDynamicVariable,
  resolveTemplate,
  type ScopeLayer,
  SECRET_MASK,
  VariableScope,
  type VariableSource,
  type VariableTarget,
  type VariableView,
} from '@rota/core/shared';
import { createContext, type ReactNode, useCallback, useContext, useMemo } from 'react';
import { useActiveEnvironmentId, useSnapshot } from '../state/workspace';

/**
 * Resolução de variáveis no renderer (destaque e tooltip). Segredos aparecem
 * sempre como ••••••: o valor real nunca sai do processo principal.
 */

const ItemContext = createContext<string | null>(null);

/** Define o item (requisição/pasta/coleção) cujo escopo de coleção vale para os filhos. */
export function VariableContextProvider({
  itemId,
  children,
}: {
  itemId: string | null;
  children: ReactNode;
}) {
  return <ItemContext.Provider value={itemId}>{children}</ItemContext.Provider>;
}

export interface VariableInfo {
  name: string;
  /** Valor resolvido (recursivamente), com segredos mascarados. */
  display: string;
  source: VariableSource;
  sourceLabel: string;
  secret: boolean;
  /** Variáveis dinâmicas: o que é gerado. */
  description?: string;
  /** Onde a variável está definida (para editar). Ausente nas dinâmicas e locais. */
  target?: VariableTarget;
  /** Valor como foi salvo (com {{referências}}); vazio nas secretas. */
  raw: string;
}

/** Onde é possível criar uma variável a partir do item atual. */
export interface VariableTargetOption {
  target: VariableTarget;
  label: string;
}

function layer(source: ScopeLayer['source'], vars: readonly VariableView[]): ScopeLayer {
  return {
    source,
    variables: vars.map((v) => ({
      key: v.key,
      value: v.type === 'secret' ? (v.hasValue ? SECRET_MASK : '') : (v.value ?? ''),
      secret: v.type === 'secret',
      enabled: v.enabled,
    })),
  };
}

export function useVariableScope(): {
  scope: VariableScope;
  labels: Record<string, string>;
  targets: Partial<Record<VariableSource, VariableTarget>>;
} {
  const snapshot = useSnapshot();
  const envId = useActiveEnvironmentId();
  const itemId = useContext(ItemContext);

  return useMemo(() => {
    const collection = itemId ? collectionOf(snapshot, itemId) : undefined;
    const env = snapshot.environments.find((e) => e.id === envId);
    const layers: ScopeLayer[] = [layer('global', snapshot.globals)];
    if (collection) layers.push(layer('collection', collection.variables));
    if (env) layers.push(layer('environment', env.variables));
    const labels: Record<string, string> = {
      global: 'Global',
      collection: collection ? `Coleção: ${collection.name}` : 'Coleção',
      environment: env ? `Ambiente: ${env.name}` : 'Ambiente',
      local: 'Local',
      dynamic: 'Dinâmica: valor novo a cada envio',
    };
    const targets: Partial<Record<VariableSource, VariableTarget>> = { global: { kind: 'global' } };
    if (collection) targets.collection = { kind: 'collection', id: collection.id };
    if (env) targets.environment = { kind: 'environment', id: env.id };
    return { scope: new VariableScope(layers), labels, targets };
  }, [snapshot, envId, itemId]);
}

export function useVariableResolver(): (name: string) => VariableInfo | undefined {
  const { scope, labels, targets } = useVariableScope();
  return useCallback(
    (name: string) => {
      const v = scope.get(name);
      if (!v) return undefined;
      if (v.source === 'dynamic') {
        const description = findDynamicVariable(name)?.description;
        return {
          name,
          display: `ex.: ${v.value}`,
          source: v.source,
          sourceLabel: labels.dynamic ?? 'Dinâmica',
          secret: false,
          raw: '',
          ...(description ? { description } : {}),
        };
      }
      const display = resolveTemplate(v.value, scope, { maskSecrets: true });
      const target = targets[v.source];
      return {
        name,
        display: v.secret ? (v.value === '' ? '(sem valor salvo)' : SECRET_MASK) : display,
        source: v.source,
        sourceLabel: labels[v.source] ?? v.source,
        secret: v.secret,
        raw: v.secret ? '' : v.value,
        ...(target ? { target } : {}),
      };
    },
    [scope, labels, targets],
  );
}

/** Ambiente ativo, coleção do item e globais, nesta ordem (para criar uma variável). */
export function useVariableTargets(): VariableTargetOption[] {
  const { labels, targets } = useVariableScope();
  return useMemo(
    () =>
      (['environment', 'collection', 'global'] as const).flatMap((source) => {
        const target = targets[source];
        return target ? [{ target, label: labels[source] ?? source }] : [];
      }),
    [labels, targets],
  );
}

/** Variáveis dinâmicas mostradas nas sugestões (sem os nomes antigos do Postman). */
export const DYNAMIC_SUGGESTIONS = DYNAMIC_VARIABLES.filter((v) => !v.postmanAlias);

/** Nomes disponíveis para autocompletar (as dinâmicas ficam à parte, em DYNAMIC_SUGGESTIONS). */
export function useVariableNames(): string[] {
  const { scope } = useVariableScope();
  return useMemo(
    () =>
      scope
        .entries()
        .map((v) => v.key)
        .sort(),
    [scope],
  );
}
