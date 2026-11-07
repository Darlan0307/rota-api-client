import { Children, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/cn';

/** {{variável}} no meio do texto ganha o destaque usado nos editores. */
function withVariables(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== 'string' || !child.includes('{{')) return child;
    return child.split(/(\{\{[^{}]+\}\})/g).map((part, i) =>
      /^\{\{[^{}]+\}\}$/.test(part) ? (
        // biome-ignore lint/suspicious/noArrayIndexKey: pedaços fixos do mesmo texto
        <span key={i} className="rounded bg-primary-soft px-1 font-mono text-[0.9em] text-primary">
          {part}
        </span>
      ) : (
        part
      ),
    );
  });
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-8 mb-3 border-b border-border pb-2 text-xl font-semibold text-fg first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-7 mb-2.5 border-b border-border/60 pb-1.5 text-lg font-semibold text-fg first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 mb-2 text-[15px] font-semibold text-fg first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => <h4 className="mt-5 mb-1.5 text-sm font-semibold text-fg first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-4 mb-1 text-[13px] font-semibold text-fg">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-4 mb-1 text-xs font-semibold text-fg-muted">{children}</h6>,
  p: ({ children }) => <p className="my-2.5 leading-relaxed">{withVariables(children)}</p>,
  ul: ({ children, className }) => (
    <ul
      className={cn(
        'my-2.5 space-y-1 pl-5',
        className?.includes('contains-task-list') ? 'list-none pl-1' : 'list-disc',
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => <ol className="my-2.5 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed marker:text-fg-subtle">{withVariables(children)}</li>,
  a: ({ href, children }) => (
    // Links abrem no navegador (o processo principal só deixa sair http/https).
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline-offset-2 hover:underline"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 rounded-r-md border-l-2 border-primary/60 bg-surface-2/60 px-3 py-1 text-fg-muted">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-border" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface-2 text-left text-xs text-fg-muted">{children}</thead>,
  th: ({ children, style }) => (
    <th style={style} className="border-b border-border px-3 py-1.5 font-medium">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b border-border/60 px-3 py-1.5 align-top">
      {withVariables(children)}
    </td>
  ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-lg border border-border bg-surface p-3 font-mono text-xs leading-relaxed text-fg">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    // Dentro de <pre> (bloco) o estilo vem do pre; solto no texto vira "pílula".
    const block = /language-/.test(className ?? '') || String(children).includes('\n');
    if (block) return <code className="font-mono">{children}</code>;
    return (
      <code className="rounded bg-surface-2 px-1 py-px font-mono text-[0.88em] text-fg">{children}</code>
    );
  },
  img: ({ src, alt }) =>
    // A CSP do app não carrega imagens da internet: mostra o texto alternativo com o link.
    typeof src === 'string' && /^https?:/i.test(src) ? (
      <a href={src} target="_blank" rel="noreferrer" className="text-primary hover:underline">
        [imagem: {alt || src}]
      </a>
    ) : (
      <img src={src} alt={alt ?? ''} className="max-w-full rounded-md" />
    ),
  input: ({ checked }) => (
    <input
      type="checkbox"
      checked={checked ?? false}
      readOnly
      className="mr-1.5 align-middle accent-primary"
    />
  ),
};

/**
 * Markdown renderizado (GFM: tabelas, listas de tarefas, riscado). HTML
 * escrito no texto não é interpretado: a documentação vem do Claude (MCP) e de
 * imports, e o renderer tem acesso ao IPC.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('min-w-0 break-words text-[13.5px] text-fg/90', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
