import { findVariableRefs, type VariableRef } from '../variables/template';

/**
 * JSON com {{variáveis}}, como no Postman: a variável pode vir sem aspas
 * ("PedidoId": {{PEDIDO_ID}}) e vira o valor dela no envio. O validador do
 * editor e o "Formatar" precisam aceitar isso sem marcar erro.
 */

export interface JsonSyntaxError {
  /** Posição do erro no texto original. */
  offset: number;
  message: string;
}

/** Variáveis fora de textos entre aspas (as que entram como valor cru). */
function bareVariables(text: string): VariableRef[] {
  const refs = findVariableRefs(text);
  const bare: VariableRef[] = [];
  let inString = false;
  let next = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      while (next < refs.length && (refs[next]?.start ?? 0) < i) next++;
      const ref = refs[next];
      if (ref?.start === i) {
        bare.push(ref);
        i = ref.end - 1;
      }
    }
  }
  return bare;
}

/** Troca as variáveis sem aspas por 0 com o mesmo tamanho (as posições continuam valendo). */
function withPlaceholders(text: string): string {
  let out = '';
  let last = 0;
  for (const ref of bareVariables(text)) {
    out += `${text.slice(last, ref.start)}0${' '.repeat(ref.end - ref.start - 1)}`;
    last = ref.end;
  }
  return out + text.slice(last);
}

class JsonError extends Error {
  constructor(
    readonly offset: number,
    message: string,
  ) {
    super(message);
  }
}

/** Leitor de JSON só para achar o primeiro erro, com mensagem em português. */
function parse(text: string): void {
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i] as string)) i++;
  };
  const fail = (message: string): never => {
    throw new JsonError(Math.min(i, text.length), message);
  };

  const string = () => {
    i++;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') {
        i++;
        return;
      }
      if (ch === '\\') {
        const esc = text[i + 1];
        if (esc === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6)))
            fail('Escape \\u inválido: use 4 dígitos hexadecimais.');
          i += 6;
        } else if (esc !== undefined && '"\\/bfnrt'.includes(esc)) i += 2;
        else fail(`Escape inválido "\\${esc ?? ''}" dentro do texto.`);
      } else if (ch === '\n') fail('Texto sem aspas de fechamento nesta linha.');
      else i++;
    }
    fail('Texto sem aspas de fechamento.');
  };

  const value = (): void => {
    ws();
    const ch = text[i];
    if (ch === undefined) fail('O JSON terminou antes da hora: falta um valor.');
    if (ch === '{' || ch === '[' || ch === '"') {
      if (ch === '{') object();
      else if (ch === '[') array();
      else string();
      return;
    }
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (number && !/^[\w.-]/.test(text.slice(i + number[0].length))) {
      i += number[0].length;
      return;
    }
    const word = /^[\w.-]+/.exec(text.slice(i))?.[0];
    if (word === 'true' || word === 'false' || word === 'null') {
      i += word.length;
      return;
    }
    if (word) fail(`Valor inválido "${word.slice(0, 40)}": textos precisam estar entre aspas.`);
    fail(`Esperava um valor, mas encontrou "${ch}".`);
  };

  const object = () => {
    i++;
    ws();
    if (text[i] === '}') {
      i++;
      return;
    }
    for (;;) {
      ws();
      if (text[i] === '}') fail('Vírgula sobrando antes do "}".');
      if (text[i] !== '"') fail('Esperava o nome do campo entre aspas.');
      string();
      ws();
      if (text[i] !== ':') fail('Esperava ":" depois do nome do campo.');
      i++;
      value();
      ws();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') {
        i++;
        return;
      }
      fail(
        text[i] === undefined
          ? 'Falta fechar o objeto com "}".'
          : 'Esperava "," ou "}" (falta uma vírgula?).',
      );
    }
  };

  const array = () => {
    i++;
    ws();
    if (text[i] === ']') {
      i++;
      return;
    }
    for (;;) {
      ws();
      if (text[i] === ']') fail('Vírgula sobrando antes do "]".');
      value();
      ws();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') {
        i++;
        return;
      }
      fail(
        text[i] === undefined ? 'Falta fechar a lista com "]".' : 'Esperava "," ou "]" (falta uma vírgula?).',
      );
    }
  };

  value();
  ws();
  if (i < text.length) fail('Há conteúdo depois do fim do JSON.');
}

/** Primeiro erro de sintaxe, aceitando {{variáveis}} sem aspas. Texto vazio não é erro. */
export function jsonSyntaxError(text: string): JsonSyntaxError | null {
  if (!text.trim()) return null;
  try {
    parse(withPlaceholders(text));
    return null;
  } catch (error) {
    if (error instanceof JsonError) return { offset: error.offset, message: error.message };
    throw error;
  }
}

/** Linha e coluna (a partir de 1) de uma posição do texto. */
export function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}

/** Formata com 2 espaços, mantendo as {{variáveis}} sem aspas. null se o JSON tiver erro. */
export function formatJsonTemplate(text: string): string | null {
  const refs = bareVariables(text);
  let marked = '';
  let last = 0;
  refs.forEach((ref, n) => {
    marked += `${text.slice(last, ref.start)}"rota${n}"`;
    last = ref.end;
  });
  marked += text.slice(last);
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(marked), null, 2);
  } catch {
    return null;
  }
  return formatted.replace(/"rota(\d+)"/g, (_, n: string) => {
    const ref = refs[Number(n)];
    return ref ? text.slice(ref.start, ref.end) : '';
  });
}
