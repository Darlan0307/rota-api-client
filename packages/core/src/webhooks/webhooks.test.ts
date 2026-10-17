import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { TunnelInspector } from '../tunnel/inspector';
import { DEFAULT_CAPTURE_BODY, type TunnelConfig } from '../tunnel/types';
import { resolveTemplate, VariableScope } from '../variables/template';
import {
  DEFAULT_HMAC,
  DEFAULT_WEBHOOK_SETTINGS,
  WEBHOOK_PROVIDERS,
  type WebhookProviderId,
} from './providers';
import { signWebhook, verifyWebhook } from './signature';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

function roundTrip(provider: WebhookProviderId, body = '{"ok":true}', path = '/webhooks') {
  const signed = signWebhook({ provider, secret: SECRET, body, path });
  return {
    signed,
    check: (overrides: { body?: string; secret?: string; now?: Date } = {}) =>
      verifyWebhook({
        provider,
        secret: overrides.secret ?? SECRET,
        path: signed.path,
        headers: signed.headers,
        body: Buffer.from(overrides.body ?? body),
        ...(overrides.now ? { now: overrides.now } : {}),
      }),
  };
}

describe('assinatura de webhooks', () => {
  it('GitHub: confere com o exemplo da documentação', () => {
    const { headers } = signWebhook({
      provider: 'github',
      secret: "It's a Secret to Everybody",
      body: 'Hello, World!',
      path: '/',
    });
    expect(headers).toContainEqual([
      'X-Hub-Signature-256',
      'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
    ]);
  });

  it('Standard Webhooks: confere com o exemplo da especificação', () => {
    const check = verifyWebhook({
      provider: 'standard',
      secret: SECRET,
      path: '/',
      headers: [
        ['webhook-id', 'msg_p5jXN8AQM9LWM0D4loKWxJek'],
        ['webhook-timestamp', '1614265330'],
        ['webhook-signature', 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE='],
      ],
      body: Buffer.from('{"test": 2432232314}'),
    });
    expect(check.status).toBe('valid');
  });

  it.each(WEBHOOK_PROVIDERS.map((p) => p.id))(
    '%s: assina e confere; corpo ou segredo errado não passa',
    (id) => {
      const { check } = roundTrip(id);
      expect(check().status).toBe('valid');
      expect(check({ secret: 'outro-segredo' }).status).toBe('invalid');
      // Asaas manda só um token; o Mercado Pago assina id, request-id e ts, não o corpo.
      if (id !== 'asaas' && id !== 'mercadopago')
        expect(check({ body: '{"ok":false}' }).status).toBe('invalid');
    },
  );

  it('acusa chamada sem o header do provedor', () => {
    const check = verifyWebhook({
      provider: 'stripe',
      secret: SECRET,
      path: '/',
      headers: [],
      body: Buffer.from('{}'),
    });
    expect(check.status).toBe('missing');
    expect(check.message).toContain('Stripe-Signature');
  });

  it('Stripe: avisa quando a assinatura passou da tolerância de 5 minutos', () => {
    const { check } = roundTrip('stripe');
    const later = check({ now: new Date(Date.now() + 10 * 60_000) });
    expect(later.status).toBe('valid');
    expect(later.message).toContain('recusa acima de 5 min');
  });

  it('Mercado Pago: põe data.id e type na query e assina o manifesto', () => {
    const body = JSON.stringify({ type: 'payment', data: { id: 'ABC123' } });
    const { signed, check } = roundTrip('mercadopago', body, '/webhooks/mp?origem=teste');
    expect(signed.path).toBe('/webhooks/mp?origem=teste&data.id=ABC123&type=payment');
    const header = signed.headers.find(([k]) => k === 'x-signature')?.[1] ?? '';
    const requestId = signed.headers.find(([k]) => k === 'x-request-id')?.[1];
    const ts = /ts=(\d+)/.exec(header)?.[1];
    const expected = createHmac('sha256', SECRET)
      .update(`id:abc123;request-id:${requestId};ts:${ts};`)
      .digest('hex');
    expect(header).toBe(`ts=${ts},v1=${expected}`);
    expect(check().status).toBe('valid');
  });

  it('HMAC genérico: respeita header, algoritmo, formato e prefixo', () => {
    const hmac = { header: 'X-Hub-Signature', algorithm: 'sha1', encoding: 'hex', prefix: 'sha1=' } as const;
    const { headers } = signWebhook({ provider: 'hmac', secret: 'k', body: 'abc', path: '/', hmac });
    expect(headers).toEqual([
      ['X-Hub-Signature', `sha1=${createHmac('sha1', 'k').update('abc').digest('hex')}`],
    ]);
    expect(
      verifyWebhook({ provider: 'hmac', secret: 'k', path: '/', headers, body: Buffer.from('abc'), hmac })
        .status,
    ).toBe('valid');
    expect(
      verifyWebhook({
        provider: 'hmac',
        secret: 'k',
        path: '/',
        headers,
        body: Buffer.from('abc'),
        hmac: DEFAULT_HMAC,
      }).status,
    ).toBe('missing');
  });

  it('todos os eventos de exemplo viram JSON válido com dados novos', () => {
    const scope = new VariableScope([]);
    for (const provider of WEBHOOK_PROVIDERS) {
      for (const event of provider.events) {
        const text = resolveTemplate(event.body, scope);
        expect(text, `${provider.id} ${event.id}`).not.toContain('{{');
        expect(() => JSON.parse(text), `${provider.id} ${event.id}`).not.toThrow();
      }
    }
  });
});

describe('envio simulado pelo inspetor', () => {
  let api: Server | undefined;
  afterEach(() => api?.close());

  it('entrega na API com os headers assinados e registra como simulada', async () => {
    let received: { headers: Record<string, unknown>; body: string } | undefined;
    api = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received = { headers: req.headers, body };
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((r) => api?.listen(0, '127.0.0.1', r));
    const config: TunnelConfig = {
      id: 't',
      name: 't',
      target: `http://127.0.0.1:${(api.address() as AddressInfo).port}`,
      mode: 'capture',
      preserveHost: false,
      captureStatus: 200,
      captureBody: DEFAULT_CAPTURE_BODY,
      webhookPath: '',
      webhook: DEFAULT_WEBHOOK_SETTINGS,
    };
    const inspector = new TunnelInspector({ getConfig: () => config });
    const body = '{"evento":1}';
    const { path, headers } = signWebhook({ provider: 'github', secret: 's', body, path: '/hook' });
    const exchange = await inspector.send({
      method: 'POST',
      path,
      headers: [['content-type', 'application/json'], ...headers],
      body: Buffer.from(body),
      label: 'GitHub · push',
    });
    expect(exchange.status).toBe(200);
    expect(exchange.simulated).toBe('GitHub · push');
    expect(received?.body).toBe(body);
    expect(received?.headers['x-hub-signature-256']).toMatch(/^sha256=/);
    expect(inspector.list()).toHaveLength(1);
  });
});
