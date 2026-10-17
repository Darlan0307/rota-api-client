import { describe, expect, it } from 'vitest';
import { generateCode } from '../codegen/codegen';
import { prepareRequest } from '../http/prepare';
import { VariableScope } from '../variables/template';
import { looksLikeCurl, parseCurl, tokenize } from './parse-curl';

describe('tokenize', () => {
  it('respeita aspas, escapes e continuação de linha', () => {
    expect(tokenize(`curl 'a b' "c \\"d\\"" e\\ f \\\n -H $'x\\ny'`)).toEqual([
      'curl',
      'a b',
      'c "d"',
      'e f',
      '-H',
      'x\ny',
    ]);
  });
});

describe('parseCurl', () => {
  it('reconhece comandos cURL', () => {
    expect(looksLikeCurl('  curl https://x')).toBe(true);
    expect(looksLikeCurl('curl.exe https://x')).toBe(true);
    expect(looksLikeCurl('https://x')).toBe(false);
  });

  it('converte o "Copy as cURL (bash)" do navegador', () => {
    const { data, warnings } = parseCurl(`curl 'https://api.loja.com/v1/pedidos?page=2&sort=-data' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer abc.def' \\
  -H 'content-type: application/json' \\
  --data-raw '{"itens":[1,2]}' \\
  --compressed`);
    expect(warnings).toEqual([]);
    expect(data.method).toBe('POST');
    expect(data.url).toBe('https://api.loja.com/v1/pedidos');
    expect(data.query).toEqual([
      { key: 'page', value: '2', enabled: true },
      { key: 'sort', value: '-data', enabled: true },
    ]);
    expect(data.headers.map((h) => h.key)).toEqual(['accept', 'authorization', 'content-type']);
    expect(data.body).toEqual({ mode: 'json', text: '{\n  "itens": [\n    1,\n    2\n  ]\n}' });
  });

  it('converte o formato cmd do Windows', () => {
    const { data } = parseCurl(`curl ^"https://x.com/a?b=1^" ^
  -H ^"accept: */*^" ^
  -X PUT`);
    expect(data).toMatchObject({
      method: 'PUT',
      url: 'https://x.com/a',
      headers: [{ key: 'accept', value: '*/*' }],
    });
  });

  it('usa x-www-form-urlencoded para -d sem Content-Type', () => {
    const { data } = parseCurl(
      `curl https://x/token -d 'grant_type=password&username=ana%40x.com' --data-urlencode 'senha=a b'`,
    );
    expect(data.method).toBe('POST');
    expect(data.body).toEqual({
      mode: 'urlencoded',
      fields: [
        { key: 'grant_type', value: 'password', enabled: true },
        { key: 'username', value: 'ana@x.com', enabled: true },
        { key: 'senha', value: 'a b', enabled: true },
      ],
    });
  });

  it('suporta -F, -u, -k, -G, -I e --json', () => {
    const form = parseCurl(`curl -F 'nome=Ana' -F 'foto=@/tmp/f.png;type=image/png' https://x/up`).data;
    expect(form.body).toEqual({
      mode: 'formdata',
      fields: [
        { key: 'nome', value: 'Ana', type: 'text', enabled: true },
        { key: 'foto', value: '/tmp/f.png', type: 'file', enabled: true },
      ],
    });

    const auth = parseCurl(`curl -k -u admin:s3nha https://x`).data;
    expect(auth.auth).toEqual({ type: 'basic', username: 'admin', password: 's3nha' });
    expect(auth.settings.verifySsl).toBe(false);

    const get = parseCurl(`curl -G https://x/busca -d q=rota -d limit=5`).data;
    expect(get.method).toBe('GET');
    expect(get.query.map((q) => `${q.key}=${q.value}`)).toEqual(['q=rota', 'limit=5']);

    expect(parseCurl('curl -I https://x').data.method).toBe('HEAD');

    const json = parseCurl(`curl --json '{"a":1}' https://x`).data;
    expect(json.body.mode).toBe('json');
    expect(json.headers).toEqual([{ key: 'Content-Type', value: 'application/json', enabled: true }]);
  });

  it('avisa sobre opções ignoradas e falha sem URL', () => {
    expect(parseCurl('curl -o saida.txt --foo https://x').warnings).toEqual(['Opções ignoradas: -o, --foo.']);
    expect(() => parseCurl('curl -H "a: b"')).toThrow(/URL/);
  });

  it('é o inverso do gerador de cURL', () => {
    const original = parseCurl(
      `curl -X PATCH 'https://x/a?b=1' -H 'Content-Type: application/json' --data-raw '{"c":2}'`,
    ).data;
    const prepared = prepareRequest(original, {
      scope: new VariableScope([]),
      auth: { type: 'none' },
      defaultTimeoutMs: 0,
      defaultHeaders: false,
    });
    const again = parseCurl(generateCode(prepared, 'curl')).data;
    expect(again).toMatchObject({
      method: 'PATCH',
      url: 'https://x/a',
      query: original.query,
      body: original.body,
    });
  });
});
