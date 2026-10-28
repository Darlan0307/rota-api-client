import { useEffect, useState } from 'react';
import { api } from './api';

/** Zoom da interface (1 = 100%), atualizado quando muda por atalho ou nas Configurações. */
export function useUiZoom(): number {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let alive = true;
    void api.invoke('settings:get').then((s) => alive && setZoom(s.uiZoom));
    const off = api.on('ui:zoom', setZoom);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return zoom;
}

export function setUiZoom(uiZoom: number): void {
  void api.invoke('settings:update', { uiZoom });
}
