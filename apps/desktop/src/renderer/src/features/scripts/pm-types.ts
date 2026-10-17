import { monaco } from '../../lib/monaco';

/** Tipos da API pm.* para o autocompletar do Monaco nos scripts. */
const PM_DTS = `
interface PmVariableScope {
  /** Lê uma variável. */
  get(key: string): string | undefined;
  /** Define uma variável (gravada no workspace ao final da execução). */
  set(key: string, value: unknown): void;
  unset(key: string): void;
  has(key: string): boolean;
  clear(): void;
  toObject(): Record<string, string>;
  /** Substitui {{variaveis}} num texto. */
  replaceIn(text: string): string;
}
interface PmHeaderList {
  get(key: string): string | undefined;
  has(key: string, value?: string): boolean;
  toObject(): Record<string, string>;
  all(): { key: string; value: string }[];
  each(fn: (h: { key: string; value: string }) => void): void;
  count(): number;
  /** Só no script de pré-requisição. */
  add(header: { key: string; value: unknown }): void;
  upsert(header: { key: string; value: unknown }): void;
  remove(key: string): void;
}
interface PmResponseAssertions {
  have: {
    status(code: number | string): void;
    header(name: string, value?: string): void;
    body(text?: string): void;
    jsonBody(path?: string, value?: unknown): void;
  };
  be: { ok: void; success: void; redirection: void; clientError: void; serverError: void; error: void; json: void };
}
interface Pm {
  environment: PmVariableScope;
  collectionVariables: PmVariableScope;
  globals: PmVariableScope;
  /** Variáveis locais desta execução; get resolve local > ambiente > coleção > global. */
  variables: PmVariableScope;
  request: {
    method: string;
    url: { toString(): string; getHost(): string; getPath(): string; update(url: string): void } | string;
    headers: PmHeaderList;
    body: { raw: string | undefined; toString(): string };
  };
  /** Disponível só no script de pós-resposta. */
  response: {
    code: number;
    status: string;
    responseTime: number;
    responseSize: number;
    headers: PmHeaderList;
    text(): string;
    json(): any;
    to: PmResponseAssertions;
  };
  info: { requestName: string; eventName: 'prerequest' | 'test'; iteration: number; iterationCount: number };
  /** Registra um teste. A função falha lançando erro (ex.: pm.expect). */
  test: ((name: string, fn: () => void | Promise<void>) => void) & { skip(name: string): void };
  /** Asserções do chai: pm.expect(x).to.equal(y) */
  expect: (value: any, message?: string) => any;
}
declare const pm: Pm;
declare const postman: {
  setEnvironmentVariable(key: string, value: unknown): void;
  getEnvironmentVariable(key: string): string | undefined;
  clearEnvironmentVariable(key: string): void;
  setGlobalVariable(key: string, value: unknown): void;
  getGlobalVariable(key: string): string | undefined;
  clearGlobalVariable(key: string): void;
};
declare const tests: Record<string, boolean>;
declare const responseBody: string;
declare const responseCode: { code: number; name: string };
declare const responseTime: number;
`;

let installed = false;

export function installPmTypes(): void {
  if (installed) return;
  installed = true;
  const js = monaco.typescript.javascriptDefaults;
  js.setCompilerOptions({
    allowNonTsExtensions: true,
    target: monaco.typescript.ScriptTarget.ES2020,
    noLib: false,
  });
  js.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
  js.addExtraLib(PM_DTS, 'ts:pm.d.ts');
}
