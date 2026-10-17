import { describe, expect, it } from 'vitest';
import type { PreparedRequest } from '../http/prepare';
import { generateCode, shellQuote } from './codegen';

const settings = { timeoutMs: 30000, followRedirects: true, verifySsl: true };

const post: PreparedRequest = {
  method: 'POST',
  url: 'https://api.dev/users?x=1',
  headers: [
    ['Authorization', 'Bearer ••••••'],
    ['Content-Type', 'application/json'],
  ],
  body: { kind: 'text', text: '{"nome":"O\'Brien"}' },
  settings,
};

describe('shellQuote', () => {
  it('escapa aspas simples para o bash', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe('generateCode', () => {
  it('gera cURL com headers, body e flags', () => {
    expect(generateCode(post, 'curl')).toBe(
      [
        `curl -X POST 'https://api.dev/users?x=1'`,
        `-H 'Authorization: Bearer ••••••'`,
        `-H 'Content-Type: application/json'`,
        `--data-raw '{"nome":"O'\\''Brien"}'`,
        '--location',
      ].join(' \\\n  '),
    );
  });

  it('gera cURL de GET simples e form-data com arquivo', () => {
    expect(
      generateCode({ method: 'GET', url: 'http://x', headers: [], body: { kind: 'none' }, settings }, 'curl'),
    ).toBe(`curl 'http://x' \\\n  --location`);
    const form = generateCode(
      {
        method: 'POST',
        url: 'http://x',
        headers: [],
        body: {
          kind: 'formdata',
          fields: [
            { key: 'nome', type: 'text', value: 'a' },
            { key: 'foto', type: 'file', value: 'C:/f.png' },
          ],
        },
        settings: { ...settings, verifySsl: false, followRedirects: false },
      },
      'curl',
    );
    expect(form).toContain(`-F 'nome=a'`);
    expect(form).toContain(`-F 'foto=@C:/f.png'`);
    expect(form).toContain('--insecure');
    expect(form).not.toContain('--location');
  });

  it('gera fetch com JSON legível', () => {
    const code = generateCode(post, 'fetch');
    expect(code).toContain(`const response = await fetch("https://api.dev/users?x=1", {`);
    expect(code).toContain(`"Authorization": "Bearer ••••••",`);
    expect(code).toContain('body: JSON.stringify({\n    "nome": "O\'Brien"\n  }),');
  });

  it('gera axios e omite Content-Type em form-data (o FormData define)', () => {
    const code = generateCode(
      {
        method: 'PUT',
        url: 'http://x',
        headers: [['Content-Type', 'multipart/form-data']],
        body: { kind: 'formdata', fields: [{ key: 'a', type: 'text', value: '1' }] },
        settings,
      },
      'axios',
    );
    expect(code).toContain(`method: "put",`);
    expect(code).toContain(`form.append("a", "1");`);
    expect(code).toContain('data: form,');
    expect(code).not.toContain('multipart/form-data');
  });
});
