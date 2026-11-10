import { useCallback, useRef, useState } from 'react';
import { type PanelSize, usePanelRef } from 'react-resizable-panels';

/**
 * Painel que pode ser recolhido pelo botão ou arrastando a divisória (o
 * `useDefaultLayout` do grupo guarda o estado recolhido junto com o tamanho).
 * Espalhe `panelProps` no `<Panel>` (com `collapsible` e o mesmo `collapsedSize`).
 */
export function useCollapsiblePanel({
  collapsedPx,
  fallbackSize,
}: {
  /** Tamanho recolhido em pixels (o mesmo `collapsedSize` do Panel). */
  collapsedPx: number;
  /** Tamanho ao expandir quando não há um anterior (ex.: layout salvo já recolhido). */
  fallbackSize: string;
}) {
  const panelRef = usePanelRef();
  const [collapsed, setCollapsed] = useState(false);
  const fallbackRef = useRef(fallbackSize);
  fallbackRef.current = fallbackSize;

  const onResize = useCallback(
    (size: PanelSize) => setCollapsed(size.inPixels <= collapsedPx + 1),
    [collapsedPx],
  );

  const expand = useCallback(() => {
    const panel = panelRef.current;
    if (!panel?.isCollapsed()) return;
    panel.expand();
    // Aberto já recolhido (layout salvo), o painel não tem tamanho anterior para voltar.
    if (panel.getSize().inPixels <= collapsedPx + 1) panel.resize(fallbackRef.current);
  }, [panelRef, collapsedPx]);

  const collapse = useCallback(() => {
    const panel = panelRef.current;
    if (panel && !panel.isCollapsed()) panel.collapse();
  }, [panelRef]);

  const toggle = useCallback(() => {
    if (panelRef.current?.isCollapsed()) expand();
    else collapse();
  }, [panelRef, expand, collapse]);

  return { collapsed, expand, collapse, toggle, panelProps: { panelRef, onResize } };
}
