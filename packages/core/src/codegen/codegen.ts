import type { PreparedRequest } from '../http/prepare';
import { hasLossyNumbers } from '../util/json-format';

/**
 * Geração de código a partir da requisição já resolvida (variáveis
 * substituídas; segredos mascarados ou não, a critério de quem chama).
 */

export const CODEGEN_TARGETS = ['curl', 'fetch', 'axios'] as const;
export type CodegenTarget = (typeof CODEGEN_TARGETS)[number];

export const CODEGEN_LABELS: Record<CodegenTarget, string> = {
  curl: 'cURL',
  fetch: 'JavaScript (fetch)',
  axios: 'JavaScript (axios)',
};

export function generateCode(request: PreparedRequest, target: CodegenTarget): string {
  switch (target) {
    case 'curl':
      return toCurl(request);
    case 'fetch':
      return toFetch(request);
    case 'axios':
      return toAxios(request);
  }
}

// ---------------------------------------------------------------------------
// cURL (sintaxe bash, como o "Copy as cURL" do navegador)

/** Aspas simples do shell: ' vira '\'' */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function toCurl(r: PreparedRequest): string {
  const parts: string[] = [`curl${r.method === 'GET' ? '' : ` -X ${r.method}`} ${shellQuote(r.url)}`];
  for (const [k, v] of r.headers) parts.push(`-H ${shellQuote(`${k}: ${v}`)}`);
  if (r.body.kind === 'text' && r.body.text !== '') parts.push(`--data-raw ${shellQuote(r.body.text)}`);
  if (r.body.kind === 'formdata') {
    for (const f of r.body.fields) {
      parts.push(
        f.type === 'file'
          ? `-F ${shellQuote(`${f.key}=@${f.value}`)}`
          : `-F ${shellQuote(`${f.key}=${f.value}`)}`,
      );
    }
  }
  if (!r.settings.verifySsl) parts.push('--insecure');
  if (r.settings.followRedirects) parts.push('--location');
  return parts.join(' \\\n  ');
}

// ---------------------------------------------------------------------------
// JavaScript

const js = (value: unknown) => JSON.stringify(value);

function headersObject(r: PreparedRequest, skipContentType: boolean): string {
  const entries = r.headers.filter(([k]) => !(skipContentType && k.toLowerCase() === 'content-type'));
  if (entries.length === 0) return '';
  return `{\n${entries.map(([k, v]) => `    ${js(k)}: ${js(v)},`).join('\n')}\n  }`;
}

/** Corpo JSON vira JSON.stringify(objeto) quando possível (mais legível). */
function bodyExpression(text: string, isJson: boolean): string {
  // Com números que o JavaScript arredonda, o objeto literal mandaria outro valor.
  if (isJson && !hasLossyNumbers(text)) {
    try {
      const pretty = JSON.stringify(JSON.parse(text), null, 2).replace(/\n/g, '\n  ');
      return `JSON.stringify(${pretty})`;
    } catch {
      // não é JSON válido: envia como texto
    }
  }
  return js(text);
}

function isJsonRequest(r: PreparedRequest): boolean {
  const ct = r.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  return /json/i.test(ct);
}

function formDataLines(r: PreparedRequest): string[] {
  if (r.body.kind !== 'formdata') return [];
  const lines = ['const form = new FormData();'];
  for (const f of r.body.fields) {
    if (f.type === 'file') {
      lines.push(`// Arquivo: ${f.value}`);
      lines.push(
        `form.append(${js(f.key)}, arquivoSelecionado); // ex.: input.files[0] ou await fs.openAsBlob(...)`,
      );
    } else {
      lines.push(`form.append(${js(f.key)}, ${js(f.value)});`);
    }
  }
  return [...lines, ''];
}

function toFetch(r: PreparedRequest): string {
  const isForm = r.body.kind === 'formdata';
  const headers = headersObject(r, isForm);
  const options: string[] = [`  method: ${js(r.method)},`];
  if (headers) options.push(`  headers: ${headers},`);
  if (r.body.kind === 'text' && r.body.text !== '')
    options.push(`  body: ${bodyExpression(r.body.text, isJsonRequest(r))},`);
  if (isForm) options.push('  body: form,');
  if (!r.settings.followRedirects) options.push(`  redirect: 'manual',`);

  return [
    ...formDataLines(r),
    `const response = await fetch(${js(r.url)}, {`,
    ...options,
    '});',
    '',
    'console.log(response.status, await response.text());',
  ].join('\n');
}

function toAxios(r: PreparedRequest): string {
  const isForm = r.body.kind === 'formdata';
  const headers = headersObject(r, isForm);
  const options: string[] = [`  method: ${js(r.method.toLowerCase())},`, `  url: ${js(r.url)},`];
  if (headers) options.push(`  headers: ${headers},`);
  if (r.body.kind === 'text' && r.body.text !== '')
    options.push(`  data: ${bodyExpression(r.body.text, isJsonRequest(r))},`);
  if (isForm) options.push('  data: form,');
  if (!r.settings.followRedirects) options.push('  maxRedirects: 0,');
  if (r.settings.timeoutMs > 0) options.push(`  timeout: ${r.settings.timeoutMs},`);

  return [
    "import axios from 'axios';",
    '',
    ...formDataLines(r),
    'const response = await axios({',
    ...options,
    '});',
    '',
    'console.log(response.status, response.data);',
  ].join('\n');
}
