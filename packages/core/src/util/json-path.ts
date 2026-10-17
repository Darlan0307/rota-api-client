/**
 * Caminhos dentro de um JSON (ex.: `data.items[0].id`): descobrir qual campo
 * está sob o cursor no texto, ler o valor e gerar o acesso em JavaScript.
 */

export type JsonPath = (string | number)[];

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Acesso em JavaScript a partir da raiz: `.data.items[0]["x-y"]`. */
export function jsAccessor(path: readonly (string | number)[]): string {
  return path
    .map((part) =>
      typeof part === 'number'
        ? `[${part}]`
        : IDENTIFIER.test(part)
          ? `.${part}`
          : `[${JSON.stringify(part)}]`,
    )
    .join('');
}

/** Caminho para exibir: `data.items[0].id` (raiz = "(raiz)"). */
export function formatJsonPath(path: readonly (string | number)[]): string {
  if (path.length === 0) return '(raiz)';
  const text = jsAccessor(path);
  return text.startsWith('.') ? text.slice(1) : text;
}

export function valueAtPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value;
  for (const part of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[part];
  }
  return current;
}

/**
 * Caminho do valor mais interno que contém a posição `offset` do texto. Com o
 * cursor sobre uma chave, devolve o caminho do valor dessa chave. Devolve null
 * se o texto não for JSON ou a posição estiver fora de qualquer valor.
 */
export function jsonPathAtOffset(text: string, offset: number): JsonPath | null {
  let i = 0;
  let best: JsonPath | null = null;

  const consider = (path: JsonPath, start: number, end: number) => {
    if (offset >= start && offset <= end && (!best || path.length > best.length)) best = path;
  };
  const fail = (): never => {
    throw new SyntaxError('JSON inválido');
  };
  const skipSpace = () => {
    while (i < text.length && ' \t\n\r'.includes(text.charAt(i))) i++;
  };

  function readString(): string {
    const start = i;
    i++; // aspas de abertura
    while (i < text.length) {
      const c = text.charAt(i);
      if (c === '\\') i += 2;
      else if (c === '"') {
        i++;
        return JSON.parse(text.slice(start, i)) as string;
      } else i++;
    }
    return fail();
  }

  function readValue(path: JsonPath): void {
    skipSpace();
    const start = i;
    const c = text.charAt(i);
    if (c === '{') readObject(path);
    else if (c === '[') readArray(path);
    else if (c === '"') readString();
    else {
      while (i < text.length && !',}] \t\n\r'.includes(text.charAt(i))) i++;
      if (i === start) fail();
    }
    consider(path, start, i);
  }

  function readObject(path: JsonPath): void {
    i++;
    skipSpace();
    if (text.charAt(i) === '}') {
      i++;
      return;
    }
    while (i < text.length) {
      skipSpace();
      if (text.charAt(i) !== '"') fail();
      const keyStart = i;
      const key = readString();
      consider([...path, key], keyStart, i);
      skipSpace();
      if (text.charAt(i) !== ':') fail();
      i++;
      readValue([...path, key]);
      skipSpace();
      const next = text.charAt(i++);
      if (next === '}') return;
      if (next !== ',') fail();
    }
    fail();
  }

  function readArray(path: JsonPath): void {
    i++;
    skipSpace();
    if (text.charAt(i) === ']') {
      i++;
      return;
    }
    for (let index = 0; i < text.length; index++) {
      readValue([...path, index]);
      skipSpace();
      const next = text.charAt(i++);
      if (next === ']') return;
      if (next !== ',') fail();
    }
    fail();
  }

  try {
    readValue([]);
  } catch {
    return null;
  }
  return best;
}

/** Sugestão de nome de variável a partir do caminho: `data.user.id` → `userId`. */
export function suggestVariableName(path: readonly (string | number)[]): string {
  const keys = path
    .filter((p): p is string => typeof p === 'string')
    .map(toCamel)
    .filter(Boolean);
  const last = keys.at(-1) ?? 'valor';
  const parent = keys.at(-2);
  // Chaves genéricas ganham o nome do pai: data.pedido.id → pedidoId.
  if (
    parent &&
    /^(id|uuid|code|codigo|key|value|valor|name|nome)$/i.test(last) &&
    !/^(data|dados|result|results|items|response|body|payload|content|records)$/i.test(parent)
  )
    return `${parent}${last.charAt(0).toUpperCase()}${last.slice(1)}`;
  return last;
}

function toCamel(key: string): string {
  const words = key
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return words
    .map((w, i) =>
      i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join('');
}
