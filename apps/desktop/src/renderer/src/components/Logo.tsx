/**
 * Marca do app: duas paradas ligadas por um caminho (uma "rota").
 * Mesmo desenho de build/icon.svg, mas usando a cor principal da paleta ativa.
 */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true">
      <rect width="256" height="256" rx="60" className="fill-primary-soft" />
      <path
        d="M80 180 C80 118 176 138 176 76"
        fill="none"
        strokeWidth="22"
        strokeLinecap="round"
        className="stroke-primary"
      />
      <circle cx="80" cy="180" r="22" className="fill-primary" />
      <circle cx="176" cy="76" r="22" className="fill-fg" />
    </svg>
  );
}
