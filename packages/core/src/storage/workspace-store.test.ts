import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findNode, walkTree } from '../model/tree';
import { MemorySecretStore } from '../secrets/secret-store';
import { VariableScope } from '../variables/template';
import { WorkspaceError, WorkspaceStore } from './workspace-store';

let root: string;
let secrets: MemorySecretStore;
let store: WorkspaceStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rota-ws-'));
  secrets = new MemorySecretStore();
  store = await WorkspaceStore.open(root, { secrets, defaultName: 'Teste' });
});
afterEach(() => rm(root, { recursive: true, force: true }));

const read = async (...parts: string[]) => JSON.parse(await readFile(join(root, ...parts), 'utf8'));
const names = () => [...walkTree(store.snapshot().collections)].map((n) => n.name);

describe('WorkspaceStore: estrutura', () => {
  it('cria o manifesto na primeira abertura', async () => {
    const manifest = await read('rota.workspace.json');
    expect(manifest).toMatchObject({ schemaVersion: 1, name: 'Teste' });
    expect(store.snapshot()).toMatchObject({
      name: 'Teste',
      collections: [],
      environments: [],
      problems: [],
    });
  });

  it('grava um arquivo por requisição com nomes legíveis', async () => {
    const col = await store.createCollection('API de Pedidos');
    const folder = await store.createFolder(col, 'Autenticação');
    const req = await store.createRequest(folder, 'Login (v2)', { method: 'POST', url: '{{base}}/login' });

    const file = await read('collections', 'api-de-pedidos', 'autenticacao', 'login-v2.req.json');
    expect(file).toMatchObject({ id: req, name: 'Login (v2)', method: 'POST', url: '{{base}}/login' });
    // A ordem das chaves é estável (diffs limpos).
    expect(Object.keys(file).slice(0, 5)).toEqual(['schemaVersion', 'id', 'name', 'method', 'url']);

    const raw = await readFile(
      join(root, 'collections', 'api-de-pedidos', 'autenticacao', 'login-v2.req.json'),
      'utf8',
    );
    expect(raw.endsWith('}\n')).toBe(true);
    expect(names()).toEqual(['API de Pedidos', 'Autenticação', 'Login (v2)']);
  });

  it('evita colisão de nomes de arquivo', async () => {
    const col = await store.createCollection('C');
    await store.createRequest(col, 'Listar');
    await store.createRequest(col, 'listar');
    const files = (await readdir(join(root, 'collections', 'c')))
      .filter((f) => f.endsWith('.req.json'))
      .sort();
    expect(files).toEqual(['listar-2.req.json', 'listar.req.json']);
  });

  it('mantém a ordem definida e insere em posições específicas', async () => {
    const col = await store.createCollection('C');
    const a = await store.createRequest(col, 'A');
    const b = await store.createRequest(col, 'B');
    await store.createRequest(col, 'Z', {}, { index: 0 });
    expect(names()).toEqual(['C', 'Z', 'A', 'B']);
    await store.move(b, col, 0);
    expect(names()).toEqual(['C', 'B', 'Z', 'A']);
    expect((await read('collections', 'c', '_collection.json')).order[0]).toBe(b);
    void a;
  });

  it('atualiza a requisição preservando id e nome', async () => {
    const col = await store.createCollection('C');
    const id = await store.createRequest(col, 'R');
    const node = findNode(store.snapshot(), id);
    if (node?.kind !== 'request') throw new Error('esperava requisição');
    await store.updateRequest(id, { ...node.data, method: 'DELETE', url: 'http://x' });
    const updated = findNode(store.snapshot(), id);
    expect(updated).toMatchObject({
      kind: 'request',
      name: 'R',
      data: { method: 'DELETE', url: 'http://x' },
    });
  });
});

describe('WorkspaceStore: aparência', () => {
  it('grava ícone e cor da coleção e da pasta, e volta ao padrão com null', async () => {
    const col = await store.createCollection('Pagamentos');
    const folder = await store.createFolder(col, 'Pix');
    await store.setAppearance(col, { icon: 'brand:stripe', color: '#635BFF' });
    await store.setAppearance(folder, { icon: 'qr-code' });

    expect(await read('collections', 'pagamentos', '_collection.json')).toMatchObject({
      appearance: { icon: 'brand:stripe', color: '#635BFF' },
    });
    const snap = store.snapshot();
    expect(findNode(snap, col)).toMatchObject({ appearance: { icon: 'brand:stripe' } });
    expect(findNode(snap, folder)).toMatchObject({ appearance: { icon: 'qr-code' } });

    // Salvar as configurações da coleção não apaga a aparência.
    await store.updateCollection(col, { description: 'Gateway' });
    expect(findNode(store.snapshot(), col)).toMatchObject({ appearance: { color: '#635BFF' } });

    await store.setAppearance(col, null);
    expect(await read('collections', 'pagamentos', '_collection.json')).not.toHaveProperty('appearance');
  });

  it('ignora aparência inválida editada à mão sem perder a coleção', async () => {
    const col = await store.createCollection('C');
    const path = join(root, 'collections', 'c', '_collection.json');
    const file = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...file, appearance: { color: 'vermelho' } }));
    const reopened = await WorkspaceStore.open(root, { secrets, defaultName: 'Teste' });
    const node = findNode(reopened.snapshot(), col);
    expect(node?.name).toBe('C');
    expect(node).not.toHaveProperty('appearance.color');
  });
});

describe('WorkspaceStore: renomear, mover, duplicar, excluir', () => {
  it('renomeia arquivo e pasta junto com o nome, levando os exemplos', async () => {
    const col = await store.createCollection('C');
    const folder = await store.createFolder(col, 'Pasta');
    const req = await store.createRequest(folder, 'Antigo');
    await store.saveExample(req, {
      name: 'Sucesso',
      response: { status: 200, statusText: 'OK', headers: [], body: '{}' },
    });

    await store.rename(req, 'Novo nome');
    await store.rename(folder, 'Outra pasta');
    await store.rename(col, 'Coleção');

    const dir = join(root, 'collections', 'colecao', 'outra-pasta');
    expect((await readdir(dir)).sort()).toEqual(['_folder.json', 'novo-nome.examples', 'novo-nome.req.json']);
    const node = findNode(store.snapshot(), req);
    expect(node).toMatchObject({ name: 'Novo nome', examples: [{ name: 'Sucesso' }] });
  });

  it('rejeita nome vazio', async () => {
    const col = await store.createCollection('C');
    await expect(store.rename(col, '  ')).rejects.toBeInstanceOf(WorkspaceError);
  });

  it('move entre pastas e impede mover pasta para dentro dela mesma', async () => {
    const col = await store.createCollection('C');
    const f1 = await store.createFolder(col, 'F1');
    const f2 = await store.createFolder(f1, 'F2');
    const req = await store.createRequest(f1, 'R');

    await store.move(req, f2);
    expect(findNode(store.snapshot(), req)).toMatchObject({ parentId: f2 });
    expect(await readdir(join(root, 'collections', 'c', 'f1', 'f2'))).toContain('r.req.json');

    await expect(store.move(f1, f2)).rejects.toThrow(/dentro dela mesma/);
    await store.move(f2, col, 0);
    expect(names()).toEqual(['C', 'F2', 'R', 'F1']);
  });

  it('duplica pasta com ids novos e ordem remapeada', async () => {
    const col = await store.createCollection('C');
    const folder = await store.createFolder(col, 'Pasta');
    await store.createRequest(folder, 'A');
    await store.createRequest(folder, 'B');

    const copy = await store.duplicate(folder);
    expect(names()).toEqual(['C', 'Pasta', 'A', 'B', 'Pasta (cópia)', 'A', 'B']);
    const ids = [...walkTree(store.snapshot().collections)].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findNode(store.snapshot(), copy)?.name).toBe('Pasta (cópia)');
  });

  it('duplica sem os exemplos salvos, a menos que peça', async () => {
    const col = await store.createCollection('C');
    const folder = await store.createFolder(col, 'Pasta');
    const req = await store.createRequest(folder, 'R');
    await store.saveExample(req, {
      name: 'Sucesso',
      response: { status: 200, statusText: 'OK', headers: [], body: '{}' },
    });
    const examplesOf = (id: string) => {
      const node = findNode(store.snapshot(), id);
      return node?.kind === 'request' ? node.examples.length : -1;
    };

    expect(examplesOf(await store.duplicate(req))).toBe(0);
    expect(examplesOf(await store.duplicate(req, { includeExamples: true }))).toBe(1);

    const folderCopy = await store.duplicate(folder);
    const copied = findNode(store.snapshot(), folderCopy);
    if (copied?.kind !== 'folder') throw new Error('pasta');
    expect(copied.children.map((c) => (c.kind === 'request' ? c.examples.length : -1))).toEqual([0, 0, 0]);
    expect(examplesOf(req)).toBe(1);
  });

  it('exclui itens e limpa segredos de coleções/ambientes', async () => {
    const col = await store.createCollection('C', {
      variables: [{ key: 'k', type: 'secret', enabled: true, value: 'v' }],
    });
    const req = await store.createRequest(col, 'R');
    await store.remove(req);
    expect(names()).toEqual(['C']);
    await store.remove(col);
    expect(store.snapshot().collections).toEqual([]);
    expect(secrets.allValues()).toEqual([]);
  });
});

describe('WorkspaceStore: variáveis e ambientes', () => {
  it('grava ambientes sem valores secretos e expõe só hasValue', async () => {
    const env = await store.createEnvironment('Homologação', [
      { key: 'URL_BASE', type: 'default', enabled: true, value: 'https://hml' },
      { key: 'ACCESS_TOKEN', type: 'secret', enabled: true, value: 'jwt' },
    ]);
    const file = await read('environments', 'homologacao.env.json');
    expect(JSON.stringify(file)).not.toContain('jwt');
    expect(store.snapshot().environments[0]?.variables).toEqual([
      { key: 'URL_BASE', type: 'default', enabled: true, value: 'https://hml' },
      { key: 'ACCESS_TOKEN', type: 'secret', enabled: true, hasValue: true },
    ]);
    expect(store.revealSecret({ kind: 'environment', id: env }, 'ACCESS_TOKEN')).toBe('jwt');
  });

  it('setVariable atualiza, cria e respeita variáveis secretas', async () => {
    const env = await store.createEnvironment('Dev', [{ key: 'TOKEN', type: 'secret', enabled: true }]);
    await store.setVariable({ kind: 'environment', id: env }, 'TOKEN', 'novo-token');
    await store.setVariable({ kind: 'environment', id: env }, 'USER_ID', '7');
    await store.setVariable({ kind: 'global' }, 'G', '1');

    expect(secrets.get({ kind: 'environment', id: env }, 'TOKEN')).toBe('novo-token');
    const file = await read('environments', 'dev.env.json');
    expect(file.variables).toEqual([
      { key: 'TOKEN', type: 'secret', enabled: true },
      { key: 'USER_ID', value: '7', type: 'default', enabled: true },
    ]);
    expect(store.snapshot().globals).toEqual([{ key: 'G', value: '1', type: 'default', enabled: true }]);

    await store.unsetVariable({ kind: 'environment', id: env }, 'TOKEN');
    expect(secrets.allValues()).toEqual([]);
  });

  it('monta as camadas de variáveis com segredos para execução', async () => {
    await store.updateGlobals([{ key: 'a', type: 'default', enabled: true, value: 'global' }]);
    const col = await store.createCollection('C', {
      variables: [{ key: 'a', type: 'default', enabled: true, value: 'col' }],
    });
    const env = await store.createEnvironment('E', [
      { key: 's', type: 'secret', enabled: true, value: 'segredo' },
    ]);
    const scope = new VariableScope(store.variableLayers(col, env));
    expect(scope.get('a')?.value).toBe('col');
    expect(scope.get('s')).toMatchObject({ value: 'segredo', secret: true, source: 'environment' });
  });
});

describe('WorkspaceStore: robustez', () => {
  it('reporta arquivos inválidos sem quebrar o resto', async () => {
    const col = await store.createCollection('C');
    await store.createRequest(col, 'Boa');
    await writeFile(join(root, 'collections', 'c', 'quebrada.req.json'), '{ isso não é json');
    await writeFile(
      join(root, 'collections', 'c', 'incompleta.req.json'),
      JSON.stringify({ schemaVersion: 1 }),
    );

    const snap = await store.reload();
    expect(names()).toEqual(['C', 'Boa']);
    expect(snap.problems.map((p) => p.message)).toEqual([
      expect.stringMatching(/./),
      expect.stringMatching(/JSON inválido/),
    ]);
  });

  it('corrige ids duplicados de arquivos copiados manualmente', async () => {
    const col = await store.createCollection('C');
    const id = await store.createRequest(col, 'Original');
    const content = await readFile(join(root, 'collections', 'c', 'original.req.json'), 'utf8');
    await writeFile(join(root, 'collections', 'c', 'zz-copia.req.json'), content);

    await store.reload();
    const ids = [...walkTree(store.snapshot().collections)]
      .filter((n) => n.kind === 'request')
      .map((n) => n.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(id);
  });

  it('vê alterações feitas por fora após reload', async () => {
    const col = await store.createCollection('C');
    const other = await WorkspaceStore.open(root, { secrets });
    await other.createRequest(col, 'Criada pelo MCP');
    await store.reload();
    expect(names()).toEqual(['C', 'Criada pelo MCP']);
  });
});
