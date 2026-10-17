import Editor, { type OnMount } from '@monaco-editor/react';
import { findVariableRefs } from '@rota/core/shared';
import { useEffect, useRef } from 'react';
import { monaco, ROTA_THEME } from '../lib/monaco';
import { useVariableResolver } from '../lib/variables';

export type EditorLanguage = 'json' | 'javascript' | 'xml' | 'html' | 'plaintext' | 'css';

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language: EditorLanguage;
  readOnly?: boolean;
  /** Destaca {{variáveis}} com tooltip do valor resolvido. */
  variables?: boolean;
  /** Recebe o editor montado (ex.: para abrir a busca). */
  onEditor?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  placeholder?: string;
  wordWrap?: boolean;
  /** Atalho Ctrl+Enter / Ctrl+S dentro do editor (o Monaco captura o teclado). */
  onShortcut?: (shortcut: 'send' | 'save') => void;
}

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  variables = false,
  onEditor,
  placeholder,
  wordWrap = true,
  onShortcut,
}: CodeEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const resolve = useVariableResolver();
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const shortcutRef = useRef(onShortcut);
  shortcutRef.current = onShortcut;

  const updateDecorations = () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !variables) return;
    const text = model.getValue();
    const decorations = findVariableRefs(text).map((ref) => {
      const start = model.getPositionAt(ref.start);
      const end = model.getPositionAt(ref.end);
      const info = resolveRef.current(ref.name);
      return {
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        options: {
          inlineClassName: info ? 'rota-var' : 'rota-var rota-var-missing',
          hoverMessage: {
            value: info
              ? `**${ref.name}** = \`${info.display}\` _(${info.sourceLabel})_`
              : `**${ref.name}**: variável não definida`,
          },
        },
      };
    });
    decorationsRef.current ??= editor.createDecorationsCollection();
    decorationsRef.current.set(decorations);
  };

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    onEditor?.(editor);
    updateDecorations();
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => shortcutRef.current?.('send'));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => shortcutRef.current?.('save'));
  };

  // Redesenha os destaques quando o texto ou os valores das variáveis mudam.
  // biome-ignore lint/correctness/useExhaustiveDependencies: updateDecorations lê refs atualizadas
  useEffect(() => {
    updateDecorations();
  }, [value, resolve, variables]);

  return (
    <div className="relative h-full min-h-0">
      {placeholder && value === '' && !readOnly && (
        <div className="pointer-events-none absolute left-[52px] top-2 z-10 font-mono text-[13px] text-fg-subtle">
          {placeholder}
        </div>
      )}
      <Editor
        value={value}
        language={language}
        theme={ROTA_THEME}
        onChange={(v) => onChange?.(v ?? '')}
        onMount={handleMount}
        loading={<div className="p-4 text-xs text-fg-subtle">Carregando editor…</div>}
        options={{
          readOnly,
          domReadOnly: readOnly,
          minimap: { enabled: false },
          fontFamily: "'JetBrains Mono Variable', Consolas, monospace",
          fontSize: 13,
          lineHeight: 20,
          fontLigatures: false,
          scrollBeyondLastLine: false,
          wordWrap: wordWrap ? 'on' : 'off',
          tabSize: 2,
          automaticLayout: true,
          renderLineHighlight: readOnly ? 'none' : 'line',
          lineNumbersMinChars: 3,
          folding: true,
          padding: { top: 8, bottom: 8 },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          contextmenu: true,
          fixedOverflowWidgets: true,
          stickyScroll: { enabled: false },
          guides: { indentation: true },
          renderValidationDecorations: readOnly ? 'off' : 'on',
        }}
      />
    </div>
  );
}
