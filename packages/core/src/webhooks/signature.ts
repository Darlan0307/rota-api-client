import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  DEFAULT_HMAC,
  findWebhookProvider,
  type HmacSettings,
  type SignatureCheck,
  type WebhookEventTemplate,
  type WebhookProviderId,
} from './providers';

/** O Stripe recusa, por padrão, assinaturas com mais de 5 minutos. */
const STRIPE_TOLERANCE_S = 300;

export interface SignInput {
  provider: WebhookProviderId;
  secret: string;
  /** Corpo exato que será enviado (a assinatura vale para estes bytes). */
  body: string;
  /** Caminho com query (ex.: /webhooks/mp?x=1). */
  path: string;
  hmac?: HmacSettings;
  event?: WebhookEventTemplate;
  now?: Date;
}

export interface SignedWebhook {
  path: string;
  headers: [string, string][];
}

export interface VerifyInput {
  provider: WebhookProviderId;
  secret: string;
  path: string;
  headers: readonly [string, string][];
  body: Buffer;
  hmac?: HmacSettings;
  now?: Date;
}

function hmac(algorithm: string, key: string | Buffer, data: string | Buffer) {
  return createHmac(algorithm, key).update(data);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function headerOf(headers: readonly [string, string][], name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find(([k]) => k.toLowerCase() === lower)?.[1];
}

/** "t=1,v1=abc,v1=def" → { t: ['1'], v1: ['abc', 'def'] } */
function parsePairs(value: string, separator = ','): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const part of value.split(separator)) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    result[key] = [...(result[key] ?? []), part.slice(index + 1).trim()];
  }
  return result;
}

/** Chave do Standard Webhooks: base64 depois do prefixo whsec_. */
function standardKey(secret: string): Buffer {
  return Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
}

function standardSignature(secret: string, id: string, timestamp: string, body: string | Buffer): string {
  return hmac(
    'sha256',
    standardKey(secret),
    Buffer.concat([Buffer.from(`${id}.${timestamp}.`), Buffer.from(body)]),
  ).digest('base64');
}

/**
 * Manifesto do Mercado Pago. Partes sem valor saem do texto, como manda a
 * documentação; ids alfanuméricos vão em minúsculas.
 */
function mercadoPagoManifest(dataId: string | undefined, requestId: string | undefined, ts: string): string {
  const id = dataId && /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  return `${id ? `id:${id};` : ''}${requestId ? `request-id:${requestId};` : ''}ts:${ts};`;
}

function queryParam(path: string, name: string): string | undefined {
  const index = path.indexOf('?');
  if (index < 0) return undefined;
  return new URLSearchParams(path.slice(index + 1)).get(name) ?? undefined;
}

function genericSignature(settings: HmacSettings, secret: string, body: string | Buffer): string {
  return settings.prefix + hmac(settings.algorithm, secret, body).digest(settings.encoding);
}

/** Headers (e query, no Mercado Pago) que o provedor mandaria para este corpo. */
export function signWebhook(input: SignInput): SignedWebhook {
  const { secret, body, event } = input;
  const now = input.now ?? new Date();
  const seconds = String(Math.floor(now.getTime() / 1000));
  const headers: [string, string][] = Object.entries(event?.headers ?? {});
  let path = input.path || '/';

  switch (input.provider) {
    case 'stripe': {
      const signature = hmac('sha256', secret, `${seconds}.${body}`).digest('hex');
      headers.push(['Stripe-Signature', `t=${seconds},v1=${signature}`]);
      headers.push(['User-Agent', 'Stripe/1.0 (+https://stripe.com/docs/webhooks)']);
      break;
    }
    case 'mercadopago': {
      let dataId: string | undefined;
      let type: string | undefined;
      try {
        const parsed = JSON.parse(body) as { data?: { id?: unknown }; type?: unknown };
        if (parsed.data?.id !== undefined) dataId = String(parsed.data.id);
        if (typeof parsed.type === 'string') type = parsed.type;
      } catch {
        // Corpo que não é JSON: assina só com o que estiver na query.
      }
      const url = new URL(path, 'http://x');
      if (dataId && !url.searchParams.has('data.id')) url.searchParams.set('data.id', dataId);
      if (type && !url.searchParams.has('type')) url.searchParams.set('type', type);
      path = `${url.pathname}${url.search}`;
      const requestId = randomUUID();
      const manifest = mercadoPagoManifest(url.searchParams.get('data.id') ?? undefined, requestId, seconds);
      headers.push(['x-request-id', requestId]);
      headers.push(['x-signature', `ts=${seconds},v1=${hmac('sha256', secret, manifest).digest('hex')}`]);
      break;
    }
    case 'github':
      headers.push(['X-Hub-Signature-256', `sha256=${hmac('sha256', secret, body).digest('hex')}`]);
      headers.push(['X-GitHub-Delivery', randomUUID()]);
      headers.push(['X-GitHub-Hook-ID', String(Math.floor(Math.random() * 1e9))]);
      headers.push(['User-Agent', 'GitHub-Hookshot/rota']);
      break;
    case 'asaas':
      headers.push(['asaas-access-token', secret]);
      break;
    case 'shopify':
      headers.push(['X-Shopify-Hmac-Sha256', hmac('sha256', secret, body).digest('base64')]);
      headers.push(['X-Shopify-Shop-Domain', 'loja-exemplo.myshopify.com']);
      headers.push(['X-Shopify-Webhook-Id', randomUUID()]);
      headers.push(['X-Shopify-Triggered-At', now.toISOString()]);
      headers.push(['X-Shopify-API-Version', '2024-07']);
      break;
    case 'standard': {
      const id = `msg_${randomBytes(12).toString('hex')}`;
      const signature = `v1,${standardSignature(secret, id, seconds, body)}`;
      // Mesmos valores nos dois nomes: bibliotecas do Svix leem svix-*; as do padrão, webhook-*.
      headers.push(['webhook-id', id], ['webhook-timestamp', seconds], ['webhook-signature', signature]);
      headers.push(['svix-id', id], ['svix-timestamp', seconds], ['svix-signature', signature]);
      break;
    }
    case 'hmac': {
      const settings = input.hmac ?? DEFAULT_HMAC;
      headers.push([settings.header || DEFAULT_HMAC.header, genericSignature(settings, secret, body)]);
      break;
    }
  }
  return { path, headers };
}

function minutesAgo(seconds: number, now: Date): number {
  return Math.round((now.getTime() / 1000 - seconds) / 60);
}

/**
 * Confere a assinatura de uma chamada recebida com o segredo configurado.
 * Ajuda a descobrir se o problema está no segredo ou no código que valida.
 */
export function verifyWebhook(input: VerifyInput): SignatureCheck {
  const { secret, headers, body } = input;
  const now = input.now ?? new Date();
  const name = findWebhookProvider(input.provider)?.shortName ?? input.provider;
  const valid = (extra = ''): SignatureCheck => ({
    status: 'valid',
    message: `Assinatura válida (${name})${extra}.`,
  });
  const invalid = (why: string): SignatureCheck => ({
    status: 'invalid',
    message: `Assinatura inválida: ${why}`,
  });
  const missing = (header: string): SignatureCheck => ({
    status: 'missing',
    message: `Sem o header ${header}: a chamada não veio assinada pelo ${name}.`,
  });

  switch (input.provider) {
    case 'stripe': {
      const header = headerOf(headers, 'stripe-signature');
      if (!header) return missing('Stripe-Signature');
      const parts = parsePairs(header);
      const t = parts.t?.[0];
      if (!t || !parts.v1?.length) return invalid('header Stripe-Signature sem t= ou v1=.');
      const expected = hmac('sha256', secret, Buffer.concat([Buffer.from(`${t}.`), body])).digest('hex');
      if (!parts.v1.some((v) => safeEqual(v, expected)))
        return invalid(
          'não confere com este segredo (o whsec_ é do mesmo endpoint e do mesmo modo, teste ou produção?).',
        );
      const age = now.getTime() / 1000 - Number(t);
      return age > STRIPE_TOLERANCE_S
        ? valid(
            `, mas gerada há ${minutesAgo(Number(t), now)} min: a biblioteca do Stripe recusa acima de 5 min (use "Editar e reenviar" para assinar de novo)`,
          )
        : valid();
    }
    case 'mercadopago': {
      const header = headerOf(headers, 'x-signature');
      if (!header) return missing('x-signature');
      const parts = parsePairs(header);
      const ts = parts.ts?.[0];
      const v1 = parts.v1?.[0];
      if (!ts || !v1) return invalid('header x-signature sem ts= ou v1=.');
      const manifest = mercadoPagoManifest(
        queryParam(input.path, 'data.id'),
        headerOf(headers, 'x-request-id'),
        ts,
      );
      return safeEqual(v1, hmac('sha256', secret, manifest).digest('hex'))
        ? valid()
        : invalid(
            'não confere com esta assinatura secreta. O manifesto usa data.id da query, x-request-id e ts.',
          );
    }
    case 'github': {
      const header = headerOf(headers, 'x-hub-signature-256');
      if (!header) return missing('X-Hub-Signature-256');
      return safeEqual(header, `sha256=${hmac('sha256', secret, body).digest('hex')}`)
        ? valid()
        : invalid('não confere com este secret.');
    }
    case 'asaas': {
      const header = headerOf(headers, 'asaas-access-token');
      if (!header) return missing('asaas-access-token');
      return safeEqual(header, secret) ? valid(' (token confere)') : invalid('o token recebido é outro.');
    }
    case 'shopify': {
      const header = headerOf(headers, 'x-shopify-hmac-sha256');
      if (!header) return missing('X-Shopify-Hmac-Sha256');
      return safeEqual(header, hmac('sha256', secret, body).digest('base64'))
        ? valid()
        : invalid('não confere com esta chave.');
    }
    case 'standard': {
      const id = headerOf(headers, 'webhook-id') ?? headerOf(headers, 'svix-id');
      const ts = headerOf(headers, 'webhook-timestamp') ?? headerOf(headers, 'svix-timestamp');
      const header = headerOf(headers, 'webhook-signature') ?? headerOf(headers, 'svix-signature');
      if (!id || !ts || !header) return missing('webhook-signature (ou svix-signature)');
      const expected = standardSignature(secret, id, ts, body);
      const ok = header
        .split(' ')
        .some((part) => part.startsWith('v1,') && safeEqual(part.slice(3), expected));
      return ok ? valid() : invalid('não confere com este signing secret.');
    }
    case 'hmac': {
      const settings = input.hmac ?? DEFAULT_HMAC;
      const headerName = settings.header || DEFAULT_HMAC.header;
      const header = headerOf(headers, headerName);
      if (!header) return missing(headerName);
      return safeEqual(header, genericSignature(settings, secret, body))
        ? valid()
        : invalid(
            `não confere (${settings.algorithm}, ${settings.encoding}${settings.prefix ? `, prefixo "${settings.prefix}"` : ''}).`,
          );
    }
  }
}
