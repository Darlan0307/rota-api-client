import type { Auth, ExampleFile, RequestData, Scripts, Variable } from './schemas';

/**
 * Visão em memória do workspace, montada a partir dos arquivos. É o que o app
 * (via IPC) e o servidor MCP enxergam. Valores de variáveis `secret` nunca
 * aparecem aqui — só `hasValue` indica se há valor salvo.
 */

export interface VariableView extends Variable {
  /** Para variáveis secret: indica se existe valor salvo localmente. */
  hasValue?: boolean;
}

export interface RequestNode {
  kind: 'request';
  id: string;
  name: string;
  parentId: string;
  data: RequestData;
  examples: ExampleFile[];
}

export interface FolderNode {
  kind: 'folder';
  id: string;
  name: string;
  parentId: string;
  auth: Auth;
  scripts: Scripts;
  description?: string | undefined;
  children: ChildNode[];
}

export interface CollectionNode {
  kind: 'collection';
  id: string;
  name: string;
  auth: Auth;
  variables: VariableView[];
  scripts: Scripts;
  description?: string | undefined;
  children: ChildNode[];
}

export type ChildNode = FolderNode | RequestNode;
export type TreeNode = CollectionNode | ChildNode;
export type ContainerNode = CollectionNode | FolderNode;

export interface EnvironmentView {
  id: string;
  name: string;
  variables: VariableView[];
}

export interface LoadProblem {
  path: string;
  message: string;
}

export interface WorkspaceSnapshot {
  root: string;
  id: string;
  name: string;
  globals: VariableView[];
  environments: EnvironmentView[];
  collections: CollectionNode[];
  /** Arquivos que não puderam ser lidos (JSON inválido, schema incompatível...). */
  problems: LoadProblem[];
}

export function isContainer(node: TreeNode): node is ContainerNode {
  return node.kind === 'collection' || node.kind === 'folder';
}

/** Percorre a árvore em profundidade (pré-ordem). */
export function* walkTree(nodes: readonly TreeNode[]): Generator<TreeNode> {
  for (const node of nodes) {
    yield node;
    if (isContainer(node)) yield* walkTree(node.children);
  }
}

export function findNode(snapshot: Pick<WorkspaceSnapshot, 'collections'>, id: string): TreeNode | undefined {
  for (const node of walkTree(snapshot.collections)) if (node.id === id) return node;
  return undefined;
}

/** Ancestrais de um nó, do pai imediato até a coleção. */
export function ancestorsOf(snapshot: Pick<WorkspaceSnapshot, 'collections'>, id: string): ContainerNode[] {
  const parents = new Map<string, ContainerNode>();
  for (const node of walkTree(snapshot.collections)) {
    if (isContainer(node)) for (const child of node.children) parents.set(child.id, node);
  }
  const result: ContainerNode[] = [];
  let current = parents.get(id);
  while (current) {
    result.push(current);
    current = parents.get(current.id);
  }
  return result;
}

export function collectionOf(
  snapshot: Pick<WorkspaceSnapshot, 'collections'>,
  id: string,
): CollectionNode | undefined {
  const node = findNode(snapshot, id);
  if (node?.kind === 'collection') return node;
  const last = ancestorsOf(snapshot, id).at(-1);
  return last?.kind === 'collection' ? last : undefined;
}
