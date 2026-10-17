import {
  collectionOf,
  resolveTemplate,
  type ScopeLayer,
  SECRET_MASK,
  VariableScope,
  type VariableSource,
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

export function useVariableScope(): { scope: VariableScope; labels: Record<string, string> } {
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
      dynamic: 'Dinâmica (gerada no envio)',
    };
    return { scope: new VariableScope(layers), labels };
  }, [snapshot, envId, itemId]);
}

export function useVariableResolver(): (name: string) => VariableInfo | undefined {
  const { scope, labels } = useVariableScope();
  return useCallback(
    (name: string) => {
      const v = scope.get(name);
      if (!v) return undefined;
      const display =
        v.source === 'dynamic' ? `{{${name}}}` : resolveTemplate(v.value, scope, { maskSecrets: true });
      return {
        name,
        display: v.secret ? (v.value === '' ? '(sem valor salvo)' : SECRET_MASK) : display,
        source: v.source,
        sourceLabel: labels[v.source] ?? v.source,
        secret: v.secret,
      };
    },
    [scope, labels],
  );
}

/** Nomes disponíveis para autocompletar. */
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
