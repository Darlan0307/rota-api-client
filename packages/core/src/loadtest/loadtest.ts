import { openAsBlob } from 'node:fs';
import { basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Agent, type Dispatcher, FormData, interceptors, ProxyAgent, request } from 'undici';
import { isBypassed, type ProxySettings } from '../http/execute';
import type { PreparedRequest } from '../http/prepare';
import {
  type LatencySummary,
  type LoadTestConfig,
  type LoadTestResult,
  type LoadTestStats,
  type TimelinePoint,
  validateLoadTestConfig,
} from './config';

export * from './config';

export interface LoadTestOptions {
  signal?: AbortSignal;
  proxy?: ProxySettings;
  /** Chamado periodicamente com as estatísticas parciais. */
  onProgress?: (stats: LoadTestStats) => void;
  progressIntervalMs?: number;
}

/** Percentil por interpolação "nearest-rank" sobre um array já ordenado. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? 0;
}

export function summarizeLatencies(latencies: readonly number[]): LatencySummary | null {
  if (latencies.length === 0) return null;
  const sorted = Float64Array.from(latencies).sort();
  let sum = 0;
  for (const v of sorted) sum += v;
  const arr = Array.from(sorted);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    min: round(arr[0] ?? 0),
    max: round(arr[arr.length - 1] ?? 0),
    mean: round(sum / arr.length),
    p50: round(percentile(arr, 50)),
    p90: round(percentile(arr, 90)),
    p95: round(percentile(arr, 95)),
    p99: round(percentile(arr, 99)),
  };
}

/** Coleta as medições (separado do envio para ser testável). */
const SLOT_MS = 100;
const MAX_POINTS = 120;

export class LoadTestRecorder {
  readonly latencies: number[] = [];
  readonly statusCounts: Record<string, number> = {};
  readonly errors: Record<string, number> = {};
  private readonly buckets = new Map<number, { requests: number; errors: number; totalMs: number }>();
  completed = 0;
  failed = 0;
  networkErrors = 0;

  constructor(private readonly startedAt: number) {}

  record(endedAt: number, latencyMs: number, outcome: { status: number } | { error: string }): void {
    this.completed++;
    this.latencies.push(latencyMs);
    // Fatias de 100 ms; agregadas em stats() conforme a duração do teste.
    const slot = Math.max(0, Math.floor((endedAt - this.startedAt) / SLOT_MS));
    const bucket = this.buckets.get(slot) ?? { requests: 0, errors: 0, totalMs: 0 };
    bucket.requests++;
    bucket.totalMs += latencyMs;
    let failed: boolean;
    if ('error' in outcome) {
      failed = true;
      this.networkErrors++;
      this.statusCounts.erro = (this.statusCounts.erro ?? 0) + 1;
      this.errors[outcome.error] = (this.errors[outcome.error] ?? 0) + 1;
    } else {
      failed = outcome.status >= 400;
      const key = String(outcome.status);
      this.statusCounts[key] = (this.statusCounts[key] ?? 0) + 1;
    }
    if (failed) {
      this.failed++;
      bucket.errors++;
    }
    this.buckets.set(slot, bucket);
  }

  stats(now: number): LoadTestStats {
    const elapsedMs = Math.max(1, now - this.startedAt);
    // Até ~120 pontos: fatias de 100 ms em testes curtos, maiores nos longos.
    const lastSlot = Math.floor(elapsedMs / SLOT_MS);
    const perPoint = Math.max(1, Math.ceil((lastSlot + 1) / MAX_POINTS));
    const timeline: TimelinePoint[] = [];
    for (let first = 0; first <= lastSlot; first += perPoint) {
      let requests = 0;
      let errors = 0;
      let totalMs = 0;
      for (let slot = first; slot < first + perPoint; slot++) {
        const b = this.buckets.get(slot);
        if (!b) continue;
        requests += b.requests;
        errors += b.errors;
        totalMs += b.totalMs;
      }
      // A fatia em andamento só entra se já tem dados.
      const end = Math.min((first + perPoint) * SLOT_MS, elapsedMs);
      const spanSec = Math.max(0.001, (end - first * SLOT_MS) / 1000);
      if (first + perPoint > lastSlot && requests === 0) break;
      timeline.push({
        t: Math.round(((first * SLOT_MS) / 1000) * 10) / 10,
        requests,
        rps: Math.round((requests / spanSec) * 10) / 10,
        errors,
        meanMs: requests ? Math.round((totalMs / requests) * 10) / 10 : 0,
      });
    }
    return {
      elapsedMs: Math.round(elapsedMs),
      completed: this.completed,
      failed: this.failed,
      networkErrors: this.networkErrors,
      errorRate: this.completed ? this.failed / this.completed : 0,
      rps: Math.round((this.completed / (elapsedMs / 1000)) * 10) / 10,
      latency: summarizeLatencies(this.latencies),
      statusCounts: { ...this.statusCounts },
      errors: { ...this.errors },
      timeline,
    };
  }
}

function createDispatcher(prepared: PreparedRequest, concurrency: number, proxy?: ProxySettings): Dispatcher {
  const url = new URL(prepared.url);
  const tls = { rejectUnauthorized: prepared.settings.verifySsl };
  const base =
    proxy?.enabled && proxy.url.trim() && !isBypassed(url.hostname, proxy.bypass)
      ? new ProxyAgent({ uri: proxy.url.trim(), requestTls: tls, connections: concurrency })
      : new Agent({ connections: concurrency, connect: tls, pipelining: 1 });
  return prepared.settings.followRedirects
    ? base.compose(interceptors.redirect({ maxRedirections: 10 }))
    : base;
}

async function buildBody(prepared: PreparedRequest): Promise<string | FormData | null> {
  const body = prepared.body;
  if (body.kind === 'none') return null;
  if (body.kind === 'text') return body.text;
  const form = new FormData();
  for (const f of body.fields) {
    if (f.type === 'text') form.append(f.key, f.value);
    else form.append(f.key, await openAsBlob(f.value), basename(f.value));
  }
  return form;
}

function errorMessage(error: unknown): string {
  const e = error as { code?: string; cause?: { code?: string }; message?: string; name?: string };
  const code = e?.code ?? e?.cause?.code;
  if (e?.name === 'TimeoutError' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') {
    return 'Tempo limite excedido';
  }
  if (code === 'ECONNREFUSED') return 'Conexão recusada';
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'Conexão encerrada pelo servidor';
  if (code === 'ENOTFOUND') return 'Falha de DNS';
  return code ? `${code}` : (e?.message ?? 'Erro desconhecido');
}

/**
 * Teste de carga simples: N "usuários virtuais" enviando a mesma requisição
 * em sequência, até atingir o total ou a duração. Conexões são reaproveitadas
 * (keep-alive), como num cliente real. Pode ser cancelado a qualquer momento.
 */
export async function runLoadTest(
  prepared: PreparedRequest,
  config: LoadTestConfig,
  options: LoadTestOptions = {},
): Promise<LoadTestResult> {
  const problem = validateLoadTestConfig(config);
  if (problem) throw new Error(problem);

  const startedAtIso = new Date().toISOString();
  const start = performance.now();
  const recorder = new LoadTestRecorder(start);
  const dispatcher = createDispatcher(prepared, config.concurrency, options.proxy);
  const deadline = config.mode === 'duration' ? start + config.durationSec * 1000 : Number.POSITIVE_INFINITY;
  const stop = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal;
  if (config.mode === 'duration') setTimeout(() => stop.abort(), config.durationSec * 1000).unref?.();

  let issued = 0;
  const shouldContinue = () =>
    !signal.aborted && (config.mode === 'count' ? issued < config.total : performance.now() < deadline);

  const headers = prepared.headers.flat();
  const worker = async () => {
    while (shouldContinue()) {
      issued++;
      const t0 = performance.now();
      try {
        const body = await buildBody(prepared);
        const timeout =
          prepared.settings.timeoutMs > 0 ? AbortSignal.timeout(prepared.settings.timeoutMs) : undefined;
        const res = await request(prepared.url, {
          method: prepared.method,
          headers,
          body,
          dispatcher,
          signal: timeout ? AbortSignal.any([signal, timeout]) : signal,
        });
        await res.body.dump();
        recorder.record(performance.now(), performance.now() - t0, { status: res.statusCode });
      } catch (error) {
        // Requisições interrompidas pelo cancelamento/fim do tempo não contam.
        if (signal.aborted) {
          issued--;
          break;
        }
        recorder.record(performance.now(), performance.now() - t0, { error: errorMessage(error) });
      }
    }
  };

  const interval = options.onProgress
    ? setInterval(
        () => options.onProgress?.(recorder.stats(performance.now())),
        options.progressIntervalMs ?? 500,
      )
    : undefined;
  try {
    await Promise.all(Array.from({ length: config.concurrency }, worker));
  } finally {
    clearInterval(interval);
    await dispatcher.close().catch(() => undefined);
  }

  const stats = recorder.stats(performance.now());
  return {
    ...stats,
    config,
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    // Fim natural do tempo não é cancelamento.
    cancelled: options.signal?.aborted ?? false,
  };
}
