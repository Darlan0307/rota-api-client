import type { ReactNode } from 'react';

/**
 * Larguras (do container da barra) abaixo das quais os rótulos somem e os
 * botões ficam só com o ícone. As classes precisam ser fixas para o Tailwind.
 */
const HIDE_BELOW = {
  /** Cabeçalho da requisição (`@container/cabecalho`): caminho + ações. */
  cabecalho: '@max-[46rem]/cabecalho:sr-only',
  /** Barra da resposta (`@container/resposta`): status + ações. */
  resposta: '@max-[30rem]/resposta:sr-only',
  /** Barra do corpo da requisição (`@container/corpo`): tipo + ações. */
  corpo: '@max-[34rem]/corpo:sr-only',
} as const;

/**
 * Rótulo de botão de barra de ferramentas. Sem espaço, vira só ícone (o texto
 * continua para leitores de tela, e o botão precisa ter `title` ou tooltip).
 */
export function ToolbarLabel({ bar, children }: { bar: keyof typeof HIDE_BELOW; children: ReactNode }) {
  return <span className={HIDE_BELOW[bar]}>{children}</span>;
}
