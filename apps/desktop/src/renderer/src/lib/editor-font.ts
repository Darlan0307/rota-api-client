import { useMemo } from 'react';
import { useUiStore } from '../state/ui';
import { editorFontOptions } from '../theme/display';

/** Fonte dos editores escolhida em Configurações → Aparência (opções prontas para o Monaco). */
export function useEditorFont() {
  const font = useUiStore((s) => s.editorFont);
  const size = useUiStore((s) => s.editorFontSize);
  return useMemo(() => editorFontOptions(font, size), [font, size]);
}
