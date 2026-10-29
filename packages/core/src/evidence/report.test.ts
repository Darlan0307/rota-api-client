import { describe, expect, it } from 'vitest';
import type { HttpResponse } from '../http/execute';
import type { PreparedRequest } from '../http/prepare';
import type { RunResult } from '../runner/run-request';
import {
  DEFAULT_EVIDENCE_INCLUDE,
  DEFAULT_EVIDENCE_OPTIONS,
  type EvidenceOptions,
  type EvidenceStep,
  firstLines,
  maskSensitiveFields,
  renderEvidenceCards,
  renderEvidenceHtml,
  renderEvidenceMarkdown,
  sensitiveNamePattern,
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
    ['date', 'Thu, 29 Oct 2026 13:00:00 GMT'],
  ],
  body: { encoding: 'utf8', data: body },
  sizeBytes: body.length,
  timings: { ttfb: 100, download: 12, total: 112.4 },
  truncated: false,
  ...over,
});

let counter = 0;
const step = (name: string, at: string, result: Partial<RunResult>): EvidenceStep => ({
  id: `h${++counter}`,
  name,
  at,
  source: 'app',
  result: { request: request(), response: null, error: null, startedAt: at, ...result },
});

const opts = (over: Partial<EvidenceOptions> = {}, include: Partial<EvidenceOptions['include']> = {}) => ({
  ...DEFAULT_EVIDENCE_OPTIONS,
  ...over,
  include: { ...DEFAULT_EVIDENCE_INCLUDE, ...include },
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
    const md = renderEvidenceMarkdown(
      [criar, login],
      opts(
        {
          title: 'Erro ao criar orçamento',
          notes: 'Depois do login, criar devolve 500.',
          environment: 'Homologação',
        },
        { responseHeaders: true },
      ),
    );
    expect(md).toContain('# Erro ao criar orçamento');
    expect(md).toContain('Ambiente: Homologação');
    expect(md).toContain('## O que aconteceu\n\nDepois do login, criar devolve 500.');
    expect(md.indexOf('## 1. Login')).toBeLessThan(md.indexOf('## 2. Criar orçamento'));
    expect(md).toContain('| 2 |');
    expect(md).toContain('POST https://api.exemplo.com/orcamentos\nContent-Type: application/json');
    expect(md).toContain('**500 Internal Server Error** · 112 ms');
    expect(md).toContain('"erro": "unidade inválida: mg"');
    expect(md).toContain('❌ status 201: esperado 201, veio 500');
    expect(md).toContain('x-request-id: req-123');
    // Headers técnicos ficam de fora por padrão.
    expect(md).not.toContain('date: Thu');
  });

  it('respeita o que foi desmarcado', () => {
    const md = renderEvidenceMarkdown(
      [criar, login],
      opts(
        { notes: 'não deve aparecer', environment: 'Produção' },
        {
          generatedAt: false,
          environment: false,
          notes: false,
          summary: false,
          time: false,
          fullUrl: false,
          requestHeaders: false,
          requestBody: false,
          responseMeta: false,
          responseBody: false,
          tests: false,
        },
      ),
    );
    expect(md).not.toContain('Gerado em');
    expect(md).not.toContain('Produção');
    expect(md).not.toContain('não deve aparecer');
    expect(md).not.toContain('## Sequência');
    expect(md).not.toContain('api.exemplo.com');
    expect(md).toContain('POST /orcamentos');
    expect(md).not.toContain('Content-Type');
    expect(md).not.toContain('João');
    expect(md).not.toContain('112 ms');
    expect(md).not.toContain('unidade inválida');
    expect(md).not.toContain('status 201');
    expect(md).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('usa os textos e nomes escolhidos', () => {
    const md = renderEvidenceMarkdown(
      [login],
      opts({
        notes: 'Algo deu errado',
        notesHeading: 'Descrição do problema',
        footer: 'Enviado por Ana para o suporte.',
        stepNames: { [login.id]: 'Autenticar' },
      }),
    );
    expect(md).toContain('## Descrição do problema');
    expect(md).toContain('## 1. Autenticar');
    expect(md).toContain('_Enviado por Ana para o suporte._');
    expect(renderEvidenceMarkdown([login], opts({ footer: '' }))).not.toContain('---');
  });

  it('mascara token, senha, headers de autenticação e campos extras', () => {
    const md = renderEvidenceMarkdown(
      [
        step('Cadastro', '2026-10-29T13:00:00.000Z', {
          request: request({
            url: 'https://api.exemplo.com/clientes?api_key=chave123&pagina=1',
            headers: [['X-Api-Key', 'chave-de-verdade-123']],
            body: { kind: 'text', text: '{"nome":"Ana","senha":"s3nh@","cpf":"12345678909"}' },
          }),
          response: response(200, '{"access_token":"abc.def.ghi","expires_in":3600}'),
        }),
      ],
      opts({ extraMaskedFields: 'cpf, email' }),
    );
    for (const secret of ['s3nh@', 'abc.def.ghi', 'chave-de-verdade-123', 'chave123', '12345678909'])
      expect(md).not.toContain(secret);
    expect(md).toContain('pagina=1');
    expect(md).toContain('"expires_in": 3600');
    expect(md).toContain('"nome": "Ana"');
  });

  it('sem a máscara de sensíveis, mostra os valores que não são variáveis secretas', () => {
    const md = renderEvidenceMarkdown([login], opts({ maskSensitive: false }));
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
      opts({}, { curl: true }),
    );
    expect(md).toContain('**Sem resposta.** Nada respondeu em api.exemplo.com:443.');
    expect(md).toContain("curl 'https://api.exemplo.com/orcamentos'");
    expect(md).toContain("-H 'Authorization: Bearer ••••••'");
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
      opts({ maxBodyChars: 500 }),
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

describe('máscaras', () => {
  it('mascara campos sensíveis em JSON e urlencoded', () => {
    expect(maskSensitiveFields('{"password": "x1", "nome": "Ana", "refresh_token": "r"}')).toBe(
      '{"password": "••••••", "nome": "Ana", "refresh_token": "••••••"}',
    );
    expect(maskSensitiveFields('grant_type=password&client_secret=abc&username=ana')).toBe(
      'grant_type=password&client_secret=••••••&username=ana',
    );
    expect(maskSensitiveFields('texto qualquer')).toBe('texto qualquer');
  });

  it('aceita campos extras e números', () => {
    const pattern = sensitiveNamePattern('cpf; cartao.numero');
    expect(maskSensitiveFields('{"cpf": 12345678909, "nome": "Ana"}', pattern)).toBe(
      '{"cpf": "••••••", "nome": "Ana"}',
    );
    expect(pattern.test('cartao.numero')).toBe(true);
    expect(pattern.test('cartaoXnumero')).toBe(false);
  });
});

describe('HTML e cartões', () => {
  it('gera um documento completo, sem scripts, e escapa o conteúdo', () => {
    const html = renderEvidenceHtml([
      step('<script>', '2026-10-29T13:00:00.000Z', { response: response(200, '{"a":"<b>"}') }),
    ]);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;a&quot;: &quot;&lt;b&gt;&quot;');
  });

  it('cartões resumem cada envio e cortam os corpos', () => {
    const long = JSON.stringify(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`campo${i}`, i])));
    const html = renderEvidenceCards(
      [login, step('Lista', '2026-10-29T13:00:09.000Z', { response: response(200, long) })],
      opts({ cardBodyLines: 5 }),
    );
    expect(html.match(/class="card"/g)).toHaveLength(2);
    expect(html).toContain('… mais');
    expect(html).not.toContain('campo30');
    expect(html).not.toContain('s3nh@');
    expect(html).toContain('Login');
  });

  it('firstLines avisa quantas linhas ficaram de fora', () => {
    expect(firstLines('a\nb\nc', 2)).toBe('a\nb\n… mais 1 linha');
    expect(firstLines('a\nb', 2)).toBe('a\nb');
  });
});
