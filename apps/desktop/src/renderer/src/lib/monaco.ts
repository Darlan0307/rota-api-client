import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import type { Palette } from '../theme/palettes';

/**
 * Monaco carregado do pacote local (sem CDN): funciona offline e respeita a CSP.
 */
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'json') return new JsonWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });

export { monaco };

export const ROTA_THEME = 'rota-dark';

function hex(color: string): string {
  return color.replace('#', '');
}

/** Tema do Monaco derivado da paleta ativa (chamado ao trocar de paleta). */
export function defineMonacoTheme(palette: Palette): void {
  const c = palette.colors;
  monaco.editor.defineTheme(ROTA_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'string.key.json', foreground: hex(c.method.put) },
      { token: 'string.value.json', foreground: hex(c.method.get) },
      { token: 'number', foreground: hex(c.method.post) },
      { token: 'keyword', foreground: hex(c.method.patch) },
      { token: 'string', foreground: hex(c.method.get) },
      { token: 'comment', foreground: hex(c.fgSubtle), fontStyle: 'italic' },
      { token: 'tag', foreground: hex(c.method.put) },
      { token: 'attribute.name', foreground: hex(c.method.patch) },
      { token: 'attribute.value', foreground: hex(c.method.get) },
    ],
    colors: {
      'editor.background': c.bg,
      'editor.foreground': c.fg,
      'editorLineNumber.foreground': c.fgSubtle,
      'editorLineNumber.activeForeground': c.fgMuted,
      'editor.lineHighlightBackground': `${c.surface}`,
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': c.primarySoft,
      'editor.inactiveSelectionBackground': `${c.primarySoft}99`,
      'editorCursor.foreground': c.primary,
      'editorIndentGuide.background1': c.border,
      'editorIndentGuide.activeBackground1': c.borderStrong,
      'editorWidget.background': c.elevated,
      'editorWidget.border': c.border,
      'editorHoverWidget.background': c.elevated,
      'editorHoverWidget.border': c.border,
      'editorSuggestWidget.background': c.elevated,
      'editorSuggestWidget.border': c.border,
      'editorSuggestWidget.selectedBackground': c.surface2,
      'input.background': c.surface2,
      'input.border': c.border,
      focusBorder: c.primary,
      'scrollbarSlider.background': `${c.border}aa`,
      'scrollbarSlider.hoverBackground': c.borderStrong,
      'editor.findMatchBackground': `${c.warning}55`,
      'editor.findMatchHighlightBackground': `${c.warning}33`,
      'editorBracketMatch.background': c.surface2,
      'editorBracketMatch.border': c.borderStrong,
      'editorGutter.background': c.bg,
      'editorOverviewRuler.border': '#00000000',
    },
  });
  monaco.editor.setTheme(ROTA_THEME);
}
