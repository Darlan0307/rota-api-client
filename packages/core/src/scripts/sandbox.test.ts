import { describe, expect, it } from 'vitest';
import { runScript, type ScriptInput } from './sandbox';
import { VariableState } from './variable-state';

const ALL = new Set(['global', 'collection', 'environment', 'local'] as const);

function state(env: Record<string, string> = {}, secretKeys: string[] = []) {
  return new VariableState(
    [
      {
        source: 'environment',
        variables: Object.entries(env).map(([key, value]) => ({
          key,
          value,
          secret: secretKeys.includes(key),
        })),
      },
      { source: 'global', variables: [{ key: 'app', value: 'rota' }] },
    ],
    ALL,
  );
}

const post: ScriptInput = {
  phase: 'post',
  requestName: 'Login',
  request: { method: 'POST', url: '{{base}}/login', headers: [{ key: 'Accept', value: '*/*' }], body: '{}' },
  response: {
    status: 200,
    statusText: 'OK',
    headers: [{ key: 'Content-Type', value: 'application/json' }],
    body: '{"access_token":"tok-1","user":{"id":7}}',
    timeMs: 42,
    size: 40,
  },
};

describe('runScript (pós-resposta)', () => {
  it('salva o token do login no ambiente (caso de uso principal)', async () => {
    const vars = state({ ACCESS_TOKEN: 'velho' }, ['ACCESS_TOKEN']);
    const out = await runScript(
      'pm.environment.set("ACCESS_TOKEN", pm.response.json().access_token);',
      post,
      vars,
    );
    expect(out.error).toBeNull();
    expect(vars.get('environment', 'ACCESS_TOKEN')).toBe('tok-1');
    expect(vars.pendingChanges()).toEqual([{ scope: 'environment', key: 'ACCESS_TOKEN', value: 'tok-1' }]);
    expect(vars.secretValues()).toContain('tok-1');
  });

  it('roda testes com pm.test, pm.expect e pm.response.to', async () => {
    const out = await runScript(
      `
      pm.test("status 200", () => pm.response.to.have.status(200));
      pm.test("é 2xx", () => pm.response.to.be.ok);
      pm.test("tem header", () => pm.response.to.have.header("content-type"));
      pm.test("id do usuário", () => pm.expect(pm.response.json().user.id).to.eql(7));
      pm.test("falha de propósito", () => pm.expect(pm.response.code).to.equal(201));
      pm.test.skip("pulado");
      tests["API antiga"] = responseCode.code === 200;
      `,
      post,
      state(),
    );
    expect(out.error).toBeNull();
    expect(out.tests.map((t) => [t.name, t.status])).toEqual([
      ['status 200', 'passed'],
      ['é 2xx', 'passed'],
      ['tem header', 'passed'],
      ['id do usuário', 'passed'],
      ['falha de propósito', 'failed'],
      ['pulado', 'skipped'],
      ['API antiga', 'passed'],
    ]);
    expect(out.tests[4]?.message).toContain('expected 200 to equal 201');
  });

  it('captura console e resolve pm.variables com prioridade', async () => {
    const vars = state({ app: 'do-ambiente' });
    const out = await runScript(
      `console.log("app =", pm.variables.get("app"), { a: 1 });
       pm.variables.set("tmp", "x");
       console.warn(pm.variables.replaceIn("{{tmp}}-{{app}}"));`,
      post,
      vars,
    );
    expect(out.console).toEqual([
      { level: 'log', message: 'app = do-ambiente {\n  "a": 1\n}' },
      { level: 'warn', message: 'x-do-ambiente' },
    ]);
    // Variáveis locais não são persistidas.
    expect(vars.pendingChanges()).toEqual([]);
  });

  it('suporta testes assíncronos e "return" no meio do script', async () => {
    const out = await runScript(
      `pm.test("async", async () => { await Promise.resolve(); pm.expect(1).to.equal(1); });
       return;
       pm.test("nunca", () => {});`,
      post,
      state(),
    );
    expect(out.tests).toEqual([{ name: 'async', status: 'passed' }]);
  });
});

describe('runScript (pré-requisição)', () => {
  it('pode alterar headers, URL e body da requisição', async () => {
    const out = await runScript(
      `pm.request.headers.add({ key: "X-Ts", value: 123 });
       pm.request.headers.remove("accept");
       pm.request.url = pm.request.url.toString() + "?debug=1";
       pm.request.body.raw = JSON.stringify({ ok: true });
       pm.environment.set("nonce", "abc");`,
      { ...post, phase: 'pre', response: undefined },
      state(),
    );
    expect(out.error).toBeNull();
    expect(out.request).toEqual({
      method: 'POST',
      url: '{{base}}/login?debug=1',
      headers: [{ key: 'X-Ts', value: '123' }],
      body: '{"ok":true}',
    });
  });

  it('não altera a requisição no pós-script', async () => {
    const out = await runScript(
      'pm.request.headers.add && pm.request.headers.add({key:"a",value:"b"});',
      post,
      state(),
    );
    expect(out.request).toEqual(post.request);
  });
});

describe('isolamento e erros', () => {
  it('não expõe require, process, fetch ou arquivos', async () => {
    const out = await runScript(
      'console.log(typeof require, typeof process, typeof fetch, typeof XMLHttpRequest);',
      post,
      state(),
    );
    expect(out.console[0]?.message).toBe('undefined undefined undefined undefined');
  });

  it('interrompe loops infinitos pelo tempo limite', async () => {
    const out = await runScript('while (true) {}', post, state(), { timeoutMs: 200 });
    expect(out.error).toBe('O script excedeu o tempo limite de 200 ms.');
  });

  it('informa erros de sintaxe e de execução com a linha', async () => {
    expect((await runScript('const = 1', post, state())).error).toMatch(/SyntaxError/);
    const runtime = await runScript('\nconst x = null;\nx.y;', post, state());
    expect(runtime.error).toMatch(/TypeError.*\(linha 3\)/);
  });

  it('avisa quando não há ambiente ativo', async () => {
    const vars = new VariableState([], new Set(['global', 'local'] as const));
    const out = await runScript('pm.environment.set("a", 1);', post, vars);
    expect(out.console[0]).toMatchObject({
      level: 'warn',
      message: expect.stringContaining('nenhum ambiente ativo'),
    });
  });
});
