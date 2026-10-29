/**
 * Relatório de evidências: junta envios do histórico (requisição, headers,
 * corpo e resposta) num documento para mandar a um colega ou ao suporte de
 * uma API. Parte do histórico porque lá as variáveis comuns já estão
 * resolvidas e as secretas já viraram ••••••; quem chama ainda passa o texto
 * final pela máscara de todos os segredos do workspace.
 */

import { generateCode } from '../codegen/codegen';
import { maskHeaderValue } from '../context-pack/pack';
import type { PreparedRequest } from '../http/prepare';
import type { RunResult } from '../runner/run-request';
import { formatJson } from '../util/json-format';
import { SECRET_MASK } from '../variables/template';

export interface EvidenceStep {
  name: string;
  /** Data do envio (ISO). */
  at: string;
  source: 'app' | 'mcp';
  result: RunResult;
}

export interface EvidenceOptions {
  title: string;
  /** Texto livre: o que aconteceu, o esperado e o obtido. */
  notes: string;
  environment: string;
  requestHeaders: boolean;
  responseHeaders: boolean;
  tests: boolean;
  curl: boolean;
  /** Mascara headers de autenticação e campos como token/senha nos corpos, mesmo sem ser variável secreta. */
  maskSensitive: boolean;
  maxBodyChars: number;
}

export const DEFAULT_EVIDENCE_OPTIONS: EvidenceOptions = {
  title: 'Relatório de requisições',
  notes: '',
  environment: '',
  requestHeaders: true,
  responseHeaders: true,
  tests: true,
  curl: false,
  maskSensitive: true,
  maxBodyChars: 30_000,
};

// ---------------------------------------------------------------------------
// Modelo intermediário (o mesmo para Markdown e HTML/PDF)

interface Body {
  text: string;
  language: 'json' | 'xml' | '';
  note?: string;
}

interface Section {
  index: number;
  name: string;
  at: string;
  source: 'app' | 'mcp';
  requestLine: string;
  requestHeaders: [string, string][];
  requestBody: Body | null;
  response: {
    statusLine: string;
    status: number;
    timeMs: number;
    size: string;
    headers: [string, string][];
    body: Body | null;
  } | null;
  error: { message: string; detail?: string | undefined } | null;
  tests: { name: string; status: 'passed' | 'failed' | 'skipped'; message?: string | undefined }[];
  warnings: string[];
  curl: string | null;
}

interface Doc {
  options: EvidenceOptions;
  generatedAt: Date;
  sections: Section[];
}

const SENSITIVE_KEY =
  /token|password|passwd|senha|secret|api[-_]?key|authorization|cookie|cvv|card[-_]?number/i;

/** Valores de campos sensíveis em JSON (só strings) e em urlencoded. */
export function maskSensitiveFields(text: string): string {
  const json = text.replace(
    /("((?:[^"\\]|\\.)*)"\s*:\s*)"(?:[^"\\]|\\.)*"/g,
    (match, prefix: string, key: string) => (SENSITIVE_KEY.test(key) ? `${prefix}"${SECRET_MASK}"` : match),
  );
  if (json !== text || !/^[^\s{[<]*=/.test(text.trim())) return json;
  return text
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      return eq > 0 && SENSITIVE_KEY.test(decodeSafe(pair.slice(0, eq)))
        ? `${pair.slice(0, eq)}=${SECRET_MASK}`
        : pair;
    })
    .join('&');
}

function decodeSafe(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

function headerValue(headers: readonly [string, string][], name: string): string {
  return headers.find(([k]) => k.toLowerCase() === name)?.[1] ?? '';
}

function maskHeaders(headers: readonly [string, string][], mask: boolean): [string, string][] {
  return headers.map(([k, v]) => [k, mask ? maskHeaderValue(k, v) : v]);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

function makeBody(raw: string, contentType: string, options: EvidenceOptions): Body | null {
  if (raw.trim() === '') return null;
  let text = raw;
  let language: Body['language'] = '';
  const trimmed = raw.trim();
  if (/json/i.test(contentType) || /^[[{]/.test(trimmed)) {
    const pretty = formatJson(trimmed);
    if (pretty !== null) {
      text = pretty;
      language = 'json';
    }
  } else if (/xml|html/i.test(contentType) || trimmed.startsWith('<')) {
    language = 'xml';
  }
  if (options.maskSensitive) text = maskSensitiveFields(text);
  if (text.length > options.maxBodyChars) {
    return {
      text: text.slice(0, options.maxBodyChars),
      language,
      note: `Corpo cortado: mostra ${options.maxBodyChars.toLocaleString('pt-BR')} de ${text.length.toLocaleString('pt-BR')} caracteres.`,
    };
  }
  return { text, language };
}

function requestBody(request: PreparedRequest, options: EvidenceOptions): Body | null {
  const body = request.body;
  if (body.kind === 'none') return null;
  if (body.kind === 'formdata') {
    const lines = body.fields.map((f) =>
      f.type === 'file'
        ? `${f.key}: (arquivo) ${f.value}`
        : `${f.key}: ${options.maskSensitive && SENSITIVE_KEY.test(f.key) ? SECRET_MASK : f.value}`,
    );
    return { text: lines.join('\n'), language: '', note: 'multipart/form-data' };
  }
  return makeBody(body.text, headerValue(request.headers, 'content-type'), options);
}

function buildSection(step: EvidenceStep, index: number, options: EvidenceOptions): Section {
  const { result } = step;
  const request = result.request;
  const response = result.response;
  // Os headers lidos do socket mostram o que saiu de fato (Host, Content-Length...).
  const sent = response?.sentHeaders ?? request?.headers ?? [];
  let curl: string | null = null;
  if (options.curl && request) {
    const masked: PreparedRequest = {
      ...request,
      headers: maskHeaders(request.headers, options.maskSensitive),
      body:
        request.body.kind === 'text' && options.maskSensitive
          ? { kind: 'text', text: maskSensitiveFields(request.body.text) }
          : request.body,
    };
    curl = generateCode(masked, 'curl');
  }

  return {
    index,
    name: step.name,
    at: step.at,
    source: step.source,
    requestLine: request ? `${request.method} ${request.url}` : '(requisição não montada)',
    requestHeaders: maskHeaders(sent, options.maskSensitive),
    requestBody: request ? requestBody(request, options) : null,
    response: response
      ? {
          statusLine: `${response.status} ${response.statusText}`.trim(),
          status: response.status,
          timeMs: Math.round(response.timings.total),
          size: formatSize(response.sizeBytes),
          headers: maskHeaders(response.headers, options.maskSensitive),
          body:
            response.body.encoding === 'base64'
              ? {
                  text: '',
                  language: '',
                  note: `Corpo binário (${headerValue(response.headers, 'content-type') || 'tipo desconhecido'}, ${formatSize(response.sizeBytes)}): não incluído.`,
                }
              : (() => {
                  const body = makeBody(
                    response.body.data,
                    headerValue(response.headers, 'content-type'),
                    options,
                  );
                  if (body && response.truncated)
                    body.note = [body.note, 'A resposta passou do limite do Rota e chegou cortada.']
                      .filter(Boolean)
                      .join(' ');
                  return body;
                })(),
        }
      : null,
    error: result.error ? { message: result.error.message, detail: result.error.detail } : null,
    tests: options.tests ? (result.tests ?? []) : [],
    warnings: result.warnings ?? [],
    curl,
  };
}

function buildDoc(steps: readonly EvidenceStep[], options: EvidenceOptions, generatedAt: Date): Doc {
  const ordered = [...steps].sort((a, b) => a.at.localeCompare(b.at));
  return { options, generatedAt, sections: ordered.map((s, i) => buildSection(s, i + 1, options)) };
}

// ---------------------------------------------------------------------------
// Datas e textos comuns

const dateTime = (date: Date) =>
  date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function outcome(section: Section): string {
  if (section.response) return `${section.response.statusLine} · ${section.response.timeMs} ms`;
  return `Erro: ${section.error?.message ?? 'sem resposta'}`;
}

function shortUrl(requestLine: string): string {
  const [method, url = ''] = requestLine.split(' ', 2);
  try {
    const parsed = new URL(url);
    return `${method} ${parsed.pathname}${parsed.search}`;
  } catch {
    return requestLine;
  }
}

const TEST_ICON = { passed: '✅', failed: '❌', skipped: '⏭️' } as const;

// ---------------------------------------------------------------------------
// Markdown

function fence(text: string, language = ''): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const marks = '`'.repeat(longest + 1);
  return `${marks}${language}\n${text}\n${marks}`;
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function headerBlock(first: string, headers: readonly [string, string][]): string {
  return fence([first, ...headers.map(([k, v]) => `${k}: ${v}`)].join('\n'), 'http');
}

function markdownSection(s: Section, options: EvidenceOptions): string {
  const out: string[] = [`## ${s.index}. ${s.name}`, ''];
  out.push(
    `${time(s.at)}${s.source === 'mcp' ? ' · enviada pelo Claude (MCP)' : ''} · **${outcome(s)}**`,
    '',
  );

  out.push('### Requisição', '');
  out.push(
    options.requestHeaders ? headerBlock(s.requestLine, s.requestHeaders) : fence(s.requestLine, 'http'),
  );
  if (s.requestBody) {
    out.push('', 'Corpo enviado:', '');
    if (s.requestBody.note) out.push(`_${s.requestBody.note}_`, '');
    out.push(fence(s.requestBody.text, s.requestBody.language));
  }
  for (const warning of s.warnings) out.push('', `> ⚠️ ${warning}`);

  out.push('', '### Resposta', '');
  if (s.response) {
    const r = s.response;
    out.push(`**${r.statusLine}** · ${r.timeMs} ms · ${r.size}`, '');
    if (options.responseHeaders && r.headers.length > 0)
      out.push(headerBlock(`HTTP ${r.statusLine}`, r.headers), '');
    if (r.body) {
      if (r.body.note) out.push(`_${r.body.note}_`, '');
      if (r.body.text) out.push(fence(r.body.text, r.body.language));
    } else {
      out.push('_Sem corpo._');
    }
  } else {
    out.push(`**Sem resposta.** ${s.error?.message ?? ''}`.trim());
    if (s.error?.detail) out.push('', fence(s.error.detail));
  }

  if (s.tests.length > 0) {
    out.push('', '### Testes', '');
    for (const t of s.tests)
      out.push(`- ${TEST_ICON[t.status]} ${t.name}${t.message ? `: ${t.message}` : ''}`);
  }
  if (s.curl) out.push('', '### Para reproduzir (cURL)', '', fence(s.curl, 'bash'));
  return out.join('\n').trimEnd();
}

export function renderEvidenceMarkdown(
  steps: readonly EvidenceStep[],
  options: EvidenceOptions = DEFAULT_EVIDENCE_OPTIONS,
  generatedAt = new Date(),
): string {
  const doc = buildDoc(steps, options, generatedAt);
  const meta = [`**Gerado em:** ${dateTime(generatedAt)}`];
  if (options.environment.trim()) meta.push(`**Ambiente:** ${options.environment.trim()}`);
  meta.push(`**Requisições:** ${doc.sections.length}`);

  const out = [`# ${options.title.trim() || DEFAULT_EVIDENCE_OPTIONS.title}`, '', meta.join(' · ')];
  if (options.notes.trim()) out.push('', '## O que aconteceu', '', options.notes.trim());
  if (doc.sections.length > 1) {
    out.push('', '## Sequência', '', '| # | Horário | Requisição | Resultado |', '|---|---|---|---|');
    for (const s of doc.sections)
      out.push(
        `| ${s.index} | ${time(s.at)} | ${cell(`${s.name} (${shortUrl(s.requestLine)})`)} | ${cell(outcome(s))} |`,
      );
  }
  for (const s of doc.sections) out.push('', markdownSection(s, options));
  out.push(
    '',
    '---',
    '',
    `_Gerado pelo Rota. Valores secretos aparecem como ${SECRET_MASK}${options.maskSensitive ? '; headers de autenticação e campos como token e senha também foram mascarados' : ''}._`,
  );
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// HTML (para salvar em PDF)

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function statusClass(status: number | null): string {
  if (status === null || status >= 500) return 'bad';
  if (status >= 400) return 'warn';
  return 'ok';
}

function htmlPre(lines: string, cls = ''): string {
  return `<pre${cls ? ` class="${cls}"` : ''}>${escapeHtml(lines)}</pre>`;
}

function htmlHeaders(first: string, headers: readonly [string, string][]): string {
  const rows = headers
    .map(([k, v]) => `<span class="hk">${escapeHtml(k)}:</span> ${escapeHtml(v)}`)
    .join('\n');
  return `<pre><strong>${escapeHtml(first)}</strong>${rows ? `\n${rows}` : ''}</pre>`;
}

function htmlSection(s: Section, options: EvidenceOptions): string {
  const status = s.response?.status ?? null;
  const parts = [
    `<section><h2><span class="n">${s.index}</span> ${escapeHtml(s.name)} <span class="chip ${statusClass(status)}">${escapeHtml(s.response?.statusLine ?? 'Sem resposta')}</span></h2>`,
    `<p class="meta">${escapeHtml(time(s.at))}${s.response ? ` · ${s.response.timeMs} ms · ${escapeHtml(s.response.size)}` : ''}${s.source === 'mcp' ? ' · enviada pelo Claude (MCP)' : ''}</p>`,
    '<h3>Requisição</h3>',
    options.requestHeaders ? htmlHeaders(s.requestLine, s.requestHeaders) : htmlPre(s.requestLine),
  ];
  if (s.requestBody) {
    parts.push('<p class="label">Corpo enviado</p>');
    if (s.requestBody.note) parts.push(`<p class="note">${escapeHtml(s.requestBody.note)}</p>`);
    parts.push(htmlPre(s.requestBody.text));
  }
  for (const w of s.warnings) parts.push(`<p class="warning">⚠️ ${escapeHtml(w)}</p>`);
  parts.push('<h3>Resposta</h3>');
  if (s.response) {
    const r = s.response;
    if (options.responseHeaders && r.headers.length > 0)
      parts.push(htmlHeaders(`HTTP ${r.statusLine}`, r.headers));
    if (r.body?.note) parts.push(`<p class="note">${escapeHtml(r.body.note)}</p>`);
    if (r.body?.text) parts.push(htmlPre(r.body.text));
    if (!r.body) parts.push('<p class="note">Sem corpo.</p>');
  } else {
    parts.push(`<p class="warning">Sem resposta. ${escapeHtml(s.error?.message ?? '')}</p>`);
    if (s.error?.detail) parts.push(htmlPre(s.error.detail));
  }
  if (s.tests.length > 0) {
    parts.push(
      '<h3>Testes</h3><ul>',
      ...s.tests.map(
        (t) =>
          `<li>${TEST_ICON[t.status]} ${escapeHtml(t.name)}${t.message ? `: ${escapeHtml(t.message)}` : ''}</li>`,
      ),
      '</ul>',
    );
  }
  if (s.curl) parts.push('<h3>Para reproduzir (cURL)</h3>', htmlPre(s.curl));
  parts.push('</section>');
  return parts.join('\n');
}

const CSS = `
*{box-sizing:border-box}
body{font:13px/1.5 "Segoe UI",system-ui,sans-serif;color:#1f2330;margin:0;padding:28px 34px}
h1{font-size:21px;margin:0 0 4px}
h2{font-size:15px;margin:0 0 2px;display:flex;align-items:center;gap:8px}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#5b6170;margin:14px 0 6px}
section{border-top:1px solid #e3e5ea;padding-top:16px;margin-top:20px;break-inside:auto}
pre{background:#f5f6f8;border:1px solid #e3e5ea;border-radius:6px;padding:9px 11px;font:11.5px/1.45 Consolas,"Cascadia Mono",monospace;white-space:pre-wrap;word-break:break-all;margin:0 0 8px}
.hk{color:#5b4bd6}
.meta{color:#6b7180;margin:0}
.label{margin:10px 0 4px;color:#5b6170}
.note{color:#6b7180;font-style:italic;margin:4px 0}
.warning{color:#9a5b00;margin:6px 0}
.n{display:inline-flex;width:22px;height:22px;border-radius:50%;background:#ecebfd;color:#4b3fc4;font-size:12px;align-items:center;justify-content:center}
.chip{font-size:11px;font-weight:600;border-radius:999px;padding:1px 8px}
.chip.ok{background:#e3f6ec;color:#17794a}.chip.warn{background:#fdf1dc;color:#93590a}.chip.bad{background:#fde7e7;color:#b42323}
table{border-collapse:collapse;width:100%;margin:6px 0 4px;font-size:12px}
th,td{border:1px solid #e3e5ea;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#f5f6f8}
.notes{white-space:pre-wrap;background:#fbfbfd;border-left:3px solid #6d5df5;padding:8px 12px;margin:10px 0}
footer{margin-top:28px;color:#8a8f9c;font-size:11px}
`;

export function renderEvidenceHtml(
  steps: readonly EvidenceStep[],
  options: EvidenceOptions = DEFAULT_EVIDENCE_OPTIONS,
  generatedAt = new Date(),
): string {
  const doc = buildDoc(steps, options, generatedAt);
  const title = options.title.trim() || DEFAULT_EVIDENCE_OPTIONS.title;
  const meta = [`Gerado em ${dateTime(generatedAt)}`];
  if (options.environment.trim()) meta.push(`Ambiente: ${options.environment.trim()}`);
  meta.push(`${doc.sections.length} ${doc.sections.length === 1 ? 'requisição' : 'requisições'}`);

  const body = [`<h1>${escapeHtml(title)}</h1>`, `<p class="meta">${escapeHtml(meta.join(' · '))}</p>`];
  if (options.notes.trim())
    body.push('<h3>O que aconteceu</h3>', `<div class="notes">${escapeHtml(options.notes.trim())}</div>`);
  if (doc.sections.length > 1) {
    body.push(
      '<h3>Sequência</h3><table><tr><th>#</th><th>Horário</th><th>Requisição</th><th>Resultado</th></tr>',
      ...doc.sections.map(
        (s) =>
          `<tr><td>${s.index}</td><td>${escapeHtml(time(s.at))}</td><td>${escapeHtml(s.name)}<br><code>${escapeHtml(shortUrl(s.requestLine))}</code></td><td>${escapeHtml(outcome(s))}</td></tr>`,
      ),
      '</table>',
    );
  }
  for (const s of doc.sections) body.push(htmlSection(s, options));
  body.push(
    `<footer>Gerado pelo Rota. Valores secretos aparecem como ${SECRET_MASK}${options.maskSensitive ? '; headers de autenticação e campos como token e senha também foram mascarados' : ''}.</footer>`,
  );
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${CSS}</style></head><body>${body.join('\n')}</body></html>`;
}
