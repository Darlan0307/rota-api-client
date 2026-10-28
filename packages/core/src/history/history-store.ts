import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { HttpMethod, RequestData } from '../model/schemas';
import type { RunResult } from '../runner/run-request';
import { isNotFound, writeFileAtomic } from '../util/fs';
import { newId } from '../util/ids';
import { Mutex } from '../util/mutex';
import { maskSecretValues } from '../variables/template';

/** Resumo exibido na lista do histórico. */
export interface HistorySummary {
  id: string;
  at: string;
  name: string;
  method: HttpMethod;
  /** URL como enviada (variáveis resolvidas, segredos mascarados). */
  url: string;
  status: number | null;
  timeMs: number | null;
  sizeBytes: number | null;
  error: string | null;
  requestId: string | null;
  /** Quem disparou: o app ou o Claude (MCP). */
  source: 'app' | 'mcp';
}

/** Entrada completa: o que foi enviado (template e resolvido) e a resposta. */
export interface HistoryEntry extends HistorySummary {
  parentId: string | null;
  /** A requisição como estava no editor (com {{variáveis}}), para reabrir. */
  data: RequestData;
  result: RunResult;
}

export interface HistoryQuery {
  query?: string;
  /** Só envios desta requisição salva. */
  requestId?: string;
  limit?: number;
  offset?: number;
}

/** Limites para o histórico não crescer sem controle. */
const MAX_ENTRIES = 500;
const MAX_BODY_CHARS = 256 * 1024;

/**
 * Histórico de envios em JSON Lines (uma entrada por linha), na pasta local
 * do workspace. Segredos são mascarados ANTES de gravar: o arquivo nunca
 * contém valores secretos, nem para o app nem para o MCP.
 */
export class HistoryStore {
  private readonly file: string;
  private readonly mutex = new Mutex();
  private cache: HistoryEntry[] | null = null;

  constructor(localDir: string) {
    this.file = join(localDir, 'history.jsonl');
  }

  async add(
    meta: {
      name: string;
      requestId?: string | null;
      parentId?: string | null;
      data: RequestData;
      source?: 'app' | 'mcp';
    },
    result: RunResult,
    secretValues: readonly string[],
  ): Promise<HistorySummary> {
    const entry = buildEntry(meta, result, secretValues);
    await this.mutex.run(async () => {
      const entries = await this.load();
      entries.push(entry);
      if (entries.length > MAX_ENTRIES * 1.2) {
        // Compacta de vez em quando, mantendo só as mais recentes.
        this.cache = entries.slice(-MAX_ENTRIES);
        await writeFileAtomic(this.file, `${this.cache.map((e) => JSON.stringify(e)).join('\n')}\n`);
      } else {
        await mkdir(dirname(this.file), { recursive: true });
        await appendFile(this.file, `${JSON.stringify(entry)}\n`);
      }
    });
    return summarize(entry);
  }

  /** Mais recentes primeiro, com filtro por nome, método, URL ou status. */
  async list(options: HistoryQuery = {}): Promise<{ items: HistorySummary[]; total: number }> {
    const entries = await this.mutex.run(() => this.load());
    const q = options.query?.trim().toLowerCase() ?? '';
    const filtered = [...entries]
      .reverse()
      .filter((e) => !options.requestId || e.requestId === options.requestId)
      .filter(
        (e) =>
          !q || `${e.name} ${e.method} ${e.url} ${e.status ?? ''} ${e.error ?? ''}`.toLowerCase().includes(q),
      );
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    return { items: filtered.slice(offset, offset + limit).map(summarize), total: filtered.length };
  }

  async get(id: string): Promise<HistoryEntry | undefined> {
    const entries = await this.mutex.run(() => this.load());
    return entries.find((e) => e.id === id);
  }

  async remove(id: string): Promise<void> {
    await this.mutex.run(async () => {
      const entries = (await this.load()).filter((e) => e.id !== id);
      this.cache = entries;
      await writeFileAtomic(this.file, entries.map((e) => `${JSON.stringify(e)}\n`).join(''));
    });
  }

  async clear(): Promise<void> {
    await this.mutex.run(async () => {
      this.cache = [];
      await rm(this.file, { force: true });
    });
  }

  /** Esquece o cache (outro processo — ex.: MCP — pode ter escrito). */
  invalidate(): void {
    this.cache = null;
  }

  private async load(): Promise<HistoryEntry[]> {
    if (this.cache) return this.cache;
    let text = '';
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    const entries: HistoryEntry[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as HistoryEntry);
      } catch {
        // Linha corrompida (ex.: gravação interrompida): ignorada.
      }
    }
    this.cache = entries;
    return entries;
  }
}

function summarize(entry: HistoryEntry): HistorySummary {
  const { data: _d, result: _r, parentId: _p, ...summary } = entry;
  return summary;
}

function buildEntry(
  meta: {
    name: string;
    requestId?: string | null;
    parentId?: string | null;
    data: RequestData;
    source?: 'app' | 'mcp';
  },
  result: RunResult,
  secretValues: readonly string[],
): HistoryEntry {
  const mask = (text: string) => maskSecretValues(text, secretValues);
  const response = result.response
    ? {
        ...result.response,
        headers: result.response.headers.map(([k, v]): [string, string] => [k, mask(v)]),
        ...(result.response.sentHeaders
          ? { sentHeaders: result.response.sentHeaders.map(([k, v]): [string, string] => [k, mask(v)]) }
          : {}),
        body:
          result.response.body.encoding === 'utf8'
            ? { encoding: 'utf8' as const, data: mask(truncate(result.response.body.data)) }
            : result.response.body.data.length > MAX_BODY_CHARS
              ? { encoding: 'utf8' as const, data: '(conteúdo binário grande omitido do histórico)' }
              : result.response.body,
      }
    : null;

  const request = result.request
    ? {
        ...result.request,
        url: mask(result.request.url),
        headers: result.request.headers.map(([k, v]): [string, string] => [k, mask(v)]),
        body:
          result.request.body.kind === 'text'
            ? { kind: 'text' as const, text: mask(truncate(result.request.body.text)) }
            : result.request.body,
      }
    : null;

  return {
    id: newId(),
    at: result.startedAt,
    name: meta.name,
    method: meta.data.method,
    url: request?.url ?? meta.data.url,
    status: response?.status ?? null,
    timeMs: response?.timings.total ?? null,
    sizeBytes: response?.sizeBytes ?? null,
    error: result.error?.message ? mask(result.error.message) : null,
    requestId: meta.requestId ?? null,
    parentId: meta.parentId ?? null,
    source: meta.source ?? 'app',
    data: meta.data,
    result: {
      ...result,
      request,
      response,
      ...(result.error ? { error: { ...result.error, message: mask(result.error.message) } } : {}),
      // Scripts podem imprimir tokens no console: mascarados também.
      ...(result.console ? { console: result.console.map((c) => ({ ...c, message: mask(c.message) })) } : {}),
      ...(result.tests
        ? {
            tests: result.tests.map((t) => ({
              ...t,
              name: mask(t.name),
              ...(t.message ? { message: mask(t.message) } : {}),
            })),
          }
        : {}),
      ...(result.scriptErrors
        ? { scriptErrors: result.scriptErrors.map((e) => ({ ...e, message: mask(e.message) })) }
        : {}),
      ...(result.warnings ? { warnings: result.warnings.map(mask) } : {}),
    },
  };
}

function truncate(text: string): string {
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}\n… (truncado no histórico)` : text;
}
