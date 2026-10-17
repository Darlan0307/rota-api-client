import { SQL_KEYWORDS, statementAt, tableForQualifier } from '@rota/core/shared';
import { monaco } from '../../lib/monaco';
import { useDatabases } from './state';

/** Qual conexão cada editor SQL usa (o provedor de sugestões é um só para a linguagem). */
const editors = new WeakMap<monaco.editor.ITextModel, string>();
let registered = false;

export function bindSqlEditor(editor: monaco.editor.IStandaloneCodeEditor, connectionId: string): void {
  const model = editor.getModel();
  if (model) editors.set(model, connectionId);
  registerSqlCompletion();
}

function registerSqlCompletion(): void {
  if (registered) return;
  registered = true;
  const { CompletionItemKind } = monaco.languages;
  monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      const connectionId = editors.get(model);
      const schema = connectionId ? useDatabases.getState().schemas[connectionId] : undefined;
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const text = model.getValue();
      const offset = model.getOffsetAt(position);
      const statement = statementAt(text, offset)?.text ?? text;
      const tableNames = schema?.tables.map((t) => t.name) ?? [];
      const before = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: word.startColumn,
      });

      // "P." → colunas da tabela (ou do alias).
      const qualified = /("?[\w$]+"?)\.$/.exec(before);
      if (qualified?.[1]) {
        const table = tableForQualifier(statement, qualified[1].replaceAll('"', ''), tableNames);
        const columns = schema?.tables.find((t) => t.name === table)?.columns ?? [];
        return {
          suggestions: columns.map((c) => ({
            label: { label: c.name, description: c.type },
            kind: CompletionItemKind.Field,
            insertText: c.name,
            detail: `${table}.${c.name} ${c.type}${c.primaryKey ? ' · PK' : ''}`,
            range,
          })),
        };
      }

      // Colunas das tabelas citadas no comando aparecem primeiro.
      const mentioned = new Set(
        tableNames.filter((name) => new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'i').test(statement)),
      );
      const suggestions: monaco.languages.CompletionItem[] = [];
      for (const table of schema?.tables ?? []) {
        suggestions.push({
          label: { label: table.name, description: table.kind === 'view' ? 'view' : 'tabela' },
          kind: table.kind === 'view' ? CompletionItemKind.Interface : CompletionItemKind.Class,
          insertText: table.name,
          range,
          sortText: `1${table.name}`,
        });
        if (!mentioned.has(table.name)) continue;
        for (const c of table.columns)
          suggestions.push({
            label: { label: c.name, description: `${table.name} · ${c.type}` },
            kind: CompletionItemKind.Field,
            insertText: c.name,
            range,
            sortText: `0${c.name}`,
          });
      }
      for (const name of schema?.procedures ?? [])
        suggestions.push({
          label: name,
          kind: CompletionItemKind.Function,
          insertText: name,
          range,
          sortText: `2${name}`,
        });
      for (const keyword of SQL_KEYWORDS)
        suggestions.push({
          label: keyword,
          kind: CompletionItemKind.Keyword,
          insertText: keyword,
          range,
          sortText: `3${keyword}`,
        });
      return { suggestions };
    },
  });
}
