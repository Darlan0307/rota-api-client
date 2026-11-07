import { type DocTarget, documentationPrompt } from '@rota/core/shared';
import { BookOpen, Eye, PenLine, Save, Sparkles } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button } from '../../components/Button';
import { CodeEditor } from '../../components/CodeEditor';
import { Markdown } from '../../components/Markdown';
import { copyPrompt } from '../claude/AskClaude';

interface DocPanelProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  dirty: boolean;
  /** Para o pedido "Pedir ao Claude" (só itens já salvos têm id). */
  target: DocTarget | null;
  /** Título da página (nome, ícone, caminho). */
  header?: ReactNode;
  /** Conteúdo gerado abaixo do texto (ex.: índice dos endpoints), só na leitura. */
  children?: ReactNode;
  placeholder: string;
}

/**
 * Documentação em Markdown mostrada como página, com edição lado a lado
 * (editor e prévia). A maior parte vem do Claude pelo MCP; aqui o usuário lê
 * e revisa.
 */
export function DocPanel({
  value,
  onChange,
  onSave,
  dirty,
  target,
  header,
  children,
  placeholder,
}: DocPanelProps) {
  const [editing, setEditing] = useState(false);
  const empty = value.trim() === '';
  const askClaude = target ? () => void copyPrompt(documentationPrompt(target)) : undefined;

  if (editing)
    return (
      <div className="@container flex h-full min-h-0 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
          <PenLine className="size-3.5 text-fg-subtle" />
          <span className="text-xs text-fg-muted">
            Editando em Markdown: <code className="font-mono"># título</code>,{' '}
            <code className="font-mono">**negrito**</code>, <code className="font-mono">`código`</code>,
            listas e tabelas
          </span>
          <div className="flex-1" />
          {dirty && (
            <Button size="sm" variant="primary" onClick={onSave}>
              <Save className="size-3.5" /> Salvar
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
            <Eye className="size-3.5" /> Ver página
          </Button>
        </div>
        <div className="grid min-h-0 flex-1 grid-rows-2 @3xl:grid-cols-2 @3xl:grid-rows-1">
          <div className="min-h-0 border-border @3xl:border-r">
            <CodeEditor
              value={value}
              onChange={onChange}
              language="markdown"
              placeholder={placeholder}
              onShortcut={(s) => s === 'save' && onSave()}
            />
          </div>
          <div className="min-h-0 overflow-y-auto border-t border-border px-6 py-5 @3xl:border-t-0">
            <p className="mb-3 text-2xs font-medium uppercase tracking-wide text-fg-subtle">Prévia</p>
            {empty ? (
              <p className="text-xs text-fg-subtle">A prévia aparece aqui enquanto você escreve.</p>
            ) : (
              <Markdown text={value} />
            )}
          </div>
        </div>
      </div>
    );

  return (
    <div className="h-full overflow-y-auto">
      <article className="mx-auto w-full max-w-3xl px-8 pt-6 pb-16">
        <div className="mb-5 flex items-start gap-3">
          <div className="min-w-0 flex-1">{header}</div>
          <div className="flex shrink-0 items-center gap-1">
            {askClaude && (
              <Button
                size="sm"
                variant="ghost"
                title="Copia um pedido pronto para o Claude escrever ou melhorar esta documentação pelo MCP"
                onClick={askClaude}
              >
                <Sparkles className="size-3.5" /> Pedir ao Claude
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              <PenLine className="size-3.5" /> Editar
            </Button>
          </div>
        </div>

        {empty ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-8 text-center">
            <BookOpen className="mx-auto mb-2 size-6 text-fg-subtle" strokeWidth={1.5} />
            <p className="text-sm font-medium text-fg">Ainda sem documentação</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-fg-muted">
              Escreva em Markdown ou peça ao Claude: o pedido copiado já diz o que documentar e onde gravar.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                <PenLine className="size-3.5" /> Escrever
              </Button>
              {askClaude && (
                <Button size="sm" variant="primary" onClick={askClaude}>
                  <Sparkles className="size-3.5" /> Pedir ao Claude
                </Button>
              )}
            </div>
          </div>
        ) : (
          <Markdown text={value} />
        )}
        {dirty && !editing && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary-soft/40 px-3 py-2 text-xs">
            <span className="flex-1 text-fg-muted">A documentação tem alterações não salvas.</span>
            <Button size="sm" variant="primary" onClick={onSave}>
              <Save className="size-3.5" /> Salvar
            </Button>
          </div>
        )}
        {children}
      </article>
    </div>
  );
}
