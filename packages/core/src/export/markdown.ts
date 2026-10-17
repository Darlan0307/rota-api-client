import { composeUrl } from '../http/url';
import type { Auth, Body, KeyValue } from '../model/schemas';
import type { ChildNode, CollectionNode, FolderNode, RequestNode } from '../model/tree';

/**
 * Documentação da coleção em Markdown, gerada a partir do que está salvo:
 * descrições, parâmetros, headers, corpo e exemplos de resposta. Valores de
 * variáveis secretas nunca aparecem.
 */

const MAX_EXAMPLE_CHARS = 4000;

export function collectionToMarkdown(collection: CollectionNode): string {
  const out: string[] = [`# ${collection.name}`, ''];
  if (collection.description?.trim()) out.push(collection.description.trim(), '');

  const toc = tableOfContents(collection.children, 0);
  if (toc.length) out.push('## Sumário', '', ...toc, '');

  out.push(`**Autenticação:** ${describeAuth(collection.auth, true)}`, '');
  if (collection.variables.length) {
    out.push('## Variáveis da coleção', '', '| Nome | Valor | Descrição |', '| --- | --- | --- |');
    for (const v of collection.variables) {
      const value = v.type === 'secret' ? '_(secreta)_' : code(v.value ?? '');
      out.push(`| ${code(v.key)} | ${value} | ${cell(v.description ?? '')} |`);
    }
    out.push('');
  }

  for (const child of collection.children) renderChild(child, 2, out);
  return `${out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

function tableOfContents(children: readonly ChildNode[], depth: number): string[] {
  const lines: string[] = [];
  for (const child of children) {
    const indent = '  '.repeat(depth);
    const label = child.kind === 'request' ? `${child.data.method} ${child.name}` : child.name;
    lines.push(`${indent}- [${label}](#${anchor(label)})`);
    if (child.kind === 'folder') lines.push(...tableOfContents(child.children, depth + 1));
  }
  return lines;
}

function renderChild(node: ChildNode, level: number, out: string[]): void {
  if (node.kind === 'folder') renderFolder(node, level, out);
  else renderRequest(node, level, out);
}

function renderFolder(folder: FolderNode, level: number, out: string[]): void {
  out.push(`${heading(level)} ${folder.name}`, '');
  if (folder.description?.trim()) out.push(folder.description.trim(), '');
  if (folder.auth.type !== 'inherit') out.push(`**Autenticação:** ${describeAuth(folder.auth, false)}`, '');
  for (const child of folder.children) renderChild(child, Math.min(level + 1, 6), out);
}

function renderRequest(node: RequestNode, level: number, out: string[]): void {
  const { data } = node;
  out.push(`${heading(level)} ${data.method} ${node.name}`, '');
  out.push(
    '```http',
    `${data.method} ${composeUrl(
      data.url,
      data.query.filter((q) => q.enabled),
    )}`,
    '```',
    '',
  );
  if (data.description?.trim()) out.push(data.description.trim(), '');
  if (data.auth.type !== 'inherit') out.push(`**Autenticação:** ${describeAuth(data.auth, false)}`, '');

  table('Parâmetros de query', data.query, out);
  table('Headers', data.headers, out);
  renderBody(data.body, out);

  for (const example of node.examples) {
    out.push(
      `**Exemplo de resposta – ${example.name}** (${example.response.status} ${example.response.statusText})`.trim(),
      '',
    );
    const body = example.response.body;
    const json = /^\s*[[{]/.test(body);
    const shown = body.length > MAX_EXAMPLE_CHARS ? `${body.slice(0, MAX_EXAMPLE_CHARS)}\n…` : body;
    if (shown.trim()) out.push(`\`\`\`${json ? 'json' : ''}`, shown, '```', '');
  }
}

function table(title: string, rows: readonly KeyValue[], out: string[]): void {
  if (rows.length === 0) return;
  out.push(`**${title}**`, '', '| Nome | Valor | Obrigatório | Descrição |', '| --- | --- | --- | --- |');
  for (const r of rows) {
    out.push(
      `| ${code(r.key)} | ${code(r.value)} | ${r.enabled ? 'sim' : 'não'} | ${cell(r.description ?? '')} |`,
    );
  }
  out.push('');
}

function renderBody(body: Body, out: string[]): void {
  switch (body.mode) {
    case 'none':
      return;
    case 'json':
      out.push('**Corpo (JSON)**', '', '```json', body.text, '```', '');
      return;
    case 'raw':
      out.push(
        `**Corpo (${body.language})**`,
        '',
        `\`\`\`${body.language === 'text' ? '' : body.language}`,
        body.text,
        '```',
        '',
      );
      return;
    case 'urlencoded':
      table('Corpo (form-urlencoded)', body.fields, out);
      return;
    case 'formdata':
      out.push('**Corpo (multipart/form-data)**', '', '| Campo | Tipo | Valor |', '| --- | --- | --- |');
      for (const f of body.fields)
        out.push(`| ${code(f.key)} | ${f.type === 'file' ? 'arquivo' : 'texto'} | ${code(f.value)} |`);
      out.push('');
  }
}

function describeAuth(auth: Auth, isCollection: boolean): string {
  switch (auth.type) {
    case 'inherit':
      return 'herdada';
    case 'none':
      return isCollection ? 'nenhuma' : 'nenhuma (não herda)';
    case 'bearer':
      return `Bearer token (${code(auth.token || '…')})`;
    case 'basic':
      return `Basic (usuário ${code(auth.username || '…')})`;
    case 'apikey':
      return `API Key ${code(auth.key)} no ${auth.in === 'query' ? 'parâmetro de query' : 'header'}`;
  }
}

function heading(level: number): string {
  return '#'.repeat(Math.min(Math.max(level, 2), 6));
}

/** Âncora no estilo do GitHub. */
function anchor(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

function code(text: string): string {
  return text ? `\`${text.replaceAll('`', 'ˋ').replaceAll('|', '\\|')}\`` : '';
}

function cell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replaceAll('|', '\\|');
}
