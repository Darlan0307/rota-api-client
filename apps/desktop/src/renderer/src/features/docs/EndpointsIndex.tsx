import { type ChildNode, type ContainerNode, composeUrl, type RequestNode } from '@rota/core/shared';
import { ChevronRight, Folder } from 'lucide-react';
import { Markdown } from '../../components/Markdown';
import { MethodBadge } from '../../components/MethodBadge';
import { cn } from '../../lib/cn';
import { statusTone } from '../../lib/format';
import { ItemIcon } from '../../lib/item-icons';
import { openItemById } from '../request/open';

function countRequests(children: readonly ChildNode[]): number {
  return children.reduce((n, c) => n + (c.kind === 'request' ? 1 : countRequests(c.children)), 0);
}

function RequestCard({ node }: { node: RequestNode }) {
  const { data } = node;
  const statuses = [...new Set(node.examples.map((e) => e.response.status))].sort((a, b) => a - b);
  return (
    <section id={`doc-${node.id}`} className="rounded-xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => openItemById(node.id)}
        title="Abrir a requisição"
        className="group flex w-full min-w-0 items-center gap-2.5 rounded-t-xl px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
      >
        <MethodBadge method={data.method} className="shrink-0" />
        <span className="shrink-0 text-[13px] font-medium text-fg">{node.name}</span>
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">
          {composeUrl(data.url, data.query)}
        </code>
        <ChevronRight className="size-3.5 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
      {(data.description?.trim() || statuses.length > 0) && (
        <div className="border-t border-border/70 px-4 py-2">
          {data.description?.trim() ? <Markdown text={data.description} className="text-[13px]" /> : null}
          {statuses.length > 0 && (
            <p className="my-2 flex flex-wrap items-center gap-1.5 text-2xs text-fg-subtle">
              Exemplos salvos:
              {statuses.map((s) => (
                <span key={s} className={cn('rounded bg-surface-2 px-1.5 py-px font-mono', statusTone(s))}>
                  {s}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Children({ nodes, depth }: { nodes: readonly ChildNode[]; depth: number }) {
  return (
    <div className="space-y-3">
      {nodes.map((child) =>
        child.kind === 'request' ? (
          <RequestCard key={child.id} node={child} />
        ) : (
          <div key={child.id} className={cn('space-y-3', depth === 0 ? 'pt-4' : 'pt-2')}>
            <button
              type="button"
              onClick={() => openItemById(child.id)}
              title="Abrir a documentação da pasta"
              className="flex items-center gap-2 text-left text-[15px] font-semibold text-fg hover:text-primary"
            >
              <ItemIcon kind="folder" appearance={child.appearance} className="size-4" />
              {child.name}
              <span className="text-xs font-normal text-fg-subtle">
                {countRequests(child.children)}{' '}
                {countRequests(child.children) === 1 ? 'endpoint' : 'endpoints'}
              </span>
            </button>
            {child.description?.trim() ? <Markdown text={child.description} className="text-[13px]" /> : null}
            <div className="border-l border-border pl-4">
              <Children nodes={child.children} depth={depth + 1} />
            </div>
          </div>
        ),
      )}
    </div>
  );
}

/** Índice gerado da coleção/pasta: pastas, requisições e a documentação de cada uma. */
export function EndpointsIndex({ node }: { node: ContainerNode }) {
  const total = countRequests(node.children);
  return (
    <div className="mt-10">
      <h2 className="mb-1 flex items-center gap-2 border-b border-border pb-2 text-lg font-semibold text-fg">
        Endpoints
        <span className="text-xs font-normal text-fg-subtle">{total}</span>
      </h2>
      <p className="mb-4 text-xs text-fg-subtle">
        Montado a partir das requisições: clique numa para abrir. A documentação de cada uma fica na aba Docs
        da requisição.
      </p>
      {total === 0 ? (
        <p className="flex items-center gap-2 text-xs text-fg-muted">
          <Folder className="size-3.5" /> Nenhuma requisição aqui ainda.
        </p>
      ) : (
        <Children nodes={node.children} depth={0} />
      )}
    </div>
  );
}
