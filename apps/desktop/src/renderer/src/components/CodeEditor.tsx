import Editor, { type OnMount } from '@monaco-editor/react';
import { findVariableRefs, jsonSyntaxError, variableRefAt } from '@rota/core/shared';
import { useEffect, useRef } from 'react';
import { monaco, ROTA_THEME } from '../lib/monaco';
import { DYNAMIC_SUGGESTIONS, useVariableNames, useVariableResolver } from '../lib/variables';
import { useVariableHover, VariablePopover } from './VariablePopover';

export type EditorLanguage = 'json' | 'javascript' | 'xml' | 'html' | 'plaintext' | 'css' | 'sql';

// ---------------------------------------------------------------------------
// Autocompletar {{variáveis}} nos editores com `variables` (body)

interface CompletionEntry {
  name: string;
  detail: string;
}

/** Sugestões por modelo (cada editor com `variables` registra a sua fonte). */
const completionSources = new Map<string, () => CompletionEntry[]>();
let completionRegistered = false;

function registerVariableCompletion(): void {
  if (completionRegistered) return;
  completionRegistered = true;
  for (const language of ['json', 'xml', 'html', 'plaintext']) {
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['{', '$'],
      provideCompletionItems(model, position) {
        const source = completionSources.get(model.uri.toString());
        const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const match = /\{\{([\w.$-]*)$/.exec(before);
        if (!source || !match) return { suggestions: [] };
        const typed = match[1] ?? '';
        const range = new monaco.Range(
          position.lineNumber,
          position.column - typed.length,
          position.lineNumber,
          position.column,
        );
        const after = model.getLineContent(position.lineNumber).slice(position.column - 1);
        const close = after.startsWith('}}') ? '' : '}}';
        return {
          suggestions: source().map((entry, i) => ({
            label: entry.name,
            kind: monaco.languages.CompletionItemKind.Variable,
            detail: entry.detail,
            insertText: `${entry.name}${close}`,
            range,
            sortText: String(i).padStart(4, '0'),
          })),
        };
      },
    });
  }
}

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
  const names = useVariableNames();
  const namesRef = useRef(names);
  namesRef.current = names;
  const shortcutRef = useRef(onShortcut);
  shortcutRef.current = onShortcut;
  const popover = useVariableHover();
  const popoverRef = useRef(popover);
  popoverRef.current = popover;

  const updateDecorations = () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const text = model.getValue();
    if (variables) {
      // O valor aparece no VariablePopover (com edição), não no hover do Monaco.
      const decorations = findVariableRefs(text).map((ref) => {
        const start = model.getPositionAt(ref.start);
        const end = model.getPositionAt(ref.end);
        return {
          range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
          options: {
            inlineClassName: resolveRef.current(ref.name) ? 'rota-var' : 'rota-var rota-var-missing',
          },
        };
      });
      decorationsRef.current ??= editor.createDecorationsCollection();
      decorationsRef.current.set(decorations);
    }

    if (language === 'json' && !readOnly) {
      const syntax = jsonSyntaxError(text);
      const start = syntax ? model.getPositionAt(syntax.offset) : null;
      const end = syntax ? model.getPositionAt(syntax.offset + 1) : null;
      monaco.editor.setModelMarkers(
        model,
        'rota-json',
        syntax && start && end
          ? [
              {
                severity: monaco.MarkerSeverity.Error,
                message: syntax.message,
                startLineNumber: start.lineNumber,
                startColumn: start.column,
                endLineNumber: end.lineNumber,
                endColumn: end.column === start.column ? start.column + 1 : end.column,
              },
            ]
          : [],
      );
    }
  };

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    onEditor?.(editor);
    updateDecorations();
    const model = editor.getModel();
    if (variables && model) {
      registerVariableCompletion();
      const key = model.uri.toString();
      completionSources.set(key, () => [
        ...namesRef.current.map((name) => ({ name, detail: resolveRef.current(name)?.sourceLabel ?? '' })),
        ...DYNAMIC_SUGGESTIONS.map((v) => ({ name: v.name, detail: `${v.description} (novo a cada envio)` })),
      ]);
      editor.onDidDispose(() => completionSources.delete(key));

      editor.onMouseMove((event) => {
        const position = event.target.position;
        const ref = position ? variableRefAt(model.getValue(), model.getOffsetAt(position)) : undefined;
        const at = ref ? editor.getScrolledVisiblePosition(model.getPositionAt(ref.start)) : null;
        const dom = editor.getDomNode();
        if (!ref || !at || !dom) {
          popoverRef.current.scheduleClose();
          return;
        }
        const rect = dom.getBoundingClientRect();
        popoverRef.current.show({
          name: ref.name,
          x: rect.left + at.left,
          y: rect.top + at.top + at.height + 4,
        });
      });
      editor.onMouseLeave(() => popoverRef.current.scheduleClose());
    }
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
      {popover.hover && (
        <VariablePopover
          hover={popover.hover}
          onEnter={popover.enter}
          onLeave={popover.leave}
          onClose={popover.close}
          onPin={popover.pin}
        />
      )}
    </div>
  );
}
