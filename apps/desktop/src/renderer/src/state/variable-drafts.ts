import type { VariableInput, VariableType, VariableView } from '@rota/core/shared';
import { deepEqual } from '../lib/equal';

/** Variável em edição na UI. Valores secretos só existem aqui se revelados/digitados. */
export interface VariableDraft {
  uid: string;
  key: string;
  type: VariableType;
  enabled: boolean;
  description: string;
  /** default: o valor. secret: valor revelado/digitado, ou undefined se não carregado. */
  value: string | undefined;
  /** secret: o usuário digitou um valor novo. */
  secretDirty: boolean;
  /** secret: existe valor salvo localmente. */
  hasValue: boolean;
  /** Nome da variável na versão salva (para migrar segredos ao renomear). */
  originalKey: string | null;
}

let uidCounter = 0;
export function draftUid(): string {
  uidCounter += 1;
  return `v${Date.now().toString(36)}${uidCounter}`;
}

export function draftsFromViews(views: readonly VariableView[]): VariableDraft[] {
  return views.map((v) => ({
    uid: draftUid(),
    key: v.key,
    type: v.type,
    enabled: v.enabled,
    description: v.description ?? '',
    value: v.type === 'secret' ? undefined : (v.value ?? ''),
    secretDirty: false,
    hasValue: v.hasValue ?? false,
    originalKey: v.key,
  }));
}

export function emptyDraft(): VariableDraft {
  return {
    uid: draftUid(),
    key: '',
    type: 'default',
    enabled: true,
    description: '',
    value: '',
    secretDirty: false,
    hasValue: false,
    originalKey: null,
  };
}

function normalizeView(v: VariableView) {
  return {
    key: v.key,
    type: v.type,
    enabled: v.enabled,
    description: v.description ?? '',
    value: v.type === 'default' ? (v.value ?? '') : undefined,
  };
}

function normalizeDraft(d: VariableDraft) {
  return {
    key: d.key,
    type: d.type,
    enabled: d.enabled,
    description: d.description,
    value: d.type === 'default' ? (d.value ?? '') : undefined,
  };
}

/** Linhas totalmente vazias (a linha "nova" no fim da tabela) não contam. */
function meaningful(drafts: readonly VariableDraft[]): VariableDraft[] {
  return drafts.filter((d) => d.key !== '' || (d.value ?? '') !== '' || d.description !== '');
}

export function variablesDirty(drafts: readonly VariableDraft[], base: readonly VariableView[]): boolean {
  const list = meaningful(drafts);
  if (list.some((d) => d.secretDirty)) return true;
  return !deepEqual(list.map(normalizeDraft), base.map(normalizeView));
}

/** Converte para o formato que o core grava (segredo só vai se foi alterado). */
export function draftsToInputs(
  drafts: readonly VariableDraft[],
  base: readonly VariableView[],
): VariableInput[] {
  const baseType = new Map(base.map((v) => [v.key, v.type]));
  return meaningful(drafts).map((d) => {
    const wasSecret = d.originalKey !== null && baseType.get(d.originalKey) === 'secret';
    let value: string | undefined;
    if (d.type === 'default') value = d.value;
    else if (d.secretDirty || !wasSecret) value = d.value ?? '';
    return {
      key: d.key.trim(),
      type: d.type,
      enabled: d.enabled,
      description: d.description || undefined,
      value,
      previousKey: d.originalKey && d.originalKey !== d.key.trim() ? d.originalKey : undefined,
    };
  });
}
