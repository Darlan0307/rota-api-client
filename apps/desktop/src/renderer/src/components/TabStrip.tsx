import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';

/**
 * Faixa de abas que rola na horizontal quando falta espaço: sem barra de
 * rolagem visível, roda do mouse rola para os lados, bordas esmaecidas
 * indicam que há mais abas e a aba ativa é trazida para a vista.
 */
export function TabStrip({
  children,
  className,
  activeKey,
}: {
  children: ReactNode;
  className?: string;
  /** Muda quando a aba ativa muda (para rolar até ela). */
  activeKey?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setEdges({
        left: el.scrollLeft > 1,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, []);

  useEffect(() => {
    if (activeKey === undefined) return;
    ref.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeKey]);

  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? 'transparent, black 24px' : 'black'}, ${
          edges.right ? 'black calc(100% - 24px), transparent' : 'black'
        })`
      : undefined;

  return (
    <div
      ref={ref}
      role="tablist"
      onWheel={(e) => {
        const el = ref.current;
        if (el && e.deltaY !== 0 && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY;
      }}
      style={mask ? { maskImage: mask } : undefined}
      className={cn('scrollbar-none flex min-w-0 overflow-x-auto', className)}
    >
      {children}
    </div>
  );
}
