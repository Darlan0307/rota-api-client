/**
 * Relatório de evidências: junta envios do histórico (requisição, headers,
 * corpo e resposta) num documento para mandar a um colega ou ao suporte de
 * uma API. Parte do histórico porque lá as variáveis comuns já estão
 * resolvidas e as secretas já viraram ••••••; quem chama ainda passa o texto
 * final pela máscara de todos os segredos do workspace.
 *
 * Tudo o que entra é escolhido pelo usuário (EvidenceInclude): o relatório
 * sai para terceiros, então nada aparece sem estar marcado.
 */

import { generateCode } from '../codegen/codegen';
import type { PreparedRequest } from '../http/prepare';
import type { RunResult } from '../runner/run-request';
import { formatJson } from '../util/json-format';
import { SECRET_MASK } from '../variables/template';

export interface EvidenceStep {
  /** Id da entrada do histórico (para trocar o nome no relatório). */
  id: string;
  name: string;
  /** Data do envio (ISO). */
  at: string;
  source: 'app' | 'mcp';
  result: RunResult;
}

/** O que entra no relatório (Markdown, PDF e imagem). */
export interface EvidenceInclude {
  generatedAt: boolean;
  environment: boolean;
  notes: boolean;
  /** Tabela com a sequência (só aparece com 2 envios ou mais). */
  summary: boolean;
  /** Horário de cada envio. */
  time: boolean;
  /** URL completa; desmarcado mostra só o caminho (sem servidor). */
  fullUrl: boolean;
  requestHeaders: boolean;
  requestBody: boolean;
  /** Tempo e tamanho da resposta. */
  responseMeta: boolean;
  responseHeaders: boolean;
  responseBody: boolean;
  tests: boolean;
  warnings: boolean;
  curl: boolean;
}

export interface EvidenceOptions {
  title: string;
  /** Texto livre: o que aconteceu, o esperado e o obtido. */
  notes: string;
  environment: string;
  include: EvidenceInclude;
  /** Esconde headers de conexão que não ajudam a entender o problema (Host, Connection, Date...). */
  hideTechnicalHeaders: boolean;
  /** Mascara headers de autenticação e campos como token/senha, mesmo sem ser variável secreta. */
  maskSensitive: boolean;
  /** Nomes extras de campos/headers a mascarar, separados por vírgula (ex.: "cpf, email"). */
  extraMaskedFields: string;
  maxBodyChars: number;
  /** Linhas de cada corpo nos cartões da imagem. */
  cardBodyLines: number;
  /** Título da seção com o texto livre. */
  notesHeading: string;
  /** Texto do rodapé (vazio: sem rodapé). */
  footer: string;
  /** Nome de cada envio no relatório, por id do histórico (no lugar do nome da requisição). */
  stepNames: Record<string, string>;
}

export const DEFAULT_EVIDENCE_INCLUDE: EvidenceInclude = {
  generatedAt: true,
  environment: true,
  notes: true,
  summary: true,
  time: true,
  fullUrl: true,
  requestHeaders: true,
  requestBody: true,
  responseMeta: true,
  responseHeaders: false,
  responseBody: true,
  tests: true,
  warnings: true,
  curl: false,
};

export const DEFAULT_EVIDENCE_FOOTER = `Gerado pelo Rota. Valores secretos e dados sensíveis aparecem como ${SECRET_MASK}.`;

export const DEFAULT_EVIDENCE_OPTIONS: EvidenceOptions = {
  title: 'Relatório de requisições',
  notes: '',
  environment: '',
  include: DEFAULT_EVIDENCE_INCLUDE,
  hideTechnicalHeaders: true,
  maskSensitive: true,
  extraMaskedFields: '',
  maxBodyChars: 30_000,
  cardBodyLines: 18,
  notesHeading: 'O que aconteceu',
  footer: DEFAULT_EVIDENCE_FOOTER,
  stepNames: {},
};

/** Headers de conexão/transporte escondidos com `hideTechnicalHeaders`. */
export const TECHNICAL_HEADERS = [
  'host',
  'connection',
  'keep-alive',
  'content-length',
  'transfer-encoding',
  'accept-encoding',
  'user-agent',
  'date',
  'vary',
  'etag',
  'cache-control',
  'pragma',
  'expires',
  'age',
  'via',
];

// ---------------------------------------------------------------------------
// Máscaras

const SENSITIVE_WORDS = [
  'token',
  'password',
  'passwd',
  'senha',
  'secret',
  'api[-_]?key',
  'authorization',
  'cookie',
  'signature',
  'assinatura',
  'cvv',
  'card[-_]?number',
];

/** Regex dos nomes sensíveis (fixos + os extras do usuário). */
export function sensitiveNamePattern(extra = ''): RegExp {
  const extras = extra
    .split(/[,;\n]/)
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp([...SENSITIVE_WORDS, ...extras].join('|'), 'i');
}

const DEFAULT_SENSITIVE = sensitiveNamePattern();

/** Valores de campos sensíveis em JSON (só strings e números) e em urlencoded. */
export function maskSensitiveFields(text: string, pattern: RegExp = DEFAULT_SENSITIVE): string {
  const json = text.replace(
    /("((?:[^"\\]|\\.)*)"\s*:\s*)("(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*)/g,
    (match, prefix: string, key: string) => (pattern.test(key) ? `${prefix}"${SECRET_MASK}"` : match),
  );
  if (json !== text || !/^[^\s{[<]*=/.test(text.trim())) return json;
  return text
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      return eq > 0 && pattern.test(decodeSafe(pair.slice(0, eq)))
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

/** Header sensível vira "••••••" (mantendo "Bearer"/"Basic" para dar contexto). */
function maskHeader(key: string, value: string, pattern: RegExp): string {
  if (!pattern.test(key)) return value;
  const scheme = /^(Bearer|Basic)\s+/i.exec(value)?.[0] ?? '';
  return `${scheme}${SECRET_MASK}`;
}

interface Context {
  options: EvidenceOptions;
  include: EvidenceInclude;
  pattern: RegExp | null;
}

function prepareHeaders(headers: readonly [string, string][], ctx: Context): [string, string][] {
  return headers
    .filter(([k]) => !ctx.options.hideTechnicalHeaders || !TECHNICAL_HEADERS.includes(k.toLowerCase()))
    .map(([k, v]) => [k, ctx.pattern ? maskHeader(k, v, ctx.pattern) : v]);
}

function maskText(text: string, ctx: Context): string {
  return ctx.pattern ? maskSensitiveFields(text, ctx.pattern) : text;
}

/** A query também pode levar token (?api_key=...). */
function maskUrl(url: string, ctx: Context): string {
  if (!ctx.pattern) return url;
  const q = url.indexOf('?');
  if (q < 0) return url;
  const hash = url.indexOf('#', q);
  const end = hash < 0 ? url.length : hash;
  return `${url.slice(0, q + 1)}${maskSensitiveFields(url.slice(q + 1, end), ctx.pattern)}${url.slice(end)}`;
}

// ---------------------------------------------------------------------------
// Modelo intermediário (o mesmo para Markdown, HTML/PDF e cartões)

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
  method: string;
  url: string;
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
  ctx: Context;
  generatedAt: Date;
  sections: Section[];
}

function headerValue(headers: readonly [string, string][], name: string): string {
  return headers.find(([k]) => k.toLowerCase() === name)?.[1] ?? '';
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

function makeBody(raw: string, contentType: string, ctx: Context): Body | null {
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
  text = maskText(text, ctx);
  const max = ctx.options.maxBodyChars;
  if (text.length > max) {
    return {
      text: text.slice(0, max),
      language,
      note: `Corpo cortado: mostra ${max.toLocaleString('pt-BR')} de ${text.length.toLocaleString('pt-BR')} caracteres.`,
    };
  }
  return { text, language };
}

function requestBody(request: PreparedRequest, ctx: Context): Body | null {
  const body = request.body;
  if (body.kind === 'none') return null;
  if (body.kind === 'formdata') {
    const lines = body.fields.map((f) =>
      f.type === 'file'
        ? `${f.key}: (arquivo) ${f.value}`
        : `${f.key}: ${ctx.pattern?.test(f.key) ? SECRET_MASK : f.value}`,
    );
    return { text: lines.join('\n'), language: '', note: 'multipart/form-data' };
  }
  return makeBody(body.text, headerValue(request.headers, 'content-type'), ctx);
}

function responseBody(response: NonNullable<RunResult['response']>, ctx: Context): Body | null {
  if (response.body.encoding === 'base64') {
    return {
      text: '',
      language: '',
      note: `Corpo binário (${headerValue(response.headers, 'content-type') || 'tipo desconhecido'}, ${formatSize(response.sizeBytes)}): não incluído.`,
    };
  }
  const body = makeBody(response.body.data, headerValue(response.headers, 'content-type'), ctx);
  if (body && response.truncated)
    body.note = [body.note, 'A resposta passou do limite do Rota e chegou cortada.']
      .filter(Boolean)
      .join(' ');
  return body;
}

function buildSection(step: EvidenceStep, index: number, ctx: Context): Section {
  const { result } = step;
  const { include } = ctx;
  const request = result.request;
  const response = result.response;
  // Os headers lidos do socket mostram o que saiu de fato (Host, Content-Length...).
  const sent = response?.sentHeaders ?? request?.headers ?? [];
  let curl: string | null = null;
  if (include.curl && request) {
    curl = generateCode(
      {
        ...request,
        url: maskUrl(request.url, ctx),
        headers: request.headers.map(([k, v]) => [k, ctx.pattern ? maskHeader(k, v, ctx.pattern) : v]),
        body:
          request.body.kind === 'text'
            ? { kind: 'text', text: maskText(request.body.text, ctx) }
            : request.body,
      },
      'curl',
    );
  }

  return {
    index,
    name: ctx.options.stepNames[step.id]?.trim() || step.name,
    at: step.at,
    source: step.source,
    method: request?.method ?? '',
    url: request ? maskUrl(request.url, ctx) : '(requisição não montada)',
    requestHeaders: include.requestHeaders ? prepareHeaders(sent, ctx) : [],
    requestBody: include.requestBody && request ? requestBody(request, ctx) : null,
    response: response
      ? {
          statusLine: `${response.status} ${response.statusText}`.trim(),
          status: response.status,
          timeMs: Math.round(response.timings.total),
          size: formatSize(response.sizeBytes),
          headers: include.responseHeaders ? prepareHeaders(response.headers, ctx) : [],
          body: include.responseBody ? responseBody(response, ctx) : null,
        }
      : null,
    error: result.error ? { message: result.error.message, detail: result.error.detail } : null,
    tests: include.tests ? (result.tests ?? []) : [],
    warnings: include.warnings ? (result.warnings ?? []) : [],
    curl,
  };
}

function buildDoc(steps: readonly EvidenceStep[], options: EvidenceOptions, generatedAt: Date): Doc {
  const ctx: Context = {
    options,
    include: { ...DEFAULT_EVIDENCE_INCLUDE, ...options.include },
    pattern: options.maskSensitive ? sensitiveNamePattern(options.extraMaskedFields) : null,
  };
  const ordered = [...steps].sort((a, b) => a.at.localeCompare(b.at));
  return { ctx, generatedAt, sections: ordered.map((s, i) => buildSection(s, i + 1, ctx)) };
}

// ---------------------------------------------------------------------------
// Textos comuns

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

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function urlFor(s: Section, ctx: Context): string {
  return ctx.include.fullUrl ? s.url : pathOf(s.url);
}

function requestLine(s: Section, ctx: Context): string {
  return `${s.method} ${urlFor(s, ctx)}`.trim();
}

function outcome(s: Section, ctx: Context): string {
  if (!s.response) return `Erro: ${s.error?.message ?? 'sem resposta'}`;
  return ctx.include.responseMeta
    ? `${s.response.statusLine} · ${s.response.timeMs} ms`
    : s.response.statusLine;
}

function metaLine(doc: Doc): string[] {
  const { ctx } = doc;
  const meta: string[] = [];
  if (ctx.include.generatedAt) meta.push(`Gerado em ${dateTime(doc.generatedAt)}`);
  if (ctx.include.environment && ctx.options.environment.trim())
    meta.push(`Ambiente: ${ctx.options.environment.trim()}`);
  meta.push(`${doc.sections.length} ${doc.sections.length === 1 ? 'requisição' : 'requisições'}`);
  return meta;
}

const titleOf = (options: EvidenceOptions) => options.title.trim() || DEFAULT_EVIDENCE_OPTIONS.title;
const notesOf = (ctx: Context) => (ctx.include.notes ? ctx.options.notes.trim() : '');
const notesHeadingOf = (ctx: Context) =>
  ctx.options.notesHeading.trim() || DEFAULT_EVIDENCE_OPTIONS.notesHeading;

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

function markdownSection(s: Section, ctx: Context): string {
  const { include } = ctx;
  const out: string[] = [`## ${s.index}. ${s.name}`, ''];
  const meta = [
    include.time ? time(s.at) : '',
    s.source === 'mcp' ? 'enviada pelo Claude (MCP)' : '',
    `**${outcome(s, ctx)}**`,
  ].filter(Boolean);
  out.push(meta.join(' · '), '');

  out.push('### Requisição', '', headerBlock(requestLine(s, ctx), s.requestHeaders));
  if (s.requestBody) {
    out.push('', 'Corpo enviado:', '');
    if (s.requestBody.note) out.push(`_${s.requestBody.note}_`, '');
    out.push(fence(s.requestBody.text, s.requestBody.language));
  }
  for (const warning of s.warnings) out.push('', `> ⚠️ ${warning}`);

  out.push('', '### Resposta', '');
  if (s.response) {
    const r = s.response;
    out.push(
      include.responseMeta ? `**${r.statusLine}** · ${r.timeMs} ms · ${r.size}` : `**${r.statusLine}**`,
      '',
    );
    if (r.headers.length > 0) out.push(headerBlock(`HTTP ${r.statusLine}`, r.headers), '');
    if (r.body) {
      if (r.body.note) out.push(`_${r.body.note}_`, '');
      if (r.body.text) out.push(fence(r.body.text, r.body.language));
    } else if (include.responseBody) {
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
  const { ctx } = doc;
  const out = [`# ${titleOf(options)}`, '', metaLine(doc).join(' · ')];
  const notes = notesOf(ctx);
  if (notes) out.push('', `## ${notesHeadingOf(ctx)}`, '', notes);
  if (ctx.include.summary && doc.sections.length > 1) {
    const withTime = ctx.include.time;
    out.push(
      '',
      '## Sequência',
      '',
      withTime ? '| # | Horário | Requisição | Resultado |' : '| # | Requisição | Resultado |',
      withTime ? '|---|---|---|---|' : '|---|---|---|',
    );
    for (const s of doc.sections) {
      const req = cell(`${s.name} (${s.method} ${pathOf(s.url)})`);
      out.push(
        withTime
          ? `| ${s.index} | ${time(s.at)} | ${req} | ${cell(outcome(s, ctx))} |`
          : `| ${s.index} | ${req} | ${cell(outcome(s, ctx))} |`,
      );
    }
  }
  for (const s of doc.sections) out.push('', markdownSection(s, ctx));
  if (options.footer.trim()) out.push('', '---', '', `_${options.footer.trim()}_`);
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// HTML (PDF e imagem do relatório completo)

export const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function statusClass(status: number | null): string {
  if (status === null || status >= 500) return 'bad';
  if (status >= 400) return 'warn';
  return 'ok';
}

function htmlPre(text: string, cls = ''): string {
  return `<pre${cls ? ` class="${cls}"` : ''}>${escapeHtml(text)}</pre>`;
}

function htmlHeaders(first: string, headers: readonly [string, string][]): string {
  const rows = headers
    .map(([k, v]) => `<span class="hk">${escapeHtml(k)}:</span> ${escapeHtml(v)}`)
    .join('\n');
  return `<pre><strong>${escapeHtml(first)}</strong>${rows ? `\n${rows}` : ''}</pre>`;
}

function htmlSectionMeta(s: Section, ctx: Context): string {
  const parts = [
    ctx.include.time ? time(s.at) : '',
    s.response && ctx.include.responseMeta ? `${s.response.timeMs} ms · ${s.response.size}` : '',
    s.source === 'mcp' ? 'enviada pelo Claude (MCP)' : '',
  ].filter(Boolean);
  return parts.length > 0 ? `<p class="meta">${escapeHtml(parts.join(' · '))}</p>` : '';
}

function htmlSection(s: Section, ctx: Context): string {
  const status = s.response?.status ?? null;
  const parts = [
    `<section><h2><span class="n">${s.index}</span> ${escapeHtml(s.name)} <span class="chip ${statusClass(status)}">${escapeHtml(s.response?.statusLine ?? 'Sem resposta')}</span></h2>`,
    htmlSectionMeta(s, ctx),
    '<h3>Requisição</h3>',
    htmlHeaders(requestLine(s, ctx), s.requestHeaders),
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
    if (r.headers.length > 0) parts.push(htmlHeaders(`HTTP ${r.statusLine}`, r.headers));
    if (r.body?.note) parts.push(`<p class="note">${escapeHtml(r.body.note)}</p>`);
    if (r.body?.text) parts.push(htmlPre(r.body.text));
    if (!r.body && ctx.include.responseBody) parts.push('<p class="note">Sem corpo.</p>');
    if (!r.body && !ctx.include.responseBody && r.headers.length === 0)
      parts.push(`<p class="label">${escapeHtml(outcome(s, ctx))}</p>`);
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

const BASE_CSS = `
*{box-sizing:border-box}
html{background:#fff}
body{font:13px/1.5 "Segoe UI",system-ui,sans-serif;color:#1f2330;margin:0;padding:28px 34px}
h1{font-size:21px;margin:0 0 4px}
h2{font-size:15px;margin:0 0 2px;display:flex;align-items:center;gap:8px}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#5b6170;margin:14px 0 6px}
pre{background:#f5f6f8;border:1px solid #e3e5ea;border-radius:6px;padding:9px 11px;font:11.5px/1.45 Consolas,"Cascadia Mono",monospace;white-space:pre-wrap;word-break:break-all;margin:0 0 8px}
.hk{color:#5b4bd6}
.meta{color:#6b7180;margin:0}
.label{margin:10px 0 4px;color:#5b6170}
.note{color:#6b7180;font-style:italic;margin:4px 0}
.warning{color:#9a5b00;margin:6px 0}
.n{display:inline-flex;flex:none;width:22px;height:22px;border-radius:50%;background:#ecebfd;color:#4b3fc4;font-size:12px;align-items:center;justify-content:center}
.chip{font-size:11px;font-weight:600;border-radius:999px;padding:1px 8px;white-space:nowrap}
.chip.ok{background:#e3f6ec;color:#17794a}.chip.warn{background:#fdf1dc;color:#93590a}.chip.bad{background:#fde7e7;color:#b42323}
.notes{white-space:pre-wrap;background:#fbfbfd;border-left:3px solid #6d5df5;padding:8px 12px;margin:10px 0}
footer{margin-top:24px;color:#8a8f9c;font-size:11px}
`;

const REPORT_CSS = `
section{border-top:1px solid #e3e5ea;padding-top:16px;margin-top:20px;break-inside:auto}
table{border-collapse:collapse;width:100%;margin:6px 0 4px;font-size:12px}
th,td{border:1px solid #e3e5ea;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#f5f6f8}
`;

// Nada de script, imagem ou recurso externo: é só texto do usuário formatado.
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`;

function htmlDocument(title: string, css: string, body: string[]): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">${CSP}<title>${escapeHtml(title)}</title><style>${BASE_CSS}${css}</style></head><body>${body.join('\n')}</body></html>`;
}

function htmlHead(doc: Doc): string[] {
  const { ctx } = doc;
  const body = [
    `<h1>${escapeHtml(titleOf(ctx.options))}</h1>`,
    `<p class="meta">${escapeHtml(metaLine(doc).join(' · '))}</p>`,
  ];
  const notes = notesOf(ctx);
  if (notes)
    body.push(`<h3>${escapeHtml(notesHeadingOf(ctx))}</h3>`, `<div class="notes">${escapeHtml(notes)}</div>`);
  return body;
}

function htmlFooter(options: EvidenceOptions): string[] {
  return options.footer.trim() ? [`<footer>${escapeHtml(options.footer.trim())}</footer>`] : [];
}

export function renderEvidenceHtml(
  steps: readonly EvidenceStep[],
  options: EvidenceOptions = DEFAULT_EVIDENCE_OPTIONS,
  generatedAt = new Date(),
): string {
  const doc = buildDoc(steps, options, generatedAt);
  const { ctx } = doc;
  const body = htmlHead(doc);
  if (ctx.include.summary && doc.sections.length > 1) {
    const withTime = ctx.include.time;
    body.push(
      `<h3>Sequência</h3><table><tr><th>#</th>${withTime ? '<th>Horário</th>' : ''}<th>Requisição</th><th>Resultado</th></tr>`,
      ...doc.sections.map(
        (s) =>
          `<tr><td>${s.index}</td>${withTime ? `<td>${escapeHtml(time(s.at))}</td>` : ''}<td>${escapeHtml(s.name)}<br><code>${escapeHtml(`${s.method} ${pathOf(s.url)}`)}</code></td><td>${escapeHtml(outcome(s, ctx))}</td></tr>`,
      ),
      '</table>',
    );
  }
  for (const s of doc.sections) body.push(htmlSection(s, ctx));
  body.push(...htmlFooter(options));
  return htmlDocument(titleOf(options), REPORT_CSS, body);
}

// ---------------------------------------------------------------------------
// Cartões resumidos (imagem para colar em chat)

/** Primeiras linhas do corpo, avisando quantas ficaram de fora. */
export function firstLines(text: string, max: number): string {
  const lines = text.split('\n');
  if (lines.length <= max) return text;
  const rest = lines.length - max;
  return `${lines.slice(0, max).join('\n')}\n… mais ${rest} ${rest === 1 ? 'linha' : 'linhas'}`;
}

const CARD_CSS = `
body{padding:22px 24px;background:#fff}
.card{border:1px solid #e3e5ea;border-radius:10px;padding:12px 14px;margin-top:12px}
.card h2{font-size:14px}
.line{font:12px/1.4 Consolas,"Cascadia Mono",monospace;color:#333a4a;margin:6px 0 8px;word-break:break-all}
.line b{color:#4b3fc4}
.cols{display:flex;gap:10px}
.cols>div{flex:1;min-width:0}
.cols pre{font-size:11px;margin:0}
.tag{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#6b7180;margin:0 0 3px}
.hdrs{font:10.5px/1.4 Consolas,monospace;color:#5b6170;margin:0 0 6px;word-break:break-all}
.tests{margin:8px 0 0;font-size:12px;color:#333a4a}
footer{margin-top:14px}
`;

function cardBody(label: string, body: Body | null, lines: number): string {
  if (!body) return '';
  const text = body.text ? firstLines(body.text, lines) : '';
  return `<div><p class="tag">${escapeHtml(label)}</p>${body.note ? `<p class="note">${escapeHtml(body.note)}</p>` : ''}${text ? htmlPre(text) : ''}</div>`;
}

function cardHeaders(label: string, headers: readonly [string, string][]): string {
  if (headers.length === 0) return '';
  return `<p class="tag">${escapeHtml(label)}</p><p class="hdrs">${headers.map(([k, v]) => `<span class="hk">${escapeHtml(k)}:</span> ${escapeHtml(v)}`).join('<br>')}</p>`;
}

function htmlCard(s: Section, ctx: Context): string {
  const status = s.response?.status ?? null;
  const meta = [
    ctx.include.time ? time(s.at) : '',
    s.response && ctx.include.responseMeta ? `${s.response.timeMs} ms` : '',
  ].filter(Boolean);
  const lines = Math.max(3, ctx.options.cardBodyLines);
  const parts = [
    `<div class="card"><h2><span class="n">${s.index}</span> ${escapeHtml(s.name)} <span class="chip ${statusClass(status)}">${escapeHtml(s.response?.statusLine ?? 'Sem resposta')}</span>${meta.length ? ` <span class="meta" style="font-weight:400;font-size:12px">${escapeHtml(meta.join(' · '))}</span>` : ''}</h2>`,
    `<p class="line"><b>${escapeHtml(s.method)}</b> ${escapeHtml(urlFor(s, ctx))}</p>`,
    cardHeaders('Headers enviados', s.requestHeaders),
  ];
  const bodies = [
    cardBody('Enviado', s.requestBody, lines),
    cardBody('Resposta', s.response?.body ?? null, lines),
  ].filter(Boolean);
  if (s.response) parts.push(cardHeaders('Headers da resposta', s.response.headers));
  if (!s.response) parts.push(`<p class="warning">Sem resposta. ${escapeHtml(s.error?.message ?? '')}</p>`);
  if (bodies.length > 0) parts.push(`<div class="cols">${bodies.join('')}</div>`);
  for (const w of s.warnings) parts.push(`<p class="warning">⚠️ ${escapeHtml(w)}</p>`);
  if (s.tests.length > 0) {
    const failed = s.tests.filter((t) => t.status === 'failed');
    const passed = s.tests.filter((t) => t.status === 'passed').length;
    parts.push(
      `<p class="tests">${passed > 0 ? `✅ ${passed} ${passed === 1 ? 'teste passou' : 'testes passaram'}` : ''}${failed.length > 0 ? `${passed > 0 ? ' · ' : ''}❌ ${failed.map((t) => escapeHtml(t.name)).join(', ')}` : ''}</p>`,
    );
  }
  parts.push('</div>');
  return parts.join('');
}

export function renderEvidenceCards(
  steps: readonly EvidenceStep[],
  options: EvidenceOptions = DEFAULT_EVIDENCE_OPTIONS,
  generatedAt = new Date(),
): string {
  const doc = buildDoc(steps, options, generatedAt);
  const body = [...htmlHead(doc), ...doc.sections.map((s) => htmlCard(s, doc.ctx)), ...htmlFooter(options)];
  return htmlDocument(titleOf(options), CARD_CSS, body);
}
