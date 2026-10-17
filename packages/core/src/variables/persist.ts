import type { Variable, VariableType } from '../model/schemas';
import type { VariableView } from '../model/tree';
import type { SecretScope, SecretStore } from '../secrets/secret-store';

/**
 * Variável como editada na UI/MCP. Para `secret`, `value` ausente significa
 * "manter o valor salvo" — assim o valor nunca precisa voltar para a interface.
 */
export interface VariableInput {
  key: string;
  type: VariableType;
  enabled: boolean;
  description?: string | undefined;
  value?: string | undefined;
  /** Nome anterior, quando a variável foi renomeada (para migrar o segredo). */
  previousKey?: string | undefined;
}

/**
 * Converte a lista editada para o formato do arquivo, gravando/movendo/apagando
 * os valores secretos no SecretStore. Valores secretos nunca vão para o arquivo.
 */
export function persistVariables(
  inputs: readonly VariableInput[],
  previous: readonly Variable[],
  scope: SecretScope,
  secrets: SecretStore,
): Variable[] {
  const prevByKey = new Map(previous.map((v) => [v.key, v]));
  const keptSecretKeys = new Set<string>();
  const result: Variable[] = [];

  for (const input of inputs) {
    if (input.key.trim() === '') continue;
    const sourceKey = input.previousKey ?? input.key;
    const prev = prevByKey.get(sourceKey);
    const base = {
      key: input.key,
      type: input.type,
      enabled: input.enabled,
      ...(input.description ? { description: input.description } : {}),
    };

    if (input.type === 'secret') {
      if (input.value !== undefined) {
        secrets.set(scope, input.key, input.value);
      } else if (prev?.type === 'secret' && sourceKey !== input.key) {
        secrets.rename(scope, sourceKey, input.key);
      } else if (prev && prev.type !== 'secret' && prev.value !== undefined) {
        // Passou de "default" para "secret": o valor sai do arquivo.
        secrets.set(scope, input.key, prev.value);
      }
      keptSecretKeys.add(input.key);
      result.push(base);
      continue;
    }

    let value = input.value;
    if (value === undefined && prev?.type === 'secret') {
      // Passou de "secret" para "default": o valor volta para o arquivo.
      value = secrets.get(scope, sourceKey) ?? '';
    }
    result.push({ ...base, value: value ?? prev?.value ?? '' });
  }

  // Apaga segredos de variáveis removidas ou que deixaram de ser secretas.
  for (const prev of previous) {
    if (prev.type === 'secret' && !keptSecretKeys.has(prev.key)) {
      const renamedAway = inputs.some((i) => i.previousKey === prev.key && i.type === 'secret');
      if (!renamedAway) secrets.delete(scope, prev.key);
    }
  }
  return result;
}

/** Visão para a UI: secrets sem valor, com indicação de valor salvo. */
export function viewVariables(
  variables: readonly Variable[],
  scope: SecretScope,
  secrets: SecretStore,
): VariableView[] {
  return variables.map((v) =>
    v.type === 'secret'
      ? { ...stripValue(v), hasValue: secrets.has(scope, v.key) }
      : { ...v, value: v.value ?? '' },
  );
}

function stripValue(v: Variable): Variable {
  const { value: _value, ...rest } = v;
  return rest;
}

/** Variáveis com os valores secretos preenchidos (só para execução, nunca para exibição). */
export function withSecretValues(
  variables: readonly Variable[],
  scope: SecretScope,
  secrets: SecretStore,
): { key: string; value: string; secret: boolean; enabled: boolean }[] {
  return variables.map((v) => ({
    key: v.key,
    value: v.type === 'secret' ? (secrets.get(scope, v.key) ?? '') : (v.value ?? ''),
    secret: v.type === 'secret',
    enabled: v.enabled,
  }));
}
