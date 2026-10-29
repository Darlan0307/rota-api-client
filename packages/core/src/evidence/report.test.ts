import { describe, expect, it } from 'vitest';
import type { HttpResponse } from '../http/execute';
import type { PreparedRequest } from '../http/prepare';
import type { RunResult } from '../runner/run-request';
import {
  DEFAULT_EVIDENCE_OPTIONS,
  type EvidenceStep,
  maskSensitiveFields,
  renderEvidenceHtml,
  renderEvidenceMarkdown,
} from './report';

const request = (over: Partial<PreparedRequest> = {}): PreparedRequest => ({
  method: 'POST',
  url: 'https://api.exemplo.com/orcamentos',
  headers: [
    ['Content-Type', 'application/json'],
    ['Authorization', 'Bearer ••••••'],
  ],
  body: { kind: 'text', text: '{"cliente":"João da Conceição","valor":120.5}' },
  settings: { timeoutMs: 30000, followRedirects: true, verifySsl: true },
  ...over,
});

const response = (status: number, body: string, over: Partial<HttpResponse> = {}): HttpResponse => ({
  status,
  statusText: status === 200 ? 'OK' : 'Internal Server Error',
  headers: [
    ['content-type', 'application/json; charset=utf-8'],
    ['x-request-id', 'req-123'],
  ],
  body: { encoding: 'utf8', data: body },
  sizeBytes: body.length,
  timings: { ttfb: 100, download: 12, total: 112.4 },
  truncated: false,
  ...over,
});

const step = (name: string, at: string, result: Partial<RunResult>): EvidenceStep => ({
  name,
  at,
  source: 'app',
  result: { request: request(), response: null, error: null, startedAt: at, ...result },
});

const login = step('Login', '2026-10-29T13:00:00.000Z', {
  request: request({
    url: 'https://api.exemplo.com/auth/login',
    headers: [['Content-Type', 'application/json']],
    body: { kind: 'text', text: '{"usuario":"ana","senha":"s3nh@"}' },
  }),
  response: response(200, '{"access_token":"abc.def.ghi","expires_in":3600}'),
});
const criar = step('Criar orçamento', '2026-10-29T13:00:05.000Z', {
  response: response(500, '{"erro":"unidade inválida: mg"}'),
  tests: [
    {
      name: 'status 201',
      status: 'failed',
      message: 'esperado 201, veio 500',
      phase: 'post',
      sourceKind: 'request',
      source: 'Criar orçamento',
    },
  ],
});

describe('renderEvidenceMarkdown', () => {
  it('monta a sequência em ordem de envio, com requisição, resposta e testes', () => {
    const md = renderEvidenceMarkdown([criar, login], {
      ...DEFAULT_EVIDENCE_OPTIONS,
      title: 'Erro ao criar orçamento',
      notes: 'Depois do login, criar orçamento devolve 500.',
      environment: 'Homologação',
    });
    expect(md).toContain('# Erro ao criar orçamento');
    expect(md).toContain('**Ambiente:** Homologação');
    expect(md).toContain('## O que aconteceu\n\nDepois do login, criar orçamento devolve 500.');
    expect(md.indexOf('## 1. Login')).toBeLessThan(md.indexOf('## 2. Criar orçamento'));
    expect(md).toContain('| 2 |');
    expect(md).toContain('POST https://api.exemplo.com/orcamentos\nContent-Type: application/json');
    expect(md).toContain('**500 Internal Server Error** · 112 ms');
    expect(md).toContain('"erro": "unidade inválida: mg"');
    expect(md).toContain('❌ status 201: esperado 201, veio 500');
    expect(md).toContain('x-request-id: req-123');
  });

  it('mascara token e senha nos corpos e headers de autenticação digitados', () => {
    const md = renderEvidenceMarkdown([
      step('Login', '2026-10-29T13:00:00.000Z', {
        request: request({
          headers: [['X-Api-Key', 'chave-de-verdade-123']],
          body: { kind: 'text', text: '{"usuario":"ana","senha":"s3nh@"}' },
        }),
        response: response(200, '{"access_token":"abc.def.ghi","expires_in":3600}'),
      }),
    ]);
    expect(md).not.toContain('s3nh@');
    expect(md).not.toContain('abc.def.ghi');
    expect(md).not.toContain('chave-de-verdade-123');
    expect(md).toContain('"expires_in": 3600');
    expect(md).toContain('"usuario": "ana"');
  });

  it('sem a máscara de sensíveis, mostra os valores que não são variáveis secretas', () => {
    const md = renderEvidenceMarkdown([login], { ...DEFAULT_EVIDENCE_OPTIONS, maskSensitive: false });
    expect(md).toContain('abc.def.ghi');
  });

  it('mostra o erro quando não houve resposta e gera o cURL quando pedido', () => {
    const md = renderEvidenceMarkdown(
      [
        step('Consultar', '2026-10-29T13:00:00.000Z', {
          request: request({ method: 'GET', body: { kind: 'none' } }),
          error: { code: 'refused', message: 'Nada respondeu em api.exemplo.com:443.' },
        }),
      ],
      { ...DEFAULT_EVIDENCE_OPTIONS, curl: true },
    );
    expect(md).toContain('**Sem resposta.** Nada respondeu em api.exemplo.com:443.');
    expect(md).toContain("curl 'https://api.exemplo.com/orcamentos'");
    expect(md).toContain("-H 'Authorization: Bearer ••••••'");
    expect(md).not.toContain('## Sequência');
  });

  it('corta corpo grande e não inclui corpo binário', () => {
    const big = JSON.stringify({ itens: Array.from({ length: 2000 }, (_, i) => ({ id: i })) });
    const md = renderEvidenceMarkdown(
      [
        step('Lista', '2026-10-29T13:00:00.000Z', { response: response(200, big) }),
        step('Imagem', '2026-10-29T13:00:01.000Z', {
          response: response(200, '', {
            headers: [['content-type', 'image/png']],
            body: { encoding: 'base64', data: 'iVBORw0KGgo=' },
            sizeBytes: 2048,
          }),
        }),
      ],
      { ...DEFAULT_EVIDENCE_OPTIONS, maxBodyChars: 500 },
    );
    expect(md).toMatch(/Corpo cortado: mostra 500 de [\d.]+ caracteres/);
    expect(md).toContain('Corpo binário (image/png, 2,0 KB): não incluído.');
    expect(md).not.toContain('iVBORw0KGgo=');
  });

  it('mantém números grandes do JSON como vieram', () => {
    const md = renderEvidenceMarkdown([
      step('Id', '2026-10-29T13:00:00.000Z', { response: response(200, '{"id":12345678901234567890}') }),
    ]);
    expect(md).toContain('"id": 12345678901234567890');
  });
});

describe('maskSensitiveFields', () => {
  it('mascara campos sensíveis em JSON e urlencoded', () => {
    expect(maskSensitiveFields('{"password": "x1", "nome": "Ana", "refresh_token": "r"}')).toBe(
      '{"password": "••••••", "nome": "Ana", "refresh_token": "••••••"}',
    );
    expect(maskSensitiveFields('grant_type=password&client_secret=abc&username=ana')).toBe(
      'grant_type=password&client_secret=••••••&username=ana',
    );
    expect(maskSensitiveFields('texto qualquer')).toBe('texto qualquer');
  });
});

describe('renderEvidenceHtml', () => {
  it('gera um documento completo e escapa o conteúdo', () => {
    const html = renderEvidenceHtml([
      step('<script>', '2026-10-29T13:00:00.000Z', { response: response(200, '{"a":"<b>"}') }),
    ]);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;a&quot;: &quot;&lt;b&gt;&quot;');
  });
});
