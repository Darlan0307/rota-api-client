import type { WebhookProviderId } from './providers';

/**
 * Payload guardado para reenviar pelo simulador (normalmente um webhook real
 * recebido pelo túnel). Fica no tunnels.json, só nesta máquina.
 */
export interface SavedWebhookEvent {
  id: string;
  name: string;
  body: string;
  /** Caminho na API local (ex.: /webhooks/pagamentos). */
  path?: string;
  /** Evento de exemplo do provedor cujos headers fixos vão junto (ex.: X-GitHub-Event). */
  eventId?: string;
  provider: WebhookProviderId | null;
  /** ISO 8601. */
  savedAt: string;
}

export const MAX_SAVED_EVENTS = 50;
/** Corpo acima disso não vale guardar no tunnels.json. */
export const MAX_SAVED_EVENT_BODY = 256 * 1024;

/** Lista vinda do arquivo (pode ter sido editado à mão): descarta o que não serve. */
export function normalizeSavedEvents(value: unknown): SavedWebhookEvent[] {
  if (!Array.isArray(value)) return [];
  const out: SavedWebhookEvent[] = [];
  for (const item of value) {
    const e = item as Partial<SavedWebhookEvent> | null;
    if (!e || typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.body !== 'string') continue;
    if (e.body.length > MAX_SAVED_EVENT_BODY) continue;
    out.push({
      id: e.id,
      name: e.name.trim() || 'Evento',
      body: e.body,
      ...(typeof e.path === 'string' && e.path ? { path: e.path } : {}),
      ...(typeof e.eventId === 'string' && e.eventId ? { eventId: e.eventId } : {}),
      provider: typeof e.provider === 'string' ? e.provider : null,
      savedAt: typeof e.savedAt === 'string' ? e.savedAt : new Date(0).toISOString(),
    });
  }
  return out.slice(0, MAX_SAVED_EVENTS);
}

const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE = /\(?\b\d{2}\)?\s?9\d{4}-?\d{4}\b/;

/**
 * O payload parece ter dados pessoais (CPF, e-mail, celular)? Só para avisar
 * antes de guardar: webhooks reais costumam trazer dados de clientes.
 */
export function looksPersonal(body: string): boolean {
  return CPF.test(body) || EMAIL.test(body) || PHONE.test(body);
}
