/** Tipos e validação do teste de carga (sem dependências de Node: usável no renderer). */

export const LOADTEST_LIMITS = {
  maxConcurrency: 500,
  maxTotal: 1_000_000,
  maxDurationSec: 3600,
} as const;

export interface LoadTestConfig {
  /** Parar após N requisições ou após X segundos. */
  mode: 'count' | 'duration';
  total: number;
  durationSec: number;
  /** Requisições simultâneas (usuários virtuais). */
  concurrency: number;
}

export interface LatencySummary {
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface TimelinePoint {
  /** Início do intervalo, em segundos desde o começo do teste. */
  t: number;
  requests: number;
  /** Requisições por segundo naquele intervalo. */
  rps: number;
  errors: number;
  meanMs: number;
}

export interface LoadTestStats {
  elapsedMs: number;
  completed: number;
  /** Falhas de rede/timeout + respostas com status >= 400. */
  failed: number;
  networkErrors: number;
  errorRate: number;
  rps: number;
  latency: LatencySummary | null;
  /** "200": 812, "500": 3, "erro": 2 */
  statusCounts: Record<string, number>;
  /** Mensagem de erro de rede -> quantidade. */
  errors: Record<string, number>;
  timeline: TimelinePoint[];
}

export interface LoadTestResult extends LoadTestStats {
  config: LoadTestConfig;
  startedAt: string;
  finishedAt: string;
  cancelled: boolean;
}

export function validateLoadTestConfig(config: LoadTestConfig): string | null {
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1)
    return 'A concorrência deve ser pelo menos 1.';
  if (config.concurrency > LOADTEST_LIMITS.maxConcurrency) {
    return `A concorrência máxima é ${LOADTEST_LIMITS.maxConcurrency}.`;
  }
  if (config.mode === 'count') {
    if (!Number.isInteger(config.total) || config.total < 1) return 'Informe quantas requisições enviar.';
    if (config.total > LOADTEST_LIMITS.maxTotal)
      return `O máximo é ${LOADTEST_LIMITS.maxTotal.toLocaleString('pt-BR')} requisições.`;
  } else {
    if (!(config.durationSec >= 1)) return 'A duração deve ser de pelo menos 1 segundo.';
    if (config.durationSec > LOADTEST_LIMITS.maxDurationSec) return 'A duração máxima é de 1 hora.';
  }
  return null;
}
