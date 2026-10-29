import { z } from 'zod';

/**
 * Schemas dos arquivos do workspace. A ordem das chaves aqui define a ordem
 * em que são gravadas no disco (o zod preserva a ordem do shape), o que mantém
 * os diffs no Git estáveis.
 */

export const SCHEMA_VERSION = 1;

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export const HttpMethodSchema = z.enum(HTTP_METHODS);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

// ---------------------------------------------------------------------------
// Blocos básicos

export const KeyValueSchema = z.object({
  key: z.string(),
  value: z.string().default(''),
  enabled: z.boolean().default(true),
  description: z.string().optional(),
});
export type KeyValue = z.infer<typeof KeyValueSchema>;

export const VariableTypeSchema = z.enum(['default', 'secret']);
export type VariableType = z.infer<typeof VariableTypeSchema>;

/**
 * Variável como gravada no arquivo. Variáveis `secret` nunca têm `value` no
 * arquivo: o valor fica cifrado fora do workspace (ver secrets/).
 */
export const VariableSchema = z.object({
  key: z.string(),
  value: z.string().optional(),
  type: VariableTypeSchema.default('default'),
  enabled: z.boolean().default(true),
  description: z.string().optional(),
});
export type Variable = z.infer<typeof VariableSchema>;

// ---------------------------------------------------------------------------
// Autenticação

export const AuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('inherit') }),
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearer'), token: z.string().default('') }),
  z.object({
    type: z.literal('basic'),
    username: z.string().default(''),
    password: z.string().default(''),
  }),
  z.object({
    type: z.literal('apikey'),
    key: z.string().default(''),
    value: z.string().default(''),
    in: z.enum(['header', 'query']).default('header'),
  }),
]);
export type Auth = z.infer<typeof AuthSchema>;
export type AuthType = Auth['type'];

// ---------------------------------------------------------------------------
// Body

export const FormDataFieldSchema = z.object({
  key: z.string(),
  type: z.enum(['text', 'file']).default('text'),
  /** Texto (type=text) ou caminho do arquivo (type=file). */
  value: z.string().default(''),
  enabled: z.boolean().default(true),
  description: z.string().optional(),
});
export type FormDataField = z.infer<typeof FormDataFieldSchema>;

export const RAW_LANGUAGES = ['text', 'json', 'xml', 'html', 'javascript'] as const;
export type RawLanguage = (typeof RAW_LANGUAGES)[number];

export const BodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({ mode: z.literal('json'), text: z.string().default('') }),
  z.object({
    mode: z.literal('raw'),
    language: z.enum(RAW_LANGUAGES).default('text'),
    text: z.string().default(''),
  }),
  z.object({ mode: z.literal('urlencoded'), fields: z.array(KeyValueSchema).default([]) }),
  z.object({ mode: z.literal('formdata'), fields: z.array(FormDataFieldSchema).default([]) }),
]);
export type Body = z.infer<typeof BodySchema>;
export type BodyMode = Body['mode'];

// ---------------------------------------------------------------------------
// Requisição

export const RequestSettingsSchema = z.object({
  /** Timeout em ms; 0 = sem limite. Ausente = usa o padrão do app. */
  timeoutMs: z.number().int().min(0).optional(),
  followRedirects: z.boolean().default(true),
  verifySsl: z.boolean().default(true),
  /** Headers automáticos desligados nesta requisição (nomes em minúsculas, ver http/auto-headers). */
  disabledAutoHeaders: z.array(z.string()).optional(),
});
export type RequestSettings = z.infer<typeof RequestSettingsSchema>;

export const ScriptsSchema = z.object({
  preRequest: z.string().default(''),
  postResponse: z.string().default(''),
});
export type Scripts = z.infer<typeof ScriptsSchema>;

/** Conteúdo editável de uma requisição (sem id/metadados de arquivo). */
export const RequestDataSchema = z.object({
  method: HttpMethodSchema.default('GET'),
  /** URL sem a query string (a query fica em `query`). */
  url: z.string().default(''),
  query: z.array(KeyValueSchema).default([]),
  headers: z.array(KeyValueSchema).default([]),
  auth: AuthSchema.default({ type: 'inherit' }),
  body: BodySchema.default({ mode: 'none' }),
  scripts: ScriptsSchema.default({ preRequest: '', postResponse: '' }),
  settings: RequestSettingsSchema.default({ followRedirects: true, verifySsl: true }),
  description: z.string().optional(),
});
export type RequestData = z.infer<typeof RequestDataSchema>;
/** Forma aceita na criação (campos com padrão são opcionais). */
export type RequestDataInput = z.input<typeof RequestDataSchema>;

export const RequestFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  ...RequestDataSchema.shape,
});
export type RequestFile = z.infer<typeof RequestFileSchema>;

// ---------------------------------------------------------------------------
// Exemplos salvos

export const ExampleFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  request: z
    .object({
      method: HttpMethodSchema,
      url: z.string(),
      headers: z.array(KeyValueSchema).default([]),
      body: z.string().optional(),
    })
    .optional(),
  response: z.object({
    status: z.number().int(),
    statusText: z.string().default(''),
    headers: z.array(KeyValueSchema).default([]),
    body: z.string().default(''),
    timeMs: z.number().optional(),
  }),
  savedAt: z.string().optional(),
});
export type ExampleFile = z.infer<typeof ExampleFileSchema>;

// ---------------------------------------------------------------------------
// Pastas e coleções

/** Ícone e cor escolhidos para a coleção/pasta na árvore. */
export const AppearanceSchema = z.object({
  /** Id do catálogo de ícones do app (ex.: "credit-card", "brand:stripe"). */
  icon: z.string().max(60).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export type Appearance = z.infer<typeof AppearanceSchema>;

// Aparência inválida (editada à mão) não pode impedir a coleção de abrir.
const appearanceField = AppearanceSchema.optional().catch(undefined);

export const FolderFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  auth: AuthSchema.default({ type: 'inherit' }),
  /** Scripts executados para todas as requisições da pasta (como no Postman). */
  scripts: ScriptsSchema.default({ preRequest: '', postResponse: '' }),
  description: z.string().optional(),
  appearance: appearanceField,
  /** Ids dos filhos na ordem de exibição. Filhos fora da lista vão para o fim. */
  order: z.array(z.string()).default([]),
});
export type FolderFile = z.infer<typeof FolderFileSchema>;

export const CollectionFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  auth: AuthSchema.default({ type: 'none' }),
  variables: z.array(VariableSchema).default([]),
  /** Scripts executados para todas as requisições da coleção (como no Postman). */
  scripts: ScriptsSchema.default({ preRequest: '', postResponse: '' }),
  description: z.string().optional(),
  appearance: appearanceField,
  order: z.array(z.string()).default([]),
});
export type CollectionFile = z.infer<typeof CollectionFileSchema>;

// ---------------------------------------------------------------------------
// Ambientes, globais e workspace

export const EnvironmentFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  variables: z.array(VariableSchema).default([]),
});
export type EnvironmentFile = z.infer<typeof EnvironmentFileSchema>;

export const GlobalsFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  variables: z.array(VariableSchema).default([]),
});
export type GlobalsFile = z.infer<typeof GlobalsFileSchema>;

export const WorkspaceManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  /** Ordem das coleções na sidebar. */
  order: z.array(z.string()).default([]),
});
export type WorkspaceManifest = z.infer<typeof WorkspaceManifestSchema>;
