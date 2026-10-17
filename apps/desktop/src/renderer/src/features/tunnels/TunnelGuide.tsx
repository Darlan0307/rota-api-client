import { ArrowRight, Globe, Laptop, Webhook } from 'lucide-react';
import type { ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { Logo } from '../../components/Logo';
import { useTunnels } from './state';

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: 'Suba a sua API normalmente',
    body: (
      <>
        Ex.: <Code>npm run dev</Code> na porta 3000. O túnel só entrega as chamadas; quem responde é a sua
        API.
      </>
    ),
  },
  {
    title: 'Crie um túnel para a porta da API',
    body: (
      <>
        Informe a porta (<Code>3000</Code>) ou o endereço (<Code>http://localhost:8080/api</Code>). Tem outra
        API na 8080? Crie outro túnel: cada um ganha a sua própria URL.
      </>
    ),
  },
  {
    title: 'Clique em Ligar',
    body: (
      <>
        O Rota gera um endereço <Code>https://….trycloudflare.com</Code>. Na primeira vez ele baixa o{' '}
        <b>cloudflared</b>, programa gratuito da Cloudflare (cerca de 60 MB, sem cadastro).
      </>
    ),
  },
  {
    title: 'Monte a URL do webhook',
    body: (
      <>
        Digite o caminho que a sua API espera (ex.: <Code>/webhooks/stripe</Code>) e copie a URL completa. Ela
        chega em <Code>http://localhost:3000/webhooks/stripe</Code>.
      </>
    ),
  },
  {
    title: 'Cole no serviço e dispare um evento',
    body: (
      <>
        No painel do Stripe, Mercado Pago, GitHub, WhatsApp… cadastre a URL e use o "enviar evento de teste".
        Para conferir antes, use <b>Testar agora</b>.
      </>
    ),
  },
  {
    title: 'Acompanhe e reenvie',
    body: (
      <>
        Em <b>Chamadas recebidas</b> você vê o pedido, a resposta da sua API e o tempo. Corrigiu o código? Use{' '}
        <b>Reenviar</b>: não precisa disparar o evento de novo.
      </>
    ),
  },
];

const TIPS: ReactNode[] = [
  <>
    <b>A URL muda toda vez que o túnel liga.</b> Deixe ligado enquanto testa; se religar, atualize a URL no
    serviço.
  </>,
  <>
    <b>Trocar a porta não muda a URL:</b> dá para apontar o mesmo túnel para outra API com ele ligado.
  </>,
  <>
    <b>API desligada?</b> Use o modo "Só capturar": o Rota responde 200 e guarda as chamadas para você
    reenviar depois.
  </>,
  <>
    <b>Assinaturas</b> (Stripe-Signature, X-Hub-Signature): o corpo chega sem alteração, então a validação
    funciona. No reenvio, alguns serviços recusam assinaturas antigas por causa do horário.
  </>,
  <>
    <b>Segurança:</b> quem tiver a URL alcança a sua API. Desligue o túnel quando terminar. Ao fechar o Rota,
    todos são desligados.
  </>,
];

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-surface-2 px-1 font-mono text-[0.92em] text-fg">{children}</code>;
}

/** Diagrama do caminho de uma chamada. */
export function TunnelDiagram({ target = 'localhost:3000' }: { target?: string }) {
  const node = (icon: ReactNode, label: string, detail: string) => (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg border border-border bg-surface px-2 py-2.5 text-center">
      <span className="text-primary">{icon}</span>
      <span className="text-xs font-medium text-fg">{label}</span>
      <span className="w-full truncate font-mono text-2xs text-fg-subtle">{detail}</span>
    </div>
  );
  const arrow = <ArrowRight className="size-3.5 shrink-0 text-fg-subtle" />;
  return (
    <div className="flex items-center gap-1.5">
      {node(<Webhook className="size-4" />, 'Serviço', 'Stripe, GitHub…')}
      {arrow}
      {node(<Globe className="size-4" />, 'URL pública', 'https://….trycloudflare.com')}
      {arrow}
      {node(<Logo size={16} />, 'Rota', 'registra tudo')}
      {arrow}
      {node(<Laptop className="size-4" />, 'Sua API', target)}
    </div>
  );
}

export function TunnelSteps({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={compact ? 'space-y-2.5' : 'space-y-3'}>
      {STEPS.map((step, i) => (
        <li key={step.title} className="flex gap-3">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft font-mono text-2xs font-semibold text-primary">
            {i + 1}
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-fg">{step.title}</p>
            {!compact && <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{step.body}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Janela "Como usar os túneis". */
export function TunnelGuideDialog() {
  const open = useTunnels((s) => s.guideOpen);
  const setOpen = useTunnels((s) => s.setGuideOpen);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Receber webhooks na sua máquina"
      className="w-[min(640px,calc(100vw-32px))]"
    >
      <div className="max-h-[72vh] space-y-5 overflow-y-auto px-5 py-4">
        <p className="text-[13px] leading-relaxed text-fg-muted">
          Serviços como Stripe, Mercado Pago, GitHub ou WhatsApp só enviam webhooks para um endereço{' '}
          <b>https público</b>. O túnel cria esse endereço, entrega cada chamada na porta da sua API local e o
          Rota mostra tudo o que passou.
        </p>
        <TunnelDiagram />
        <TunnelSteps />
        <div className="rounded-lg border border-border bg-surface p-3">
          <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-fg-subtle">Dicas</p>
          <ul className="space-y-1.5 text-xs leading-relaxed text-fg-muted">
            {TIPS.map((tip, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lista fixa
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-fg-subtle" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}

export function openTunnelGuide(): void {
  useTunnels.getState().setGuideOpen(true);
}
