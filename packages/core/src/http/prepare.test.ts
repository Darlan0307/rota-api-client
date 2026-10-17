import { describe, expect, it } from 'vitest';
import { RequestDataSchema } from '../model/schemas';
import { SECRET_MASK, VariableScope } from '../variables/template';
import { findHeader, prepareRequest } from './prepare';

const scope = new VariableScope([
  {
    source: 'environment',
    variables: [
      { key: 'base', value: 'api.local/v1' },
      { key: 'token', value: 'tok-secreto', secret: true },
      { key: 'user', value: 'ana' },
      { key: 'id', value: '42' },
    ],
  },
]);

const make = (data: unknown) => RequestDataSchema.parse(data);
const opts = { scope, auth: { type: 'none' } as const, defaultTimeoutMs: 30_000 };

describe('prepareRequest', () => {
  it('resolve URL, query e headers, ignorando desabilitados', () => {
    const p = prepareRequest(
      make({
        url: '{{base}}/users/{{id}}',
        query: [
          { key: 'expand', value: 'true' },
          { key: 'debug', value: '1', enabled: false },
        ],
        headers: [
          { key: 'X-User', value: '{{user}}' },
          { key: 'X-Off', value: 'x', enabled: false },
        ],
      }),
      opts,
    );
    expect(p.url).toBe('http://api.local/v1/users/42?expand=true');
    expect(findHeader(p.headers, 'x-user')).toBe('ana');
    expect(findHeader(p.headers, 'x-off')).toBeUndefined();
    expect(p.settings).toEqual({ timeoutMs: 30_000, followRedirects: true, verifySsl: true });
  });

  it('aplica bearer, basic e api key', () => {
    const bearer = prepareRequest(make({ url: 'http://x' }), {
      ...opts,
      auth: { type: 'bearer', token: '{{token}}' },
    });
    expect(findHeader(bearer.headers, 'authorization')).toBe('Bearer tok-secreto');

    const basic = prepareRequest(make({ url: 'http://x' }), {
      ...opts,
      auth: { type: 'basic', username: '{{user}}', password: 'pw' },
    });
    expect(findHeader(basic.headers, 'authorization')).toBe(
      `Basic ${Buffer.from('ana:pw').toString('base64')}`,
    );

    const keyQuery = prepareRequest(make({ url: 'http://x' }), {
      ...opts,
      auth: { type: 'apikey', key: 'api_key', value: '{{id}}', in: 'query' },
    });
    expect(keyQuery.url).toBe('http://x?api_key=42');

    const keyHeader = prepareRequest(make({ url: 'http://x' }), {
      ...opts,
      auth: { type: 'apikey', key: 'X-Key', value: 'k', in: 'header' },
    });
    expect(findHeader(keyHeader.headers, 'x-key')).toBe('k');
  });

  it('header Authorization manual tem precedência sobre a auth', () => {
    const p = prepareRequest(
      make({ url: 'http://x', headers: [{ key: 'Authorization', value: 'Custom 1' }] }),
      {
        ...opts,
        auth: { type: 'bearer', token: 't' },
      },
    );
    expect(p.headers.filter(([k]) => k.toLowerCase() === 'authorization')).toEqual([
      ['Authorization', 'Custom 1'],
    ]);
  });

  it('mascara segredos na versão de exibição', () => {
    const data = make({ url: 'http://x' });
    const masked = prepareRequest(data, {
      ...opts,
      auth: { type: 'bearer', token: '{{token}}' },
      maskSecrets: true,
    });
    expect(findHeader(masked.headers, 'authorization')).toBe(`Bearer ${SECRET_MASK}`);
    const basic = prepareRequest(data, {
      ...opts,
      auth: { type: 'basic', username: 'a', password: '{{token}}' },
      maskSecrets: true,
    });
    expect(findHeader(basic.headers, 'authorization')).toBe(`Basic ${SECRET_MASK}`);
  });

  it('define o Content-Type conforme o body, sem sobrescrever o do usuário', () => {
    const json = prepareRequest(
      make({ url: 'http://x', body: { mode: 'json', text: '{"id":"{{id}}"}' } }),
      opts,
    );
    expect(json.body).toEqual({ kind: 'text', text: '{"id":"42"}' });
    expect(findHeader(json.headers, 'content-type')).toBe('application/json');

    const form = prepareRequest(
      make({
        url: 'http://x',
        body: {
          mode: 'urlencoded',
          fields: [
            { key: 'nome', value: 'José & Cia' },
            { key: 'x', enabled: false },
          ],
        },
      }),
      opts,
    );
    expect(form.body).toEqual({ kind: 'text', text: 'nome=Jos%C3%A9%20%26%20Cia' });
    expect(findHeader(form.headers, 'content-type')).toBe('application/x-www-form-urlencoded');

    const custom = prepareRequest(
      make({
        url: 'http://x',
        headers: [{ key: 'content-type', value: 'application/vnd.api+json' }],
        body: { mode: 'json', text: '{}' },
      }),
      opts,
    );
    expect(custom.headers.filter(([k]) => k.toLowerCase() === 'content-type')).toHaveLength(1);
  });

  it('mantém caminhos de arquivo no form-data e resolve os textos', () => {
    const p = prepareRequest(
      make({
        url: 'http://x',
        body: {
          mode: 'formdata',
          fields: [
            { key: 'nome', value: '{{user}}' },
            { key: 'foto', type: 'file', value: 'C:/fotos/{{id}}.png' },
          ],
        },
      }),
      opts,
    );
    expect(p.body).toEqual({
      kind: 'formdata',
      fields: [
        { key: 'nome', type: 'text', value: 'ana' },
        { key: 'foto', type: 'file', value: 'C:/fotos/{{id}}.png' },
      ],
    });
  });

  it('acrescenta headers padrão sem duplicar', () => {
    const p = prepareRequest(
      make({ url: 'http://x', headers: [{ key: 'accept', value: 'application/json' }] }),
      opts,
    );
    expect(findHeader(p.headers, 'user-agent')).toBe('Rota');
    expect(p.headers.filter(([k]) => k.toLowerCase() === 'accept')).toEqual([['accept', 'application/json']]);
  });
});
