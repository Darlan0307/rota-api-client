/**
 * JSON.stringify(JSON.parse(x)) troca números: 12345678901234567890 vira
 * 12345678901234567000, 10.50 vira 10.5. Num cliente de API isso mostra (ou
 * envia) um valor que a API não mandou, então aqui só a indentação muda.
 */

/** Reindenta com 2 espaços mantendo números e literais como estão. null se não for JSON válido. */
export function formatJson(text: string): string | null {
  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  let out = '';
  let depth = 0;
  const newline = () => `\n${'  '.repeat(depth)}`;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === '"') {
      const end = stringEnd(text, i);
      // Strings passam pelo JSON.stringify: "João" aparece como "João".
      out += JSON.stringify(JSON.parse(text.slice(i, end)));
      i = end - 1;
    } else if (ch === '{' || ch === '[') {
      const next = nextNonSpace(text, i + 1);
      if (text[next] === (ch === '{' ? '}' : ']')) {
        out += ch === '{' ? '{}' : '[]';
        i = next;
      } else {
        depth++;
        out += ch + newline();
      }
    } else if (ch === '}' || ch === ']') {
      depth--;
      out += newline() + ch;
    } else if (ch === ',') out += `,${newline()}`;
    else if (ch === ':') out += ': ';
    else if (!isSpace(ch)) out += ch;
  }
  return out;
}

/** JSON.parse que mantém como texto os números que perderiam precisão (ex.: IDs de 19 dígitos). */
export function parseJsonLossless(text: string): unknown {
  return (
    JSON.parse as (t: string, r: (k: string, v: unknown, c?: { source?: string }) => unknown) => unknown
  )(text, (_key, value, context) =>
    typeof value === 'number' && context?.source !== undefined && isLossyNumber(context.source)
      ? context.source
      : value,
  );
}

/** Algum número do JSON muda ao virar number do JavaScript? */
export function hasLossyNumbers(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === '"') i = stringEnd(text, i) - 1;
    else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const match = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
      if (match && isLossyNumber(match[0])) return true;
      i += (match?.[0].length ?? 1) - 1;
    }
  }
  return false;
}

/** Inteiro acima de 2^53 ou mais de 17 dígitos significativos. */
function isLossyNumber(literal: string): boolean {
  if (/^-?\d+$/.test(literal)) return !Number.isSafeInteger(Number(literal));
  const digits = literal
    .replace(/[eE].*$/, '')
    .replace(/[-.]/g, '')
    .replace(/^0+/, '')
    .replace(/0+$/, '');
  return digits.length > 17;
}

function stringEnd(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
  return i + 1;
}

function nextNonSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && isSpace(text[i] as string)) i++;
  return i;
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';
}
