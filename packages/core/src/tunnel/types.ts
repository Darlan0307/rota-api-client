/**
 * Túneis públicos (HTTPS via cloudflared) para receber webhooks na máquina
 * local. Tipos sem dependências de Node (usados também pelo renderer).
 */

/** "forward": repassa para a API local. "capture": só registra e responde. */
export type TunnelMode = 'forward' | 'capture';

export interface TunnelConfig {
  id: string;
  name: string;
  /** Destino local, ex.: http://localhost:3000. Pode mudar com o túnel ligado. */
  target: string;
  mode: TunnelMode;
  /** Mantém o Host público no repasse (por padrão vira o host do destino). */
  preserveHost: boolean;
  /** Resposta do modo "capture". */
  captureStatus: number;
  captureBody: string;
  /** Caminho do webhook (ex.: /webhooks/stripe), só para montar a URL a copiar. */
  webhookPath: string;
}

export type TunnelStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface TunnelBody {
  data: string;
  encoding: 'utf8' | 'base64';
  /** Tamanho real; acima do limite só o começo fica registrado. */
  size: number;
  truncated: boolean;
}

export interface TunnelExchange {
  id: string;
  /** ISO 8601. */
  at: string;
  method: string;
  /** Caminho com query (ex.: /webhooks/stripe?x=1). */
  path: string;
  requestHeaders: [string, string][];
  requestBody: TunnelBody;
  /** Ausente quando a API local não respondeu. */
  status?: number;
  responseHeaders: [string, string][];
  responseBody: TunnelBody | null;
  durationMs: number;
  /** Por que não chegou à API (ex.: porta fechada). */
  error?: string;
  mode: TunnelMode;
  /** Destino usado nesta chamada. */
  target: string;
  /** Reenviada pelo Rota (não veio da internet). */
  replay: boolean;
}

export type TunnelExchangeSummary = Pick<
  TunnelExchange,
  'id' | 'at' | 'method' | 'path' | 'status' | 'durationMs' | 'error' | 'mode' | 'replay'
>;

export interface TunnelView {
  config: TunnelConfig;
  status: TunnelStatus;
  /** URL https pública (só com o túnel ligado). */
  publicUrl: string | null;
  error: string | null;
  /** Últimas linhas do cloudflared (para diagnóstico). */
  logs: string[];
  /** Mais recentes primeiro. */
  exchanges: TunnelExchangeSummary[];
}

export const DEFAULT_CAPTURE_BODY = '{"ok":true}';

export function summarizeExchange(e: TunnelExchange): TunnelExchangeSummary {
  return {
    id: e.id,
    at: e.at,
    method: e.method,
    path: e.path,
    durationMs: e.durationMs,
    mode: e.mode,
    replay: e.replay,
    ...(e.status !== undefined ? { status: e.status } : {}),
    ...(e.error !== undefined ? { error: e.error } : {}),
  };
}

/** Normaliza o que o usuário digitou: "3000", ":3000", "localhost:8080/api" → URL completa. */
export function normalizeTarget(input: string): string | null {
  let text = input.trim();
  if (/^:?\d{1,5}$/.test(text)) text = `localhost:${text.replace(':', '')}`;
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  try {
    const url = new URL(text);
    if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** URL pública + caminho do webhook (ex.: /webhooks/stripe). */
export function joinUrl(base: string, path: string): string {
  const clean = path.trim();
  if (clean === '' || clean === '/') return base;
  return `${base.replace(/\/$/, '')}/${clean.replace(/^\//, '')}`;
}
