import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  getQuickJS,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
  shouldInterruptAfterDeadline,
} from 'quickjs-emscripten';
import { resolveTemplate } from '../variables/template';
import { PRELUDE } from './prelude';
import type { ScriptScope, VariableState } from './variable-state';

export type TestStatus = 'passed' | 'failed' | 'skipped';

export interface TestResult {
  name: string;
  status: TestStatus;
  message?: string | undefined;
}

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error';
  message: string;
}

/** Requisição como os scripts a veem (templates ainda não resolvidos). */
export interface ScriptRequest {
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  body?: string | undefined;
}

export interface ScriptResponse {
  status: number;
  statusText: string;
  headers: { key: string; value: string }[];
  body: string;
  timeMs: number;
  size: number;
}

export interface ScriptInput {
  phase: 'pre' | 'post';
  request: ScriptRequest;
  response?: ScriptResponse | undefined;
  requestName: string;
}

export interface ScriptOutput {
  tests: TestResult[];
  console: ConsoleEntry[];
  /** Erro de sintaxe/execução ou tempo esgotado. */
  error: string | null;
  /** Requisição possivelmente alterada pelo pré-script. */
  request: ScriptRequest;
}

export interface ScriptOptions {
  timeoutMs?: number;
  memoryLimitBytes?: number;
}

const SCOPES = new Set<ScriptScope>(['global', 'collection', 'environment', 'local']);
const SCOPE_LABEL: Record<ScriptScope, string> = {
  global: 'pm.globals',
  collection: 'pm.collectionVariables',
  environment: 'pm.environment',
  local: 'pm.variables',
};

let modulePromise: Promise<QuickJSWASMModule> | undefined;
let chaiSource: string | undefined;

function loadChai(): string {
  if (!chaiSource) {
    const require = createRequire(import.meta.url);
    chaiSource = readFileSync(require.resolve('chai/chai.js'), 'utf8');
  }
  return chaiSource;
}

/**
 * Executa um script do usuário num sandbox QuickJS (WASM): sem acesso a
 * arquivos, rede, require ou process, com limite de tempo e de memória.
 */
export async function runScript(
  code: string,
  input: ScriptInput,
  variables: VariableState,
  options: ScriptOptions = {},
): Promise<ScriptOutput> {
  modulePromise ??= getQuickJS();
  const QuickJS = await modulePromise;

  const tests: TestResult[] = [];
  const consoleEntries: ConsoleEntry[] = [];
  const timeoutMs = options.timeoutMs ?? 5000;
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(options.memoryLimitBytes ?? 64 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs));
  const vm = runtime.newContext();

  let error: string | null = null;
  let request = input.request;

  const scopeOf = (handle: QuickJSHandle): ScriptScope => {
    const name = vm.getString(handle) as ScriptScope;
    if (!SCOPES.has(name)) throw new Error(`Escopo inválido: ${name}`);
    return name;
  };
  const checkScope = (scope: ScriptScope) => {
    if (scope !== 'local' && !variables.available.has(scope)) {
      consoleEntries.push({
        level: 'warn',
        message:
          scope === 'environment'
            ? `${SCOPE_LABEL[scope]}: nenhum ambiente ativo; a alteração vale só para esta execução.`
            : `${SCOPE_LABEL[scope]}: a requisição não está salva numa coleção; a alteração vale só para esta execução.`,
      });
    }
  };

  try {
    const host = vm.newObject();
    const fn = (name: string, impl: (...args: QuickJSHandle[]) => QuickJSHandle | undefined) => {
      const handle = vm.newFunction(name, impl);
      vm.setProp(host, name, handle);
      handle.dispose();
    };
    const str = (value: string | undefined) => (value === undefined ? vm.undefined : vm.newString(value));

    fn('getVar', (s, k) => str(variables.get(scopeOf(s), vm.getString(k))));
    fn('hasVar', (s, k) => (variables.has(scopeOf(s), vm.getString(k)) ? vm.true : vm.false));
    fn('setVar', (s, k, v) => {
      const scope = scopeOf(s);
      checkScope(scope);
      variables.set(scope, vm.getString(k), vm.getString(v));
      return undefined;
    });
    fn('unsetVar', (s, k) => {
      variables.unset(scopeOf(s), vm.getString(k));
      return undefined;
    });
    fn('clearVars', (s) => {
      variables.clear(scopeOf(s));
      return undefined;
    });
    fn('toObject', (s) => vm.newString(JSON.stringify(variables.toObject(scopeOf(s)))));
    fn('resolveVar', (k) => str(variables.resolve(vm.getString(k))));
    fn('resolvedObject', () => {
      const merged = {
        ...variables.toObject('global'),
        ...variables.toObject('collection'),
        ...variables.toObject('environment'),
        ...variables.toObject('local'),
      };
      return vm.newString(JSON.stringify(merged));
    });
    fn('replaceIn', (t) => vm.newString(resolveTemplate(vm.getString(t), variables.scope())));
    fn('log', (level, message) => {
      const l = vm.getString(level) as ConsoleEntry['level'];
      consoleEntries.push({
        level: ['log', 'info', 'warn', 'error'].includes(l) ? l : 'log',
        message: vm.getString(message),
      });
      return undefined;
    });
    fn('test', (name, status, message) => {
      const msg = vm.getString(message);
      tests.push({
        name: vm.getString(name),
        status: vm.getString(status) as TestStatus,
        ...(msg ? { message: msg } : {}),
      });
      return undefined;
    });
    vm.setProp(vm.global, '__host', host);
    host.dispose();

    const data = vm.newString(
      JSON.stringify({
        phase: input.phase,
        request: input.request,
        response: input.response ?? null,
        info: { requestName: input.requestName },
      }),
    );
    vm.setProp(vm.global, '__dataJson', data);
    data.dispose();

    evalOrThrow(vm, loadChai(), 'chai.js');
    evalOrThrow(vm, PRELUDE, 'pm.js');
    // Função própria: permite "return" no meio do script, como no Postman.
    evalOrThrow(vm, `(function () {\n${code}\n})();`, 'script.js');
    // Executa promessas pendentes (testes assíncronos).
    const jobs = runtime.executePendingJobs();
    if (jobs.error) {
      const e = vm.dump(jobs.error.context.dump?.(jobs.error) ?? jobs.error);
      jobs.error.dispose();
      throw new Error(describeError(e));
    }
    const collected = vm.evalCode('__collect()');
    if (collected.error) {
      collected.error.dispose();
    } else {
      request = JSON.parse(vm.getString(collected.value)) as ScriptRequest;
      collected.value.dispose();
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    if (/interrupted/i.test(error)) error = `O script excedeu o tempo limite de ${timeoutMs} ms.`;
    else if (/out of memory/i.test(error)) error = 'O script excedeu o limite de memória.';
  } finally {
    vm.dispose();
    runtime.dispose();
  }

  return { tests, console: consoleEntries, error, request };
}

function evalOrThrow(vm: QuickJSContext, code: string, filename: string): void {
  const result = vm.evalCode(code, filename);
  if (result.error) {
    const dumped: unknown = vm.dump(result.error);
    result.error.dispose();
    throw new Error(describeError(dumped));
  }
  result.value.dispose();
}

function describeError(dumped: unknown): string {
  if (dumped && typeof dumped === 'object') {
    const e = dumped as { name?: string; message?: string; stack?: string };
    const line = /script\.js:(\d+)/.exec(e.stack ?? '')?.[1];
    // A linha 1 é o "(function () {" adicionado em volta do script.
    const where = line ? ` (linha ${Number(line) - 1})` : '';
    return `${e.name ?? 'Erro'}: ${e.message ?? String(dumped)}${where}`;
  }
  return String(dumped);
}
