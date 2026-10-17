/**
 * Detecção de quebra de contrato: compara a ESTRUTURA de duas respostas JSON
 * (campos e tipos), ignorando os valores. Usada para avisar quando a API
 * passa a responder diferente do exemplo salvo.
 */

export type ShapeType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

export interface Shape {
  /** Tipos vistos neste ponto (mais de um quando os itens de um array variam). */
  types: ShapeType[];
  /** Campos de objeto e se aparecem em todos os objetos observados. */
  fields?: Record<string, { shape: Shape; optional: boolean }>;
  /** Forma dos itens, para arrays com pelo menos um item. */
  items?: Shape;
}

export type ContractIssueKind =
  /** Campo do exemplo que não veio na resposta. */
  | 'removed'
  /** Campo com tipo diferente do exemplo. */
  | 'type'
  /** Campo novo, que não existia no exemplo (não quebra, só informa). */
  | 'added';

export interface ContractIssue {
  kind: ContractIssueKind;
  /** Caminho do campo, ex.: "users[].email". "" = raiz. */
  path: string;
  expected?: string;
  actual?: string;
}

export interface ContractReport {
  /** Mudanças que tendem a quebrar quem consome a API (removidos e tipos). */
  breaking: ContractIssue[];
  /** Campos novos. */
  added: ContractIssue[];
}

const MAX_DEPTH = 32;
/** Para arrays enormes, basta amostrar os primeiros itens. */
const MAX_ARRAY_SAMPLE = 200;

function typeOf(value: unknown): ShapeType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  return 'object';
}

/** Estrutura de um valor JSON. */
export function inferShape(value: unknown, depth = 0): Shape {
  const type = typeOf(value);
  const shape: Shape = { types: [type] };
  if (depth >= MAX_DEPTH) return shape;
  if (type === 'object') {
    shape.fields = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      shape.fields[key] = { shape: inferShape(child, depth + 1), optional: false };
    }
  } else if (type === 'array') {
    const items = (value as unknown[]).slice(0, MAX_ARRAY_SAMPLE);
    if (items.length > 0) shape.items = items.map((i) => inferShape(i, depth + 1)).reduce(mergeShapes);
  }
  return shape;
}

/** Une duas estruturas (ex.: itens de um array com campos que nem sempre aparecem). */
export function mergeShapes(a: Shape, b: Shape): Shape {
  const merged: Shape = { types: [...new Set([...a.types, ...b.types])] };
  if (a.fields || b.fields) {
    const fields: NonNullable<Shape['fields']> = {};
    const keys = new Set([...Object.keys(a.fields ?? {}), ...Object.keys(b.fields ?? {})]);
    const bothObjects = a.fields !== undefined && b.fields !== undefined;
    for (const key of keys) {
      const fa = a.fields?.[key];
      const fb = b.fields?.[key];
      if (fa && fb)
        fields[key] = { shape: mergeShapes(fa.shape, fb.shape), optional: fa.optional || fb.optional };
      else {
        const only = (fa ?? fb) as { shape: Shape; optional: boolean };
        // Campo presente em só um dos objetos: opcional.
        fields[key] = { shape: only.shape, optional: bothObjects || only.optional };
      }
    }
    merged.fields = fields;
  }
  if (a.items && b.items) merged.items = mergeShapes(a.items, b.items);
  else if (a.items) merged.items = a.items;
  else if (b.items) merged.items = b.items;
  return merged;
}

function describe(shape: Shape): string {
  return shape.types.join(' | ');
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

/**
 * Compara a resposta (`actual`) com o exemplo (`expected`). `null` onde o
 * exemplo tinha outro tipo não conta como quebra se o exemplo já aceitava null.
 */
export function compareShapes(expected: Shape, actual: Shape): ContractReport {
  const breaking: ContractIssue[] = [];
  const added: ContractIssue[] = [];

  const walk = (exp: Shape, act: Shape, path: string) => {
    const unexpected = act.types.filter((t) => !exp.types.includes(t));
    if (unexpected.length > 0) {
      breaking.push({ kind: 'type', path, expected: describe(exp), actual: describe(act) });
      return;
    }
    if (exp.fields && act.fields) {
      for (const [key, field] of Object.entries(exp.fields)) {
        const other = act.fields[key];
        if (!other) {
          if (!field.optional)
            breaking.push({ kind: 'removed', path: join(path, key), expected: describe(field.shape) });
          continue;
        }
        walk(field.shape, other.shape, join(path, key));
      }
      for (const [key, field] of Object.entries(act.fields)) {
        if (!(key in exp.fields))
          added.push({ kind: 'added', path: join(path, key), actual: describe(field.shape) });
      }
    }
    if (exp.items && act.items) walk(exp.items, act.items, `${path}[]`);
  };

  walk(expected, actual, '');
  return { breaking, added };
}

/** Lê JSON sem lançar (undefined se não for JSON). */
export function tryParseJson(text: string): { value: unknown } | undefined {
  const trimmed = text.trim();
  if (!trimmed || !/^[[{"\d\-tfn]/.test(trimmed)) return undefined;
  try {
    return { value: JSON.parse(trimmed) };
  } catch {
    return undefined;
  }
}

/** Compara dois corpos de resposta JSON; undefined se algum não for JSON. */
export function compareJsonBodies(expectedBody: string, actualBody: string): ContractReport | undefined {
  const expected = tryParseJson(expectedBody);
  const actual = tryParseJson(actualBody);
  if (!expected || !actual) return undefined;
  return compareShapes(inferShape(expected.value), inferShape(actual.value));
}

/** Frase curta em português para um problema de contrato. */
export function describeContractIssue(issue: ContractIssue): string {
  const where = issue.path === '' ? 'A resposta' : `O campo "${issue.path}"`;
  switch (issue.kind) {
    case 'removed':
      return `${where} não veio na resposta (era ${issue.expected}).`;
    case 'type':
      return `${where} mudou de tipo: era ${issue.expected}, veio ${issue.actual}.`;
    case 'added':
      return `${where} é novo (${issue.actual}).`;
  }
}
