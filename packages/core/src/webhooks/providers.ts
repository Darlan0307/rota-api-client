/**
 * Provedores de webhook que o simulador sabe assinar, com eventos de exemplo.
 * Os corpos usam dados de teste ({{$guid}}, {{$timestamp}}...): cada envio gera
 * valores novos. Sem dependências de Node (usado também pelo renderer).
 */

export type WebhookProviderId =
  | 'stripe'
  | 'mercadopago'
  | 'github'
  | 'asaas'
  | 'shopify'
  | 'standard'
  | 'hmac';

/** Assinatura genérica: HMAC do corpo num header. */
export interface HmacSettings {
  header: string;
  algorithm: 'sha1' | 'sha256' | 'sha512';
  encoding: 'hex' | 'base64';
  /** Texto antes da assinatura (ex.: "sha256="). */
  prefix: string;
}

export const DEFAULT_HMAC: HmacSettings = {
  header: 'X-Signature',
  algorithm: 'sha256',
  encoding: 'hex',
  prefix: '',
};

export interface WebhookSettings {
  provider: WebhookProviderId | null;
  hmac: HmacSettings;
}

export const DEFAULT_WEBHOOK_SETTINGS: WebhookSettings = { provider: null, hmac: DEFAULT_HMAC };

/** "unverifiable": o corpo era grande demais para ficar registrado inteiro. */
export type SignatureStatus = 'valid' | 'invalid' | 'missing' | 'unverifiable';

export interface SignatureCheck {
  status: SignatureStatus;
  message: string;
}

export interface WebhookEventTemplate {
  id: string;
  label: string;
  body: string;
  /** Headers fixos do evento (ex.: X-GitHub-Event). */
  headers?: Record<string, string>;
}

export interface WebhookProvider {
  id: WebhookProviderId;
  name: string;
  /** Nome curto para mensagens e etiquetas. */
  shortName: string;
  secretLabel: string;
  secretPlaceholder: string;
  /** Onde achar o segredo no painel do provedor. */
  secretHelp: string;
  /** Como a assinatura vai na chamada. */
  scheme: string;
  events: WebhookEventTemplate[];
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** Valores que não são string no JSON (números gerados por {{$...}}). */
const raw = (template: string) => `@@${template}@@`;
const template = (value: unknown) => json(value).replace(/"@@(.*?)@@"/g, '$1');

function stripeEvent(type: string, object: unknown): WebhookEventTemplate {
  return {
    id: type,
    label: type,
    body: template({
      id: 'evt_{{$codigo}}{{$codigo}}',
      object: 'event',
      api_version: '2024-06-20',
      created: raw('{{$timestamp}}'),
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type,
      data: { object },
    }),
  };
}

const stripePaymentIntent = (status: string) => ({
  id: 'pi_{{$codigo}}{{$codigo}}',
  object: 'payment_intent',
  amount: 4990,
  amount_received: status === 'succeeded' ? 4990 : 0,
  currency: 'brl',
  customer: 'cus_{{$codigo}}',
  payment_method_types: ['card'],
  status,
  metadata: { pedido_id: '{{$randomInt}}' },
});

function mercadoPagoEvent(action: string): WebhookEventTemplate {
  return {
    id: action,
    label: action,
    body: template({
      action,
      api_version: 'v1',
      data: { id: '{{$randomInt}}{{$randomInt}}{{$randomInt}}' },
      date_created: '{{$isoTimestamp}}',
      id: raw('{{$randomInt}}{{$randomInt}}{{$randomInt}}'),
      live_mode: false,
      type: 'payment',
      user_id: '{{$randomInt}}{{$randomInt}}',
    }),
  };
}

function asaasEvent(event: string, status: string, billingType = 'PIX'): WebhookEventTemplate {
  const paid = status === 'RECEIVED' || status === 'CONFIRMED';
  return {
    id: event,
    label: event,
    body: template({
      id: 'evt_{{$codigo}}{{$codigo}}',
      event,
      dateCreated: '{{$hoje}} 10:30:00',
      payment: {
        object: 'payment',
        id: 'pay_{{$codigo}}',
        customer: 'cus_{{$codigo}}',
        value: 149.9,
        netValue: 148.91,
        billingType,
        status,
        dueDate: '{{$hoje}}',
        paymentDate: paid ? '{{$hoje}}' : null,
        externalReference: 'pedido-{{$randomInt}}',
        description: 'Pedido na loja',
      },
    }),
  };
}

const shopifyOrder = (financialStatus: string) => ({
  id: raw('{{$randomInt}}{{$randomInt}}{{$randomInt}}'),
  name: '#{{$randomInt}}',
  email: '{{$email}}',
  created_at: '{{$isoTimestamp}}',
  currency: 'BRL',
  total_price: '{{$preco}}',
  financial_status: financialStatus,
  customer: { first_name: '{{$nome}}', last_name: '{{$sobrenome}}', email: '{{$email}}' },
  line_items: [{ title: 'Caneca térmica', quantity: 1, price: '{{$preco}}' }],
});

export const WEBHOOK_PROVIDERS: readonly WebhookProvider[] = [
  {
    id: 'stripe',
    name: 'Stripe',
    shortName: 'Stripe',
    secretLabel: 'Signing secret',
    secretPlaceholder: 'whsec_...',
    secretHelp:
      'Dashboard → Developers → Webhooks → seu endpoint → Signing secret. Com a Stripe CLI, é o whsec_ que o "stripe listen" mostra.',
    scheme: 'Stripe-Signature: t=<timestamp>,v1=<HMAC-SHA256 de "timestamp.corpo">',
    events: [
      stripeEvent('payment_intent.succeeded', stripePaymentIntent('succeeded')),
      stripeEvent('payment_intent.payment_failed', {
        ...stripePaymentIntent('requires_payment_method'),
        last_payment_error: { code: 'card_declined', message: 'Your card was declined.' },
      }),
      stripeEvent('checkout.session.completed', {
        id: 'cs_test_{{$codigo}}{{$codigo}}',
        object: 'checkout.session',
        amount_total: 4990,
        currency: 'brl',
        customer: 'cus_{{$codigo}}',
        customer_details: { email: '{{$email}}', name: '{{$nomeCompleto}}' },
        mode: 'payment',
        payment_status: 'paid',
        status: 'complete',
        client_reference_id: '{{$randomInt}}',
      }),
      stripeEvent('invoice.paid', {
        id: 'in_{{$codigo}}{{$codigo}}',
        object: 'invoice',
        amount_paid: 2990,
        currency: 'brl',
        customer: 'cus_{{$codigo}}',
        subscription: 'sub_{{$codigo}}',
        status: 'paid',
      }),
      stripeEvent('customer.subscription.deleted', {
        id: 'sub_{{$codigo}}',
        object: 'subscription',
        customer: 'cus_{{$codigo}}',
        status: 'canceled',
        canceled_at: raw('{{$timestamp}}'),
      }),
      stripeEvent('charge.refunded', {
        id: 'ch_{{$codigo}}{{$codigo}}',
        object: 'charge',
        amount: 4990,
        amount_refunded: 4990,
        currency: 'brl',
        payment_intent: 'pi_{{$codigo}}{{$codigo}}',
        refunded: true,
      }),
    ],
  },
  {
    id: 'mercadopago',
    name: 'Mercado Pago',
    shortName: 'Mercado Pago',
    secretLabel: 'Assinatura secreta',
    secretPlaceholder: 'chave de "Assinatura secreta"',
    secretHelp: 'Suas integrações → sua aplicação → Webhooks → Assinatura secreta.',
    scheme:
      'x-signature: ts=<timestamp>,v1=<HMAC-SHA256 de "id:<data.id>;request-id:<x-request-id>;ts:<timestamp>;">, com data.id e type na query',
    events: [mercadoPagoEvent('payment.created'), mercadoPagoEvent('payment.updated')],
  },
  {
    id: 'github',
    name: 'GitHub',
    shortName: 'GitHub',
    secretLabel: 'Secret',
    secretPlaceholder: 'secret do webhook',
    secretHelp: 'Settings → Webhooks → o webhook → Secret.',
    scheme: 'X-Hub-Signature-256: sha256=<HMAC-SHA256 do corpo>',
    events: [
      {
        id: 'ping',
        label: 'ping',
        headers: { 'X-GitHub-Event': 'ping' },
        body: template({
          zen: 'Keep it logically awesome.',
          hook_id: raw('{{$randomInt}}{{$randomInt}}'),
          hook: { type: 'Repository', active: true, events: ['push', 'pull_request'] },
          repository: { id: raw('{{$randomInt}}{{$randomInt}}'), full_name: 'exemplo/loja-api' },
        }),
      },
      {
        id: 'push',
        label: 'push',
        headers: { 'X-GitHub-Event': 'push' },
        body: template({
          ref: 'refs/heads/main',
          before: '0000000000000000000000000000000000000000',
          after: '{{$guid}}',
          repository: { full_name: 'exemplo/loja-api', default_branch: 'main' },
          pusher: { name: '{{$nome}}', email: '{{$email}}' },
          commits: [
            { id: '{{$guid}}', message: 'Corrige o cálculo do frete', timestamp: '{{$isoTimestamp}}' },
          ],
        }),
      },
      {
        id: 'pull_request.opened',
        label: 'pull_request (opened)',
        headers: { 'X-GitHub-Event': 'pull_request' },
        body: template({
          action: 'opened',
          number: raw('{{$randomInt}}'),
          pull_request: {
            title: 'Adiciona desconto por cupom',
            state: 'open',
            head: { ref: 'feature/cupom' },
            base: { ref: 'main' },
            user: { login: 'exemplo' },
          },
          repository: { full_name: 'exemplo/loja-api' },
        }),
      },
    ],
  },
  {
    id: 'asaas',
    name: 'Asaas',
    shortName: 'Asaas',
    secretLabel: 'Token de autenticação',
    secretPlaceholder: 'token definido no webhook',
    secretHelp:
      'Integrações → Webhooks → Token de autenticação. O Asaas não assina com HMAC: ele envia esse token no header asaas-access-token.',
    scheme: 'asaas-access-token: <token>',
    events: [
      asaasEvent('PAYMENT_CREATED', 'PENDING'),
      asaasEvent('PAYMENT_RECEIVED', 'RECEIVED'),
      asaasEvent('PAYMENT_CONFIRMED', 'CONFIRMED', 'CREDIT_CARD'),
      asaasEvent('PAYMENT_OVERDUE', 'OVERDUE', 'BOLETO'),
    ],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    shortName: 'Shopify',
    secretLabel: 'Chave do webhook',
    secretPlaceholder: 'client secret do app',
    secretHelp:
      'Em apps, é o client secret. Webhooks criados no admin usam a chave mostrada em Configurações → Notificações → Webhooks.',
    scheme: 'X-Shopify-Hmac-Sha256: <HMAC-SHA256 do corpo em base64>',
    events: [
      {
        id: 'orders/create',
        label: 'orders/create',
        headers: { 'X-Shopify-Topic': 'orders/create' },
        body: template(shopifyOrder('pending')),
      },
      {
        id: 'orders/paid',
        label: 'orders/paid',
        headers: { 'X-Shopify-Topic': 'orders/paid' },
        body: template(shopifyOrder('paid')),
      },
    ],
  },
  {
    id: 'standard',
    name: 'Standard Webhooks (Svix, Clerk, Resend…)',
    shortName: 'Standard Webhooks',
    secretLabel: 'Signing secret',
    secretPlaceholder: 'whsec_...',
    secretHelp:
      'O signing secret do endpoint (começa com whsec_). Vale para serviços que usam o padrão Standard Webhooks ou o Svix.',
    scheme:
      'webhook-signature: v1,<HMAC-SHA256 de "id.timestamp.corpo" em base64> (também nos headers svix-*)',
    events: [
      {
        id: 'user.created',
        label: 'user.created (Clerk)',
        body: template({
          type: 'user.created',
          object: 'event',
          timestamp: raw('{{$timestamp}}000'),
          data: {
            id: 'user_{{$codigo}}{{$codigo}}',
            first_name: '{{$nome}}',
            last_name: '{{$sobrenome}}',
            email_addresses: [{ email_address: '{{$email}}' }],
          },
        }),
      },
      {
        id: 'email.delivered',
        label: 'email.delivered (Resend)',
        body: template({
          type: 'email.delivered',
          created_at: '{{$isoTimestamp}}',
          data: {
            email_id: '{{$guid}}',
            from: 'Loja <noreply@exemplo.com>',
            to: ['{{$email}}'],
            subject: 'Seu pedido foi enviado',
          },
        }),
      },
    ],
  },
  {
    id: 'hmac',
    name: 'Outro (HMAC do corpo)',
    shortName: 'HMAC',
    secretLabel: 'Segredo',
    secretPlaceholder: 'segredo compartilhado',
    secretHelp:
      'Para serviços que assinam o corpo com HMAC num header. Ajuste o header, o algoritmo e o formato abaixo.',
    scheme: '<header>: <prefixo><HMAC do corpo>',
    events: [
      {
        id: 'generico',
        label: 'Evento genérico',
        body: template({
          evento: 'pedido.pago',
          id: '{{$guid}}',
          criadoEm: '{{$isoTimestamp}}',
          dados: { pedidoId: raw('{{$randomInt}}'), valor: raw('{{$preco}}'), cliente: '{{$nomeCompleto}}' },
        }),
      },
    ],
  },
];

export function findWebhookProvider(id: string | null | undefined): WebhookProvider | undefined {
  return WEBHOOK_PROVIDERS.find((p) => p.id === id);
}
