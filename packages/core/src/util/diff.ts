import type { Auth, Body, KeyValue, RequestData, Variable } from '../model/schemas';

/** Uma linha de diff: igual, removida (só no "antes") ou adicionada (só no "depois"). */
export interface DiffLine {
  type: 'same' | 'removed' | 'added';
  text: string;
}

/**
 * Diff de linhas (LCS). Suficiente para bodies e scripts; para textos enormes
 * cai para um diff simplificado (tudo removido/adicionado) para não travar a UI.
 */
export function diffLines(before: string, after: string, maxCells = 4_000_000): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > maxCells) {
    return [
      ...a.map((text) => ({ type: 'removed' as const, text })),
      ...b.map((text) => ({ type: 'added' as const, text })),
    ];
  }

  const rows = a.length + 1;
  const cols = b.length + 1;
  const lcs = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * cols + j] =
        a[i] === b[j]
          ? (lcs[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * cols + j] ?? 0, lcs[i * cols + j + 1] ?? 0);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ type: 'same', text: a[i] ?? '' });
      i++;
      j++;
    } else if ((lcs[(i + 1) * cols + j] ?? 0) >= (lcs[i * cols + j + 1] ?? 0)) {
      result.push({ type: 'removed', text: a[i++] ?? '' });
    } else {
      result.push({ type: 'added', text: b[j++] ?? '' });
    }
  }
  while (i < a.length) result.push({ type: 'removed', text: a[i++] ?? '' });
  while (j < b.length) result.push({ type: 'added', text: b[j++] ?? '' });
  return result;
}

/** Uma mudança legível para o usuário ("URL: a → b"). */
export interface FieldChange {
  field: string;
  before?: string | undefined;
  after?: string | undefined;
  /** Para textos longos (body, scripts): diff de linhas. */
  lines?: DiffLine[] | undefined;
}

const AUTH_LABEL: Record<Auth['type'], string> = {
  inherit: 'Herdar',
  none: 'Sem autenticação',
  bearer: 'Bearer Token',
  basic: 'Basic',
  apikey: 'API Key',
};

export function describeAuth(auth: Auth): string {
  switch (auth.type) {
    case 'bearer':
      return `Bearer ${auth.token}`;
    case 'basic':
      return `Basic (${auth.username})`;
    case 'apikey':
      return `API Key ${auth.key} (${auth.in === 'header' ? 'header' : 'query'})`;
    default:
      return AUTH_LABEL[auth.type];
  }
}

function describeBodyMode(body: Body): string {
  return {
    none: 'Nenhum',
    json: 'JSON',
    raw: 'Raw',
    urlencoded: 'x-www-form-urlencoded',
    formdata: 'form-data',
  }[body.mode];
}

function bodyText(body: Body): string {
  switch (body.mode) {
    case 'json':
    case 'raw':
      return body.text;
    case 'urlencoded':
    case 'formdata':
      return body.fields.map((f) => `${f.enabled ? '' : '# '}${f.key}: ${f.value}`).join('\n');
    case 'none':
      return '';
  }
}

/** Compara listas chave/valor e descreve inclusões, remoções e alterações. */
export function diffKeyValues(
  label: string,
  before: readonly KeyValue[],
  after: readonly KeyValue[],
): FieldChange[] {
  const changes: FieldChange[] = [];
  const fmt = (kv: KeyValue) => `${kv.value}${kv.enabled ? '' : ' (desabilitado)'}`;
  const beforeMap = new Map(before.map((kv) => [kv.key, kv]));
  const afterMap = new Map(after.map((kv) => [kv.key, kv]));
  for (const [key, kv] of afterMap) {
    const old = beforeMap.get(key);
    if (!old) changes.push({ field: `${label} "${key}" adicionado`, after: fmt(kv) });
    else if (fmt(old) !== fmt(kv))
      changes.push({ field: `${label} "${key}"`, before: fmt(old), after: fmt(kv) });
  }
  for (const [key, kv] of beforeMap) {
    if (!afterMap.has(key)) changes.push({ field: `${label} "${key}" removido`, before: fmt(kv) });
  }
  const sameKeys = before.length === after.length && before.every((kv, i) => kv.key === after[i]?.key);
  if (changes.length === 0 && !sameKeys) changes.push({ field: `${label}: ordem alterada` });
  return changes;
}

/** Descreve, campo a campo, o que mudou entre duas versões de uma requisição. */
export function diffRequestData(before: RequestData, after: RequestData): FieldChange[] {
  const changes: FieldChange[] = [];
  if (before.method !== after.method)
    changes.push({ field: 'Método', before: before.method, after: after.method });
  if (before.url !== after.url) changes.push({ field: 'URL', before: before.url, after: after.url });
  changes.push(...diffKeyValues('Parâmetro', before.query, after.query));
  changes.push(...diffKeyValues('Header', before.headers, after.headers));

  if (JSON.stringify(before.auth) !== JSON.stringify(after.auth)) {
    changes.push({
      field: 'Autenticação',
      before: describeAuth(before.auth),
      after: describeAuth(after.auth),
    });
  }

  if (before.body.mode !== after.body.mode) {
    changes.push({
      field: 'Tipo do body',
      before: describeBodyMode(before.body),
      after: describeBodyMode(after.body),
    });
  }
  const [bb, ab] = [bodyText(before.body), bodyText(after.body)];
  if (bb !== ab) changes.push({ field: 'Body', lines: diffLines(bb, ab) });

  for (const [key, label] of [
    ['preRequest', 'Script de pré-requisição'],
    ['postResponse', 'Script de pós-resposta'],
  ] as const) {
    if (before.scripts[key] !== after.scripts[key]) {
      changes.push({ field: label, lines: diffLines(before.scripts[key], after.scripts[key]) });
    }
  }

  const s1 = before.settings;
  const s2 = after.settings;
  if (s1.timeoutMs !== s2.timeoutMs) {
    changes.push({
      field: 'Timeout',
      before: String(s1.timeoutMs ?? 'padrão'),
      after: String(s2.timeoutMs ?? 'padrão'),
    });
  }
  if (s1.followRedirects !== s2.followRedirects) {
    changes.push({
      field: 'Seguir redirecionamentos',
      before: yesNo(s1.followRedirects),
      after: yesNo(s2.followRedirects),
    });
  }
  if (s1.verifySsl !== s2.verifySsl) {
    changes.push({ field: 'Verificar SSL', before: yesNo(s1.verifySsl), after: yesNo(s2.verifySsl) });
  }
  if ((before.description ?? '') !== (after.description ?? '')) {
    changes.push({ field: 'Descrição', lines: diffLines(before.description ?? '', after.description ?? '') });
  }
  return changes;
}

/** Diferenças entre listas de variáveis (valores secretos nunca são exibidos). */
export function diffVariables(before: readonly Variable[], after: readonly Variable[]): FieldChange[] {
  const fmt = (v: Variable) =>
    `${v.type === 'secret' ? '•••••• (secreta)' : (v.value ?? '')}${v.enabled ? '' : ' (desabilitada)'}`;
  const changes: FieldChange[] = [];
  const beforeMap = new Map(before.map((v) => [v.key, v]));
  const afterMap = new Map(after.map((v) => [v.key, v]));
  for (const [key, v] of afterMap) {
    const old = beforeMap.get(key);
    if (!old) changes.push({ field: `Variável "${key}" adicionada`, after: fmt(v) });
    else if (fmt(old) !== fmt(v))
      changes.push({ field: `Variável "${key}"`, before: fmt(old), after: fmt(v) });
  }
  for (const [key, v] of beforeMap) {
    if (!afterMap.has(key)) changes.push({ field: `Variável "${key}" removida`, before: fmt(v) });
  }
  return changes;
}

function yesNo(value: boolean): string {
  return value ? 'Sim' : 'Não';
}
