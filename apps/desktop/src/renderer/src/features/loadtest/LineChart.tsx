import { useLayoutEffect, useMemo, useRef, useState } from 'react';

interface Point {
  x: number;
  y: number;
}

interface LineChartProps {
  points: Point[];
  /** Formata o valor do eixo/tooltip (ex.: "123 req/s"). */
  formatY: (y: number) => string;
  formatX: (x: number) => string;
  ariaLabel: string;
  height?: number;
}

/** Arredonda o máximo do eixo para um número "redondo" (1, 2, 5 × 10^n). */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const n = value / exp;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * exp;
}

const PAD = { top: 12, right: 12, bottom: 22, left: 48 };

/**
 * Gráfico de linha de uma série, sem dependências: linha de 2px na cor
 * principal, grade discreta e cruz + tooltip ao passar o mouse.
 */
export function LineChart({ points, formatY, formatX, ariaLabel, height = 180 }: LineChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { maxX, maxY, path } = useMemo(() => {
    const maxX = Math.max(1, ...points.map((p) => p.x));
    const maxY = niceMax(Math.max(0, ...points.map((p) => p.y)));
    const sx = (x: number) => PAD.left + (x / maxX) * (width - PAD.left - PAD.right);
    const sy = (y: number) => PAD.top + (1 - y / maxY) * (height - PAD.top - PAD.bottom);
    const path = points
      .map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
      .join(' ');
    return { maxX, maxY, path };
  }, [points, width, height]);

  const sx = (x: number) => PAD.left + (x / maxX) * (width - PAD.left - PAD.right);
  const sy = (y: number) => PAD.top + (1 - y / maxY) * (height - PAD.top - PAD.bottom);
  const gridValues = [0, maxY / 2, maxY];
  const hovered = hover !== null ? points[hover] : undefined;

  function onMove(event: React.MouseEvent<SVGRectElement>) {
    if (points.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * maxX;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs((points[i]?.x ?? 0) - x) < Math.abs((points[best]?.x ?? 0) - x)) best = i;
    }
    setHover(best);
  }

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
        {gridValues.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={sy(v)}
              y2={sy(v)}
              className="stroke-border"
              strokeWidth={1}
              strokeDasharray={v === 0 ? undefined : '3 4'}
            />
            <text
              x={PAD.left - 8}
              y={sy(v)}
              dy="0.32em"
              textAnchor="end"
              className="fill-fg-subtle text-[10px]"
            >
              {formatY(v)}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={height - 4} className="fill-fg-subtle text-[10px]">
          {formatX(0)}
        </text>
        <text x={width - PAD.right} y={height - 4} textAnchor="end" className="fill-fg-subtle text-[10px]">
          {formatX(maxX)}
        </text>

        {points.length > 1 && (
          <path
            d={path}
            fill="none"
            className="stroke-primary"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {points.length === 1 && points[0] && (
          <circle cx={sx(points[0].x)} cy={sy(points[0].y)} r={4} className="fill-primary" />
        )}

        {hovered && (
          <g pointerEvents="none">
            <line
              x1={sx(hovered.x)}
              x2={sx(hovered.x)}
              y1={PAD.top}
              y2={height - PAD.bottom}
              className="stroke-border-strong"
            />
            <circle
              cx={sx(hovered.x)}
              cy={sy(hovered.y)}
              r={4.5}
              className="fill-primary stroke-bg"
              strokeWidth={2}
            />
          </g>
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={Math.max(0, width - PAD.left - PAD.right)}
          height={height - PAD.top - PAD.bottom}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-border bg-elevated px-2 py-1 text-xs shadow-lg shadow-black/30"
          style={{ left: sx(hovered.x), top: Math.max(0, sy(hovered.y) - 44) }}
        >
          <span className="text-fg-muted">{formatX(hovered.x)} · </span>
          <span className="font-mono text-fg">{formatY(hovered.y)}</span>
        </div>
      )}
    </div>
  );
}
