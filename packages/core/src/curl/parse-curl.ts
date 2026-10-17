import { splitUrl } from '../http/url';
import {
  HTTP_METHODS,
  type HttpMethod,
  type KeyValue,
  type RequestData,
  RequestDataSchema,
} from '../model/schemas';

export interface CurlParseResult {
  data: RequestData;
  /** Opções ignoradas ou adaptadas (para avisar o usuário). */
  warnings: string[];
}

/** Indica se um texto colado parece um comando cURL. */
export function looksLikeCurl(text: string): boolean {
  return /^\s*curl(\.exe)?\s/i.test(text);
}

/**
 * Converte um comando cURL em requisição. Aceita a sintaxe do bash ("Copy as
 * cURL (bash)" do navegador) e a do cmd do Windows (com ^).
 */
export function parseCurl(command: string): CurlParseResult {
  const warnings: string[] = [];
  const tokens = tokenize(normalizeCmdSyntax(command));
  if (tokens[0]?.toLowerCase().replace(/\.exe$/, '') !== 'curl')
    throw new Error('O texto não começa com "curl".');

  let method: string | undefined;
  let url: string | undefined;
  const headers: KeyValue[] = [];
  const data: string[] = [];
  const urlencodeData: string[] = [];
  const form: { key: string; value: string; file: boolean }[] = [];
  let user: string | undefined;
  let getMode = false;
  let jsonMode = false;
  let insecure = false;
  let timeoutMs: number | undefined;

  const ignored = new Set<string>();
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    const next = () => {
      i++;
      return tokens[i] ?? '';
    };

    // Formas "--opcao=valor".
    const eq = token.startsWith('--') ? token.indexOf('=') : -1;
    const name = eq > 0 ? token.slice(0, eq) : token;
    const inline = eq > 0 ? token.slice(eq + 1) : undefined;
    const value = () => inline ?? next();

    switch (name) {
      case '-X':
      case '--request':
        method = value().toUpperCase();
        break;
      case '-H':
      case '--header': {
        const raw = value();
        const colon = raw.indexOf(':');
        if (colon > 0)
          headers.push({
            key: raw.slice(0, colon).trim(),
            value: raw.slice(colon + 1).trim(),
            enabled: true,
          });
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii': {
        const v = value();
        if (v.startsWith('@') && name !== '--data-raw') {
          warnings.push(`Dados lidos de arquivo (${v}) não são suportados; o texto foi mantido como está.`);
        }
        data.push(v);
        break;
      }
      case '--data-urlencode':
        urlencodeData.push(value());
        break;
      case '--json':
        data.push(value());
        jsonMode = true;
        break;
      case '-F':
      case '--form':
      case '--form-string': {
        const raw = value();
        const at = raw.indexOf('=');
        if (at > 0) {
          const key = raw.slice(0, at);
          let v = raw.slice(at + 1);
          const file = name !== '--form-string' && v.startsWith('@');
          if (file) v = v.slice(1).split(';')[0] ?? '';
          form.push({ key, value: v, file });
        }
        break;
      }
      case '-u':
      case '--user':
        user = value();
        break;
      case '-b':
      case '--cookie':
        headers.push({ key: 'Cookie', value: value(), enabled: true });
        break;
      case '-A':
      case '--user-agent':
        headers.push({ key: 'User-Agent', value: value(), enabled: true });
        break;
      case '-e':
      case '--referer':
        headers.push({ key: 'Referer', value: value(), enabled: true });
        break;
      case '-G':
      case '--get':
        getMode = true;
        break;
      case '-I':
      case '--head':
        method = 'HEAD';
        break;
      case '-k':
      case '--insecure':
        insecure = true;
        break;
      case '--url':
        url = value();
        break;
      case '-m':
      case '--max-time':
        timeoutMs = Math.round(Number(value()) * 1000) || undefined;
        break;
      case '-L':
      case '--location':
      case '--compressed':
      case '-s':
      case '--silent':
      case '-S':
      case '--show-error':
      case '-v':
      case '--verbose':
      case '-i':
      case '--include':
      case '-f':
      case '--fail':
        break;
      case '-o':
      case '--output':
      case '--connect-timeout':
      case '--retry':
      case '-x':
      case '--proxy':
      case '-w':
      case '--write-out':
      case '--cacert':
      case '--cert':
      case '--key':
        ignored.add(name);
        next();
        break;
      default:
        if (token.startsWith('-')) ignored.add(name);
        else if (url === undefined) url = token;
    }
  }
  if (ignored.size) warnings.push(`Opções ignoradas: ${[...ignored].join(', ')}.`);
  if (url === undefined) throw new Error('Não encontrei a URL no comando cURL.');

  // Método: o curl usa POST quando há dados, exceto com -G.
  const hasBody = data.length > 0 || urlencodeData.length > 0 || form.length > 0;
  let finalMethod = method ?? (hasBody && !getMode ? 'POST' : 'GET');
  if (!(HTTP_METHODS as readonly string[]).includes(finalMethod)) {
    warnings.push(`Método ${finalMethod} não suportado; usado GET.`);
    finalMethod = 'GET';
  }

  const { url: base, query } = splitUrl(url);
  const contentType = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? '';
  const result: Partial<RequestData> = { method: finalMethod as HttpMethod, url: base, query, headers };

  if (getMode && (data.length || urlencodeData.length)) {
    // -G: os dados vão para a query string.
    for (const pair of [...data, ...urlencodeData].join('&').split('&')) {
      if (!pair) continue;
      const i = pair.indexOf('=');
      query.push({
        key: i < 0 ? pair : pair.slice(0, i),
        value: i < 0 ? '' : pair.slice(i + 1),
        enabled: true,
      });
    }
  } else if (form.length) {
    result.body = {
      mode: 'formdata',
      fields: form.map((f) => ({
        key: f.key,
        value: f.value,
        type: f.file ? 'file' : 'text',
        enabled: true,
      })),
    };
  } else if (data.length || urlencodeData.length) {
    const text = data.join('&');
    if (jsonMode || /json/i.test(contentType) || (!contentType && isJson(text) && !urlencodeData.length)) {
      result.body = { mode: 'json', text: prettyJson(text) };
      if (jsonMode && !contentType)
        headers.push({ key: 'Content-Type', value: 'application/json', enabled: true });
    } else if (!contentType || /x-www-form-urlencoded/i.test(contentType)) {
      result.body = {
        mode: 'urlencoded',
        fields: [...parseUrlencoded(text), ...urlencodeData.map(parseUrlencodeArg)],
      };
      // O Content-Type é definido automaticamente para urlencoded.
      result.headers = headers.filter((h) => h.key.toLowerCase() !== 'content-type');
    } else {
      result.body = { mode: 'raw', language: /xml/i.test(contentType) ? 'xml' : 'text', text };
    }
  }

  // Basic auth: -u usuario:senha
  if (user !== undefined) {
    const i = user.indexOf(':');
    result.auth = {
      type: 'basic',
      username: i < 0 ? user : user.slice(0, i),
      password: i < 0 ? '' : user.slice(i + 1),
    };
  } else {
    result.auth = { type: 'inherit' };
  }

  const parsed = RequestDataSchema.parse(result);
  if (insecure) parsed.settings.verifySsl = false;
  if (timeoutMs) parsed.settings.timeoutMs = timeoutMs;
  return { data: parsed, warnings };
}

// ---------------------------------------------------------------------------

/** Formato do cmd: ^ escapa caracteres e encerra linhas continuadas. */
function normalizeCmdSyntax(command: string): string {
  if (!/\^\s*\r?\n|\^"/.test(command)) return command;
  return command.replace(/\^\s*\r?\n/g, ' ').replace(/\^(.)/g, '$1');
}

/** Divide como o bash: aspas simples, duplas, $'...' e barra invertida. */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let i = 0;
  const text = input.replace(/\\\r?\n/g, ' ');

  while (i < text.length) {
    const ch = text[i] as string;
    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
      i++;
      continue;
    }
    inToken = true;
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      current += text.slice(i + 1, end < 0 ? text.length : end);
      i = end < 0 ? text.length : end + 1;
    } else if (ch === '$' && text[i + 1] === "'") {
      // ANSI-C quoting: $'...\n...'
      i += 2;
      while (i < text.length && text[i] !== "'") {
        if (text[i] === '\\' && i + 1 < text.length) {
          const esc = text[i + 1] as string;
          current += { n: '\n', t: '\t', r: '\r', "'": "'", '\\': '\\', '"': '"' }[esc] ?? esc;
          i += 2;
        } else {
          current += text[i];
          i++;
        }
      }
      i++;
    } else if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && /["\\$`]/.test(text[i + 1] ?? '')) {
          current += text[i + 1];
          i += 2;
        } else {
          current += text[i];
          i++;
        }
      }
      i++;
    } else if (ch === '\\' && i + 1 < text.length) {
      current += text[i + 1];
      i += 2;
    } else {
      current += ch;
      i++;
    }
  }
  if (inToken) tokens.push(current);
  return tokens;
}

function isJson(text: string): boolean {
  const t = text.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function parseUrlencoded(text: string): KeyValue[] {
  return text
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      return {
        key: decode(i < 0 ? pair : pair.slice(0, i)),
        value: i < 0 ? '' : decode(pair.slice(i + 1)),
        enabled: true,
      };
    });
}

/** --data-urlencode "nome=valor com espaço" (o curl codifica o valor). */
function parseUrlencodeArg(arg: string): KeyValue {
  const i = arg.indexOf('=');
  return i < 0
    ? { key: arg, value: '', enabled: true }
    : { key: arg.slice(0, i), value: arg.slice(i + 1), enabled: true };
}
