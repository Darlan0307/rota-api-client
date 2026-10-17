import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type RequestNode, walkTree } from '../model/tree';
import { MemorySecretStore } from '../secrets/secret-store';
import { WorkspaceStore } from '../storage/workspace-store';
import { importPostmanFiles, previewPostmanFiles } from './import-postman';
import { convertCollection, convertEnvironment, detectPostmanFile, looksSensitive } from './postman';

const collection = {
  info: {
    _postman_id: 'x',
    name: 'Loja',
    description: 'API da loja',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{TOKEN}}', type: 'string' }] },
  variable: [
    { key: 'base', value: 'https://api.loja', type: 'string' },
    { key: 'clientSecret', value: 'abc', type: 'secret' },
  ],
  event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: ['console.log("coleção")'] } }],
  item: [
    {
      name: 'Auth',
      auth: { type: 'noauth' },
      item: [
        {
          name: 'Login',
          event: [
            {
              listen: 'test',
              script: {
                exec: [
                  'pm.environment.set("TOKEN", pm.response.json().access_token);',
                  'pm.sendRequest("x")',
                ],
              },
            },
          ],
          request: {
            method: 'POST',
            header: [{ key: 'X-Off', value: '1', disabled: true }],
            body: {
              mode: 'urlencoded',
              urlencoded: [
                { key: 'user', value: 'ana' },
                { key: 'pass', value: '{{SENHA}}' },
              ],
            },
            url: { raw: '{{base}}/login', host: ['{{base}}'], path: ['login'] },
          },
          response: [
            {
              name: 'Sucesso',
              originalRequest: { method: 'POST', header: [], url: { raw: '{{base}}/login?x=1' } },
              status: 'OK',
              code: 200,
              header: [{ key: 'content-type', value: 'application/json' }],
              body: '{\r\n  "access_token": "t"\r\n}',
            },
          ],
        },
      ],
    },
    {
      name: 'Produto',
      protocolProfileBehavior: { followRedirects: false, strictSSL: false, maxRedirects: 3 },
      request: {
        method: 'GET',
        header: [],
        url: {
          raw: '{{base}}/produtos/:id?ativo=true&{{$randomInt}}',
          host: ['{{base}}'],
          path: ['produtos', ':id'],
          query: [
            { key: 'ativo', value: 'true' },
            { key: 'debug', value: '1', disabled: true },
            { key: 'seed', value: '{{$randomInt}}' },
            { key: 'nome', value: '{{$randomBitcoin}}' },
          ],
          variable: [{ key: 'id', value: '42' }],
        },
        auth: { type: 'oauth2', oauth2: [] },
        body: { mode: 'raw', raw: '{\r\n"a":1\r\n}', options: { raw: { language: 'json' } } },
      },
    },
    {
      name: 'GraphQL',
      request: {
        method: 'POST',
        url: '{{base}}/graphql',
        body: { mode: 'graphql', graphql: { query: '{ me { id } }', variables: '{"a":1}' } },
      },
    },
    {
      name: 'Upload',
      request: {
        method: 'POST',
        url: '{{base}}/upload',
        body: {
          mode: 'formdata',
          formdata: [
            { key: 'arquivo', type: 'file', src: ['C:/a.png', 'C:/b.png'] },
            { key: 'nome', type: 'text', value: 'foto' },
          ],
        },
      },
    },
  ],
};

describe('detectPostmanFile', () => {
  it('reconhece coleção, ambiente e globais', () => {
    expect(detectPostmanFile(collection)).toMatchObject({ kind: 'collection', version: '2.1', name: 'Loja' });
    expect(detectPostmanFile({ name: 'Dev', values: [], _postman_variable_scope: 'environment' }).kind).toBe(
      'environment',
    );
    expect(detectPostmanFile({ values: [], _postman_variable_scope: 'globals' }).kind).toBe('globals');
    expect(detectPostmanFile({ foo: 1 }).kind).toBe('unknown');
  });
});

describe('convertCollection', () => {
  const {
    collection: result,
    warnings,
    counts,
  } = convertCollection(collection, { secretKeys: new Set(['base']) });
  const requests = result.children.flatMap((c) => (c.kind === 'folder' ? c.children : [c]));
  const byName = (name: string) => {
    const r = requests.find((c) => c.name === name);
    if (r?.kind !== 'request') throw new Error(name);
    return r;
  };

  it('preserva estrutura, auth da coleção, variáveis e scripts', () => {
    expect(counts).toEqual({ folders: 1, requests: 4, examples: 1, variables: 2, secrets: 2 });
    expect(result.auth).toEqual({ type: 'bearer', token: '{{TOKEN}}' });
    expect(result.description).toBe('API da loja');
    expect(result.variables).toEqual([
      { key: 'base', type: 'secret', enabled: true, value: 'https://api.loja' },
      { key: 'clientSecret', type: 'secret', enabled: true, value: 'abc' },
    ]);
    expect(result.scripts.preRequest).toBe('console.log("coleção")');
    expect(result.children[0]).toMatchObject({ kind: 'folder', name: 'Auth', auth: { type: 'none' } });
  });

  it('converte requisição com urlencoded, script de teste e exemplo', () => {
    const login = byName('Login');
    expect(login.data).toMatchObject({
      method: 'POST',
      url: '{{base}}/login',
      auth: { type: 'inherit' },
      headers: [{ key: 'X-Off', value: '1', enabled: false }],
      body: {
        mode: 'urlencoded',
        fields: [
          { key: 'user', value: 'ana' },
          { key: 'pass', value: '{{SENHA}}' },
        ],
      },
    });
    expect(login.data.scripts.postResponse).toContain('pm.environment.set("TOKEN"');
    expect(login.examples).toEqual([
      {
        name: 'Sucesso',
        request: { method: 'POST', url: '{{base}}/login?x=1', headers: [] },
        response: {
          status: 200,
          statusText: 'OK',
          headers: [{ key: 'content-type', value: 'application/json', enabled: true }],
          body: '{\n  "access_token": "t"\n}',
        },
      },
    ]);
  });

  it('trata variáveis de caminho, query desabilitada, protocolo e JSON', () => {
    const produto = byName('Produto').data;
    expect(produto.url).toBe('{{base}}/produtos/42');
    expect(produto.query).toEqual([
      { key: 'ativo', value: 'true', enabled: true },
      { key: 'debug', value: '1', enabled: false },
      { key: 'seed', value: '{{$randomInt}}', enabled: true },
      { key: 'nome', value: '{{$randomBitcoin}}', enabled: true },
    ]);
    expect(produto.body).toEqual({ mode: 'json', text: '{\n"a":1\n}' });
    expect(produto.settings).toMatchObject({ followRedirects: false, verifySsl: false });
    expect(produto.auth).toEqual({ type: 'none' });
  });

  it('converte GraphQL para JSON e limita form-data a um arquivo', () => {
    expect(JSON.parse((byName('GraphQL').data.body as { text: string }).text)).toEqual({
      query: '{ me { id } }',
      variables: { a: 1 },
    });
    expect(byName('Upload').data.body).toEqual({
      mode: 'formdata',
      fields: [
        { key: 'arquivo', type: 'file', value: 'C:/a.png', enabled: true },
        { key: 'nome', type: 'text', value: 'foto', enabled: true },
      ],
    });
  });

  it('gera um aviso para cada coisa não suportada', () => {
    const messages = warnings.map((w) => `${w.path}: ${w.message}`);
    const expectWarning = (pattern: RegExp) => expect(messages.some((m) => pattern.test(m))).toBe(true);
    expectWarning(/Login: O script usa recursos não suportados: pm\.sendRequest/);
    expectWarning(/Produto: Variáveis de caminho \(:id\) foram substituídas/);
    expectWarning(/Produto: Autenticação "oauth2" não é suportada/);
    expectWarning(/Produto: Configuração "maxRedirects"/);
    expectWarning(/Produto: A variável dinâmica \{\{\$randomBitcoin\}\} não é gerada/);
    expectWarning(/GraphQL: Body GraphQL convertido/);
    expectWarning(/Upload: O campo "arquivo" tinha 2 arquivos/);
    // $randomInt é suportado; não deve gerar aviso de variável dinâmica.
    expect(messages.some((m) => m.includes('{{$randomInt}} não é gerada'))).toBe(false);
  });
});

describe('convertEnvironment', () => {
  it('importa variáveis secretas e respeita "enabled"', () => {
    const env = convertEnvironment({
      name: 'Hml',
      values: [
        { key: 'URL', value: 'https://hml', type: 'default', enabled: true },
        { key: 'TOKEN', value: 'jwt', type: 'secret', enabled: true },
        { key: 'OFF', value: 'x', enabled: false },
      ],
      _postman_variable_scope: 'environment',
    });
    expect(env.variables).toEqual([
      { key: 'URL', type: 'default', enabled: true, value: 'https://hml' },
      { key: 'TOKEN', type: 'secret', enabled: true, value: 'jwt' },
      { key: 'OFF', type: 'default', enabled: false, value: 'x' },
    ]);
    expect(env.counts.secrets).toBe(1);
  });

  it('sugere nomes sensíveis', () => {
    expect(looksSensitive('ACCESS_TOKEN')).toBe(true);
    expect(looksSensitive('PASSWORD')).toBe(true);
    expect(looksSensitive('SENHA_FAKE')).toBe(true);
    expect(looksSensitive('URL_BASE')).toBe(false);
  });
});

describe('importPostmanFiles', () => {
  let root: string;
  let secrets: MemorySecretStore;
  let store: WorkspaceStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'rota-import-'));
    secrets = new MemorySecretStore();
    store = await WorkspaceStore.open(root, { secrets });
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('grava coleção e ambiente, com segredos fora dos arquivos', async () => {
    const report = await importPostmanFiles(
      store,
      [
        { fileName: 'loja.json', content: JSON.stringify(collection) },
        {
          fileName: 'env.json',
          content: JSON.stringify({
            name: 'Hml',
            values: [{ key: 'PASSWORD', value: 'p@ss', type: 'default', enabled: true }],
            _postman_variable_scope: 'environment',
          }),
        },
        { fileName: 'lixo.json', content: '{ nada' },
      ],
      { secretKeys: { 'env.json': ['PASSWORD'] } },
    );

    expect(report.items.map((i) => [i.kind, i.name, i.error ?? null])).toEqual([
      ['collection', 'Loja', null],
      ['environment', 'Hml', null],
      ['unknown', 'lixo.json', expect.stringMatching(/JSON inválido/)],
    ]);

    const snap = store.snapshot();
    const names = [...walkTree(snap.collections)].map((n) => n.name);
    expect(names).toEqual(['Loja', 'Auth', 'Login', 'Produto', 'GraphQL', 'Upload']);
    const login = [...walkTree(snap.collections)].find(
      (n): n is RequestNode => n.name === 'Login' && n.kind === 'request',
    );
    expect(login?.examples.map((e) => e.name)).toEqual(['Sucesso']);

    const files = (await readdir(join(root, 'collections', 'loja', 'auth'))).sort();
    expect(files).toEqual(['_folder.json', 'login.examples', 'login.req.json']);

    const envFile = await readFile(join(root, 'environments', 'hml.env.json'), 'utf8');
    expect(envFile).not.toContain('p@ss');
    const colFile = await readFile(join(root, 'collections', 'loja', '_collection.json'), 'utf8');
    expect(colFile).not.toContain('"abc"');
    expect(secrets.allValues().sort()).toEqual(['abc', 'p@ss']);
  });

  it('mostra a prévia sem gravar nada', () => {
    const preview = previewPostmanFiles([{ fileName: 'loja.json', content: JSON.stringify(collection) }]);
    expect(preview[0]).toMatchObject({ kind: 'collection', name: 'Loja', counts: { requests: 4 } });
    expect(store.snapshot().collections).toEqual([]);
  });
});

// Exportações reais em ex-export/ (fora do Git). Roda só quando a pasta existe.
const REAL_DIR = join(import.meta.dirname, '../../../../ex-export');
const realFiles = existsSync(REAL_DIR) ? readdirSync(REAL_DIR).filter((f) => f.endsWith('.json')) : [];

describe.skipIf(realFiles.length === 0)('exportações reais (ex-export)', () => {
  it.each(realFiles)('%s: lê sem erros nem recursos não suportados', (fileName) => {
    const content = readFileSync(join(REAL_DIR, fileName), 'utf8');
    const [preview] = previewPostmanFiles([{ fileName, content }]);
    expect(preview?.kind).not.toBe('unknown');
    if (preview?.kind === 'collection') {
      const { warnings } = convertCollection(JSON.parse(content));
      expect(warnings.filter((w) => /não suportad/.test(w.message))).toEqual([]);
    }
  });
});
