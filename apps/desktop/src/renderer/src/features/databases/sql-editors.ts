import type { monaco } from '../../lib/monaco';
import { queryOf, updateQuery } from './state';

/** Editor SQL aberto de cada conexão, para os diálogos inserirem comandos nele. */
const editors = new Map<string, monaco.editor.IStandaloneCodeEditor>();

export function registerSqlEditor(connectionId: string, editor: monaco.editor.IStandaloneCodeEditor): void {
  editors.set(connectionId, editor);
  editor.onDidDispose(() => {
    if (editors.get(connectionId) === editor) editors.delete(connectionId);
  });
}

interface SnippetController {
  insert(template: string): void;
}

/**
 * Acrescenta um comando no fim do editor (sem apagar o que já está lá), deixa
 * o cursor no começo dele, para o Ctrl+Enter rodar, e dá foco. Com `snippet`,
 * os campos ${1:tabela} viram campos para preencher com Tab.
 */
export function appendToSqlEditor(
  connectionId: string,
  text: string,
  options: { snippet?: boolean } = {},
): void {
  const editor = editors.get(connectionId);
  const model = editor?.getModel();
  if (!editor || !model) {
    // Sem editor montado (não deveria acontecer): grava no texto da aba.
    const current = queryOf(connectionId).sql.trimEnd();
    updateQuery(connectionId, { sql: current ? `${current}\n\n${text}` : text });
    return;
  }
  const kept = model.getValue().trimEnd();
  const lastLine = kept.slice(kept.lastIndexOf('\n') + 1).trim();
  // Sem ";" no fim, o Ctrl+Enter juntaria o comando anterior com o novo num só.
  const close = kept && !kept.endsWith(';') && !lastLine.startsWith('--') ? ';' : '';
  const from = model.getPositionAt(kept.length);
  const end = model.getFullModelRange().getEndPosition();
  editor.executeEdits('rota', [
    {
      range: {
        startLineNumber: from.lineNumber,
        startColumn: from.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      },
      text: kept ? `${close}\n\n` : '',
      forceMoveMarkers: true,
    },
  ]);
  const start = model.getFullModelRange().getEndPosition();
  editor.setPosition(start);
  const snippets = options.snippet
    ? (editor.getContribution('snippetController2') as SnippetController | null)
    : null;
  if (snippets) snippets.insert(text);
  else {
    editor.executeEdits('rota', [
      {
        range: {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: start.lineNumber,
          endColumn: start.column,
        },
        text,
        forceMoveMarkers: true,
      },
    ]);
    editor.setPosition(start);
  }
  editor.revealLineInCenterIfOutsideViewport(start.lineNumber);
  editor.focus();
}
