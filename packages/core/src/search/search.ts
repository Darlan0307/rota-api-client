import { composeUrl } from '../http/url';
import type { HttpMethod, RequestData } from '../model/schemas';
import { type ContainerNode, isContainer, type TreeNode, type WorkspaceSnapshot } from '../model/tree';

export type SearchKind = 'collection' | 'folder' | 'request' | 'example' | 'environment';

export interface SearchResult {
  kind: SearchKind;
  id: string;
  /** Para exemplos: a requisição dona. */
  requestId?: string;
  title: string;
  /** Caminho ("Coleção › Pasta") ou URL. */
  path: string;
  method?: HttpMethod;
  url?: string;
  /** Onde casou e um trecho do conteúdo. */
  match: { field: string; snippet?: string | undefined };
  score: number;
}

interface Candidate {
  result: Omit<SearchResult, 'match' | 'score'>;
  fields: { field: string; text: string; weight: number }[];
}

/**
 * Busca em coleções, pastas, requisições (nome, URL e conteúdo), exemplos e
 * ambientes. Todos os termos digitados precisam aparecer (em qualquer campo).
 * Valores de variáveis secretas nunca são indexados.
 */
export function searchWorkspace(snapshot: WorkspaceSnapshot, query: string, limit = 50): SearchResult[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const results: SearchResult[] = [];
  for (const candidate of candidates(snapshot)) {
    const scored = score(candidate, terms);
    if (scored) results.push(scored);
  }
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'pt-BR')).slice(0, limit);
}

function* candidates(snapshot: WorkspaceSnapshot): Generator<Candidate> {
  const visit = function* (node: TreeNode, parents: ContainerNode[]): Generator<Candidate> {
    const path = parents.map((p) => p.name).join(' › ');
    if (node.kind === 'request') {
      const url = composeUrl(node.data.url, node.data.query);
      yield {
        result: { kind: 'request', id: node.id, title: node.name, path, method: node.data.method, url },
        fields: [
          { field: 'nome', text: node.name, weight: 10 },
          { field: 'URL', text: url, weight: 6 },
          { field: 'método', text: node.data.method, weight: 3 },
          ...contentFields(node.data),
        ],
      };
      for (const ex of node.examples) {
        yield {
          result: {
            kind: 'example',
            id: ex.id,
            requestId: node.id,
            title: ex.name,
            path: path ? `${path} › ${node.name}` : node.name,
          },
          fields: [
            { field: 'nome', text: ex.name, weight: 8 },
            { field: 'resposta', text: ex.response.body, weight: 1 },
          ],
        };
      }
      return;
    }
    yield {
      result: { kind: node.kind, id: node.id, title: node.name, path },
      fields: [
        { field: 'nome', text: node.name, weight: 10 },
        ...(node.description ? [{ field: 'descrição', text: node.description, weight: 1 }] : []),
        ...(node.kind === 'collection'
          ? [{ field: 'variáveis', text: node.variables.map((v) => v.key).join(' '), weight: 2 }]
          : []),
      ],
    };
    if (isContainer(node)) for (const child of node.children) yield* visit(child, [...parents, node]);
  };

  for (const collection of snapshot.collections) yield* visit(collection, []);
  for (const env of snapshot.environments) {
    yield {
      result: { kind: 'environment', id: env.id, title: env.name, path: 'Ambiente' },
      fields: [
        { field: 'nome', text: env.name, weight: 10 },
        { field: 'variáveis', text: env.variables.map((v) => v.key).join(' '), weight: 3 },
        {
          field: 'valores',
          text: env.variables
            .filter((v) => v.type !== 'secret')
            .map((v) => v.value ?? '')
            .join(' '),
          weight: 1,
        },
      ],
    };
  }
}

function contentFields(data: RequestData): Candidate['fields'] {
  const fields: Candidate['fields'] = [];
  const headers = data.headers.map((h) => `${h.key}: ${h.value}`).join('\n');
  if (headers) fields.push({ field: 'headers', text: headers, weight: 2 });
  if (data.body.mode === 'json' || data.body.mode === 'raw')
    fields.push({ field: 'body', text: data.body.text, weight: 1 });
  if (data.body.mode === 'urlencoded' || data.body.mode === 'formdata') {
    fields.push({
      field: 'body',
      text: data.body.fields.map((f) => `${f.key}=${f.value}`).join('\n'),
      weight: 1,
    });
  }
  const scripts = `${data.scripts.preRequest}\n${data.scripts.postResponse}`.trim();
  if (scripts) fields.push({ field: 'scripts', text: scripts, weight: 1 });
  if (data.description) fields.push({ field: 'descrição', text: data.description, weight: 1 });
  return fields;
}

function score(candidate: Candidate, terms: string[]): SearchResult | null {
  let total = 0;
  let best: { field: string; weight: number; text: string; index: number; term: string } | null = null;

  for (const term of terms) {
    let termScore = 0;
    for (const f of candidate.fields) {
      const text = normalize(f.text);
      const index = text.indexOf(term);
      if (index < 0) continue;
      let s = f.weight;
      if (f.field === 'nome') {
        if (text === term) s *= 3;
        else if (text.startsWith(term)) s *= 2;
        else if (index > 0 && /[\s\-_/.]/.test(text[index - 1] ?? '')) s *= 1.5;
      }
      if (s > termScore) termScore = s;
      if (!best || f.weight > best.weight)
        best = { field: f.field, weight: f.weight, text: f.text, index, term };
    }
    if (termScore === 0) return null; // todos os termos precisam casar
    total += termScore;
  }

  const showSnippet = best && best.field !== 'nome' && best.field !== 'método';
  return {
    ...candidate.result,
    match: {
      field: best?.field ?? 'nome',
      snippet: showSnippet && best ? snippet(best.text, best.index, best.term.length) : undefined,
    },
    score: total,
  };
}

function snippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 50);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

/** Minúsculas e sem acentos ("ação" casa com "acao"). */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
