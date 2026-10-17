import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { z } from 'zod';
import {
  type Auth,
  type CollectionFile,
  CollectionFileSchema,
  type EnvironmentFile,
  EnvironmentFileSchema,
  type ExampleFile,
  ExampleFileSchema,
  type FolderFile,
  FolderFileSchema,
  type GlobalsFile,
  GlobalsFileSchema,
  type RequestData,
  type RequestDataInput,
  RequestDataSchema,
  type RequestFile,
  RequestFileSchema,
  SCHEMA_VERSION,
  type Scripts,
  type Variable,
  type WorkspaceManifest,
  WorkspaceManifestSchema,
} from '../model/schemas';
import type {
  ChildNode,
  CollectionNode,
  EnvironmentView,
  FolderNode,
  LoadProblem,
  RequestNode,
  WorkspaceSnapshot,
} from '../model/tree';
import { GLOBAL_SCOPE, type SecretScope, type SecretStore } from '../secrets/secret-store';
import { isNotFound, readJson, readJsonIfExists, TEMP_SUFFIX, writeJsonAtomic } from '../util/fs';
import { newId } from '../util/ids';
import { Mutex } from '../util/mutex';
import { uniqueSlug } from '../util/slug';
import { persistVariables, type VariableInput, viewVariables, withSecretValues } from '../variables/persist';
import type { ScopeLayer } from '../variables/template';
import {
  COLLECTION_FILE,
  COLLECTIONS_DIR,
  ENVIRONMENT_EXT,
  ENVIRONMENTS_DIR,
  EXAMPLE_EXT,
  EXAMPLES_SUFFIX,
  FOLDER_FILE,
  GLOBALS_FILE,
  MANIFEST_FILE,
  REQUEST_EXT,
  stem,
} from './layout';

type Entry =
  | { kind: 'collection'; id: string; dir: string; file: CollectionFile }
  | { kind: 'folder'; id: string; dir: string; parentId: string; file: FolderFile }
  | { kind: 'request'; id: string; path: string; parentId: string; file: RequestFile }
  | { kind: 'environment'; id: string; path: string; file: EnvironmentFile }
  | { kind: 'example'; id: string; path: string; requestId: string; file: ExampleFile };

type ContainerEntry = Extract<Entry, { kind: 'collection' | 'folder' }>;

export type ItemKind = Entry['kind'];

/** Descrição de um item para a lixeira (onde está, onde voltar, quais segredos guardar). */
export interface ItemDescription {
  kind: ItemKind;
  id: string;
  name: string;
  /** Arquivos/pastas do item no disco (requisição: arquivo + pasta de exemplos). */
  paths: string[];
  /** Pai (pasta/coleção; para exemplos, a requisição). */
  parentId?: string | undefined;
  /** Posição entre os irmãos (para voltar ao mesmo lugar). */
  index?: number | undefined;
  /** Nomes dos ancestrais, da coleção até o pai. */
  breadcrumb: string[];
  /** Variáveis secretas cujos valores precisam ir junto. */
  secretKeys: string[];
}

/** Estrutura de uma coleção a ser gravada de uma vez (importação). */
export interface ImportedCollection {
  name: string;
  auth: Auth;
  variables: VariableInput[];
  scripts: Scripts;
  description?: string | undefined;
  children: ImportedChild[];
}

export type ImportedChild =
  | {
      kind: 'folder';
      name: string;
      auth: Auth;
      scripts: Scripts;
      description?: string | undefined;
      children: ImportedChild[];
    }
  | {
      kind: 'request';
      name: string;
      data: RequestData;
      examples: Omit<ExampleFile, 'schemaVersion' | 'id'>[];
    };

/** Destino para gravar uma variável (usado por scripts e pelo MCP). */
export type VariableTarget =
  | { kind: 'global' }
  | { kind: 'collection'; id: string }
  | { kind: 'environment'; id: string };

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

export interface OpenWorkspaceOptions {
  secrets: SecretStore;
  /** Nome usado ao criar o manifesto de um workspace novo. */
  defaultName?: string;
}

/**
 * Lê e grava um workspace no disco. Todas as alterações passam por aqui (app
 * e MCP), são serializadas por uma fila e recarregam o snapshot ao final.
 */
export class WorkspaceStore {
  private manifest!: WorkspaceManifest;
  private globals!: GlobalsFile;
  private entries = new Map<string, Entry>();
  private current!: WorkspaceSnapshot;
  private readonly mutex = new Mutex();

  private constructor(
    readonly root: string,
    readonly secrets: SecretStore,
    private readonly defaultName: string,
  ) {}

  static async open(root: string, options: OpenWorkspaceOptions): Promise<WorkspaceStore> {
    const store = new WorkspaceStore(root, options.secrets, options.defaultName ?? basename(root));
    await mkdir(root, { recursive: true });
    await store.mutex.run(() => store.load());
    return store;
  }

  get id(): string {
    return this.manifest.id;
  }

  snapshot(): WorkspaceSnapshot {
    return this.current;
  }

  /** Relê tudo do disco (ex.: após uma mudança externa detectada pelo watcher). */
  reload(): Promise<WorkspaceSnapshot> {
    return this.mutex.run(async () => {
      await this.load();
      return this.current;
    });
  }

  // -------------------------------------------------------------------------
  // Leitura

  /** Camadas de variáveis com valores secretos preenchidos (só para execução). */
  variableLayers(collectionId: string | undefined, environmentId: string | null | undefined): ScopeLayer[] {
    const layers: ScopeLayer[] = [
      { source: 'global', variables: withSecretValues(this.globals.variables, GLOBAL_SCOPE, this.secrets) },
    ];
    const collection = collectionId ? this.entries.get(collectionId) : undefined;
    if (collection?.kind === 'collection') {
      layers.push({
        source: 'collection',
        variables: withSecretValues(
          collection.file.variables,
          { kind: 'collection', id: collection.id },
          this.secrets,
        ),
      });
    }
    const env = environmentId ? this.entries.get(environmentId) : undefined;
    if (env?.kind === 'environment') {
      layers.push({
        source: 'environment',
        variables: withSecretValues(env.file.variables, { kind: 'environment', id: env.id }, this.secrets),
      });
    }
    return layers;
  }

  /**
   * Todos os valores secretos guardados para este workspace (inclusive os da
   * lixeira). Para mascarar qualquer saída que vá para fora, como o MCP.
   */
  allSecretValues(): string[] {
    return this.secrets.allValues();
  }

  /** Valor de uma variável secreta (botão "revelar" na UI). */
  revealSecret(target: VariableTarget, key: string): string | undefined {
    return this.secrets.get(secretScopeOf(target), key);
  }

  kindOf(id: string): ItemKind | undefined {
    return this.entries.get(id)?.kind;
  }

  /** Caminho no disco de um item (arquivo ou pasta). */
  pathOf(id: string): string | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    return 'dir' in entry ? entry.dir : entry.path;
  }

  // -------------------------------------------------------------------------
  // Coleções, pastas e requisições

  createCollection(
    name: string,
    init: { auth?: Auth; variables?: VariableInput[]; description?: string; id?: string } = {},
  ): Promise<string> {
    return this.mutate(async () => {
      const id = init.id ?? newId();
      const dirs = await listDirs(join(this.root, COLLECTIONS_DIR));
      const dir = join(this.root, COLLECTIONS_DIR, uniqueSlug(name, dirs));
      const scope: SecretScope = { kind: 'collection', id };
      const file = CollectionFileSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        id,
        name,
        auth: init.auth ?? { type: 'none' },
        variables: persistVariables(init.variables ?? [], [], scope, this.secrets),
        description: init.description,
        order: [],
      });
      await writeJsonAtomic(join(dir, COLLECTION_FILE), file);
      await this.writeManifest({ ...this.manifest, order: [...this.collectionOrder(), id] });
      return id;
    });
  }

  createFolder(
    parentId: string,
    name: string,
    init: { auth?: Auth; description?: string; index?: number } = {},
  ): Promise<string> {
    return this.mutate(async () => {
      const parent = this.container(parentId);
      const id = newId();
      const dir = join(parent.dir, uniqueSlug(name, await listDirs(parent.dir)));
      const file = FolderFileSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        id,
        name,
        auth: init.auth ?? { type: 'inherit' },
        description: init.description,
        order: [],
      });
      await writeJsonAtomic(join(dir, FOLDER_FILE), file);
      await this.insertInOrder(parent, id, init.index);
      return id;
    });
  }

  createRequest(
    parentId: string,
    name: string,
    data: RequestDataInput = {},
    options: { index?: number } = {},
  ): Promise<string> {
    return this.mutate(async () => {
      const parent = this.container(parentId);
      const id = newId();
      const path = await this.requestPath(parent.dir, name);
      const file = RequestFileSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        id,
        name,
        ...RequestDataSchema.parse(data),
      });
      await writeJsonAtomic(path, file);
      await this.insertInOrder(parent, id, options.index);
      return id;
    });
  }

  updateRequest(id: string, data: RequestData): Promise<void> {
    return this.mutate(async () => {
      const entry = this.entry(id, 'request');
      const file = RequestFileSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        id,
        name: entry.file.name,
        ...RequestDataSchema.parse(data),
      });
      await writeJsonAtomic(entry.path, file);
    });
  }

  updateCollection(
    id: string,
    patch: { auth?: Auth; description?: string; variables?: VariableInput[]; scripts?: Scripts },
  ): Promise<void> {
    return this.mutate(async () => {
      const entry = this.entry(id, 'collection');
      const variables = patch.variables
        ? persistVariables(patch.variables, entry.file.variables, { kind: 'collection', id }, this.secrets)
        : entry.file.variables;
      await writeJsonAtomic(
        join(entry.dir, COLLECTION_FILE),
        CollectionFileSchema.parse({
          ...entry.file,
          ...(patch.auth ? { auth: patch.auth } : {}),
          ...(patch.scripts ? { scripts: patch.scripts } : {}),
          ...(patch.description !== undefined ? { description: patch.description || undefined } : {}),
          variables,
        }),
      );
    });
  }

  updateFolder(id: string, patch: { auth?: Auth; description?: string; scripts?: Scripts }): Promise<void> {
    return this.mutate(async () => {
      const entry = this.entry(id, 'folder');
      await writeJsonAtomic(
        join(entry.dir, FOLDER_FILE),
        FolderFileSchema.parse({
          ...entry.file,
          ...(patch.auth ? { auth: patch.auth } : {}),
          ...(patch.scripts ? { scripts: patch.scripts } : {}),
          ...(patch.description !== undefined ? { description: patch.description || undefined } : {}),
        }),
      );
    });
  }

  /** Renomeia qualquer item; o arquivo/pasta acompanha o novo nome. */
  rename(id: string, name: string): Promise<void> {
    return this.mutate(async () => {
      const trimmed = name.trim();
      if (trimmed === '') throw new WorkspaceError('O nome não pode ficar vazio.');
      const entry = this.entries.get(id);
      if (!entry) throw notFound(id);

      switch (entry.kind) {
        case 'collection':
        case 'folder': {
          const metaFile = entry.kind === 'collection' ? COLLECTION_FILE : FOLDER_FILE;
          const parentDir = dirname(entry.dir);
          const siblings = (await listDirs(parentDir)).filter((d) => d !== basename(entry.dir));
          const target = join(parentDir, uniqueSlug(trimmed, siblings));
          if (target !== entry.dir) await renameRobust(entry.dir, target);
          await writeJsonAtomic(join(target, metaFile), { ...entry.file, name: trimmed });
          break;
        }
        case 'request': {
          const target = await this.requestPath(dirname(entry.path), trimmed, entry.path);
          if (target !== entry.path) {
            await renameRobust(entry.path, target);
            const oldExamples = examplesDirOf(entry.path);
            if (await exists(oldExamples)) await renameRobust(oldExamples, examplesDirOf(target));
          }
          await writeJsonAtomic(target, { ...entry.file, name: trimmed });
          break;
        }
        case 'environment': {
          const dir = dirname(entry.path);
          const target = await uniqueFilePath(dir, trimmed, ENVIRONMENT_EXT, entry.path);
          if (target !== entry.path) await renameRobust(entry.path, target);
          await writeJsonAtomic(target, { ...entry.file, name: trimmed });
          break;
        }
        case 'example': {
          const dir = dirname(entry.path);
          const target = await uniqueFilePath(dir, trimmed, EXAMPLE_EXT, entry.path);
          if (target !== entry.path) await renameRobust(entry.path, target);
          await writeJsonAtomic(target, { ...entry.file, name: trimmed });
          break;
        }
      }
    });
  }

  /**
   * Move uma pasta/requisição para outro container (ou reordena no mesmo).
   * `index` é a posição final entre os filhos do destino.
   */
  move(id: string, targetParentId: string, index?: number): Promise<void> {
    return this.mutate(async () => {
      const entry = this.entries.get(id);
      if (!entry || (entry.kind !== 'folder' && entry.kind !== 'request')) {
        throw new WorkspaceError('Só pastas e requisições podem ser movidas.');
      }
      const target = this.container(targetParentId);
      if (entry.kind === 'folder' && (target.id === id || this.isDescendant(target.id, id))) {
        throw new WorkspaceError('Não é possível mover uma pasta para dentro dela mesma.');
      }

      const source = this.container(entry.parentId);
      if (source.id !== target.id) {
        if (entry.kind === 'folder') {
          const dest = join(target.dir, uniqueSlug(entry.file.name, await listDirs(target.dir)));
          await renameRobust(entry.dir, dest);
        } else {
          const dest = await this.requestPath(target.dir, entry.file.name);
          await renameRobust(entry.path, dest);
          const oldExamples = examplesDirOf(entry.path);
          if (await exists(oldExamples)) await renameRobust(oldExamples, examplesDirOf(dest));
        }
        await this.writeOrder(
          source,
          this.childOrder(source).filter((c) => c !== id),
        );
      }
      // childOrder ainda vê o item no pai antigo; por isso inclui o id explicitamente.
      const order = this.childOrder(target).filter((c) => c !== id);
      order.splice(clampIndex(index, order.length), 0, id);
      await this.writeOrder(target, order);
    });
  }

  /** Duplica coleção, pasta, requisição ou ambiente (com novos ids). Retorna o id da cópia. */
  /**
   * Duplica um item logo abaixo do original. Os exemplos salvos das
   * requisições só são copiados com `includeExamples`.
   */
  duplicate(id: string, options: { includeExamples?: boolean } = {}): Promise<string> {
    const withExamples = options.includeExamples ?? false;
    return this.mutate(async () => {
      const entry = this.entries.get(id);
      if (!entry) throw notFound(id);
      const copyName = `${entry.file.name} (cópia)`;

      switch (entry.kind) {
        case 'request': {
          const parent = this.container(entry.parentId);
          const newIdValue = newId();
          const path = await this.requestPath(parent.dir, copyName);
          await writeJsonAtomic(path, { ...entry.file, id: newIdValue, name: copyName });
          if (withExamples) await this.copyExamples(entry.path, path);
          const order = this.childOrder(parent);
          order.splice(order.indexOf(id) + 1, 0, newIdValue);
          await this.writeOrder(parent, order);
          return newIdValue;
        }
        case 'folder': {
          const parent = this.container(entry.parentId);
          const dest = join(parent.dir, uniqueSlug(copyName, await listDirs(parent.dir)));
          const copiedId = await this.copyContainerTree(entry.dir, dest, copyName, withExamples);
          const order = this.childOrder(parent);
          order.splice(order.indexOf(id) + 1, 0, copiedId);
          await this.writeOrder(parent, order);
          return copiedId;
        }
        case 'collection': {
          const base = join(this.root, COLLECTIONS_DIR);
          const dest = join(base, uniqueSlug(copyName, await listDirs(base)));
          const copiedId = await this.copyContainerTree(entry.dir, dest, copyName, withExamples);
          // Copia também os valores secretos das variáveis da coleção.
          for (const v of entry.file.variables) {
            const value =
              v.type === 'secret' ? this.secrets.get({ kind: 'collection', id }, v.key) : undefined;
            if (value !== undefined) this.secrets.set({ kind: 'collection', id: copiedId }, v.key, value);
          }
          const order = this.collectionOrder();
          order.splice(order.indexOf(id) + 1, 0, copiedId);
          await this.writeManifest({ ...this.manifest, order });
          return copiedId;
        }
        case 'environment': {
          const copiedId = newId();
          const path = await uniqueFilePath(dirname(entry.path), copyName, ENVIRONMENT_EXT);
          await writeJsonAtomic(path, { ...entry.file, id: copiedId, name: copyName });
          for (const v of entry.file.variables) {
            const value =
              v.type === 'secret' ? this.secrets.get({ kind: 'environment', id }, v.key) : undefined;
            if (value !== undefined) this.secrets.set({ kind: 'environment', id: copiedId }, v.key, value);
          }
          return copiedId;
        }
        case 'example':
          throw new WorkspaceError('Exemplos não podem ser duplicados.');
      }
    });
  }

  /** Tudo o que a lixeira precisa saber para guardar e depois restaurar um item. */
  describeItem(id: string): ItemDescription | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    const breadcrumb = (parentId: string | undefined): string[] => {
      const names: string[] = [];
      let current = parentId ? this.entries.get(parentId) : undefined;
      while (current) {
        names.unshift(current.file.name);
        current =
          current.kind === 'folder' || current.kind === 'request'
            ? this.entries.get(current.parentId)
            : current.kind === 'example'
              ? this.entries.get(current.requestId)
              : undefined;
      }
      return names;
    };
    const secretKeys = (vars: readonly { key: string; type: string }[]) =>
      vars.filter((v) => v.type === 'secret').map((v) => v.key);

    switch (entry.kind) {
      case 'collection':
        return {
          kind: 'collection',
          id,
          name: entry.file.name,
          paths: [entry.dir],
          index: this.collectionOrder().indexOf(id),
          breadcrumb: [],
          secretKeys: secretKeys(entry.file.variables),
        };
      case 'folder':
      case 'request': {
        const parent = this.container(entry.parentId);
        const paths = entry.kind === 'folder' ? [entry.dir] : [entry.path, examplesDirOf(entry.path)];
        return {
          kind: entry.kind,
          id,
          name: entry.file.name,
          paths,
          parentId: entry.parentId,
          index: this.childOrder(parent).indexOf(id),
          breadcrumb: breadcrumb(entry.parentId),
          secretKeys: [],
        };
      }
      case 'environment':
        return {
          kind: 'environment',
          id,
          name: entry.file.name,
          paths: [entry.path],
          breadcrumb: [],
          secretKeys: secretKeys(entry.file.variables),
        };
      case 'example':
        return {
          kind: 'example',
          id,
          name: entry.file.name,
          paths: [entry.path],
          parentId: entry.requestId,
          breadcrumb: breadcrumb(entry.requestId),
          secretKeys: [],
        };
    }
  }

  /**
   * Devolve ao workspace um item guardado pela lixeira. `sources` são as cópias
   * (na mesma ordem de `describeItem().paths`; caminhos inexistentes são ignorados).
   */
  restoreItem(
    item: Omit<ItemDescription, 'paths' | 'breadcrumb' | 'secretKeys'>,
    sources: string[],
  ): Promise<void> {
    return this.mutate(async () => {
      const [main, extra] = sources;
      if (!main || !(await exists(main)))
        throw new WorkspaceError('Os arquivos deste item não estão mais na lixeira.');

      switch (item.kind) {
        case 'collection': {
          const base = join(this.root, COLLECTIONS_DIR);
          const dest = join(base, uniqueSlug(item.name, await listDirs(base)));
          await cp(main, dest, { recursive: true });
          const order = this.collectionOrder().filter((c) => c !== item.id);
          order.splice(clampIndex(item.index, order.length), 0, item.id);
          await this.writeManifest({ ...this.manifest, order });
          break;
        }
        case 'folder':
        case 'request': {
          const parent = item.parentId ? this.entries.get(item.parentId) : undefined;
          if (!parent || (parent.kind !== 'collection' && parent.kind !== 'folder')) {
            throw new WorkspaceError(
              'A pasta ou coleção de origem não existe mais. Restaure-a primeiro (ela também pode estar na lixeira).',
            );
          }
          if (item.kind === 'folder') {
            await cp(main, join(parent.dir, uniqueSlug(item.name, await listDirs(parent.dir))), {
              recursive: true,
            });
          } else {
            const dest = await this.requestPath(parent.dir, item.name);
            await cp(main, dest);
            if (extra && (await exists(extra))) await cp(extra, examplesDirOf(dest), { recursive: true });
          }
          await this.insertInOrder(parent, item.id, item.index);
          break;
        }
        case 'environment': {
          const dir = join(this.root, ENVIRONMENTS_DIR);
          await mkdir(dir, { recursive: true });
          await cp(main, await uniqueFilePath(dir, item.name, ENVIRONMENT_EXT));
          break;
        }
        case 'example': {
          const request = item.parentId ? this.entries.get(item.parentId) : undefined;
          if (request?.kind !== 'request') {
            throw new WorkspaceError('A requisição deste exemplo não existe mais. Restaure-a primeiro.');
          }
          const dir = examplesDirOf(request.path);
          await mkdir(dir, { recursive: true });
          await cp(main, await uniqueFilePath(dir, item.name, EXAMPLE_EXT));
          break;
        }
      }
    });
  }

  /** Exclui um item permanentemente (a lixeira envolve esta operação). */
  remove(id: string): Promise<void> {
    return this.mutate(async () => {
      const entry = this.entries.get(id);
      if (!entry) throw notFound(id);
      switch (entry.kind) {
        case 'collection':
          await rm(entry.dir, { recursive: true, force: true });
          this.secrets.deleteScope({ kind: 'collection', id });
          await this.writeManifest({
            ...this.manifest,
            order: this.collectionOrder().filter((c) => c !== id),
          });
          break;
        case 'folder':
        case 'request': {
          if (entry.kind === 'folder') await rm(entry.dir, { recursive: true, force: true });
          else {
            await rm(entry.path, { force: true });
            await rm(examplesDirOf(entry.path), { recursive: true, force: true });
          }
          const parent = this.container(entry.parentId);
          await this.writeOrder(
            parent,
            this.childOrder(parent).filter((c) => c !== id),
          );
          break;
        }
        case 'environment':
          await rm(entry.path, { force: true });
          this.secrets.deleteScope({ kind: 'environment', id });
          break;
        case 'example':
          await rm(entry.path, { force: true });
          break;
      }
    });
  }

  /** Reordena as coleções na sidebar. */
  reorderCollections(order: string[]): Promise<void> {
    return this.mutate(() => this.writeManifest({ ...this.manifest, order }));
  }

  /**
   * Grava uma coleção inteira (ex.: importada do Postman) numa única operação,
   * com um só recarregamento no final. Retorna o id da coleção criada.
   */
  importCollection(tree: ImportedCollection): Promise<string> {
    return this.mutate(async () => {
      const collectionsDir = join(this.root, COLLECTIONS_DIR);
      const id = newId();
      const dir = join(collectionsDir, uniqueSlug(tree.name, await listDirs(collectionsDir)));
      const scope: SecretScope = { kind: 'collection', id };

      const writeChildren = async (parentDir: string, children: ImportedChild[]): Promise<string[]> => {
        const order: string[] = [];
        const usedDirs: string[] = [];
        const usedFiles: string[] = [];
        for (const child of children) {
          const childId = newId();
          order.push(childId);
          if (child.kind === 'folder') {
            const slug = uniqueSlug(child.name, usedDirs);
            usedDirs.push(slug);
            const folderDir = join(parentDir, slug);
            const childOrder = await writeChildren(folderDir, child.children);
            await writeJsonAtomic(
              join(folderDir, FOLDER_FILE),
              FolderFileSchema.parse({
                schemaVersion: SCHEMA_VERSION,
                id: childId,
                name: child.name,
                auth: child.auth,
                scripts: child.scripts,
                description: child.description,
                order: childOrder,
              }),
            );
          } else {
            const slug = uniqueSlug(child.name, usedFiles);
            usedFiles.push(slug);
            const path = join(parentDir, `${slug}${REQUEST_EXT}`);
            await writeJsonAtomic(
              path,
              RequestFileSchema.parse({
                schemaVersion: SCHEMA_VERSION,
                id: childId,
                name: child.name,
                ...child.data,
              }),
            );
            const usedExamples: string[] = [];
            for (const example of child.examples) {
              const exSlug = uniqueSlug(example.name, usedExamples);
              usedExamples.push(exSlug);
              await writeJsonAtomic(
                join(examplesDirOf(path), `${exSlug}${EXAMPLE_EXT}`),
                ExampleFileSchema.parse({ schemaVersion: SCHEMA_VERSION, id: newId(), ...example }),
              );
            }
          }
        }
        return order;
      };

      const order = await writeChildren(dir, tree.children);
      await writeJsonAtomic(
        join(dir, COLLECTION_FILE),
        CollectionFileSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          id,
          name: tree.name,
          auth: tree.auth,
          variables: persistVariables(tree.variables, [], scope, this.secrets),
          scripts: tree.scripts,
          description: tree.description,
          order,
        }),
      );
      await this.writeManifest({ ...this.manifest, order: [...this.collectionOrder(), id] });
      return id;
    });
  }

  /** Mescla variáveis nas globais (substitui as de mesmo nome). */
  mergeGlobals(variables: VariableInput[]): Promise<void> {
    return this.mutate(async () => {
      const keys = new Set(variables.map((v) => v.key));
      const kept = this.globals.variables.filter((v) => !keys.has(v.key));
      const merged = persistVariables(variables, [], GLOBAL_SCOPE, this.secrets);
      await writeJsonAtomic(join(this.root, GLOBALS_FILE), {
        schemaVersion: SCHEMA_VERSION,
        variables: [...kept, ...merged],
      });
    });
  }

  // -------------------------------------------------------------------------
  // Ambientes e variáveis

  createEnvironment(name: string, variables: VariableInput[] = [], id = newId()): Promise<string> {
    return this.mutate(async () => {
      const dir = join(this.root, ENVIRONMENTS_DIR);
      const path = await uniqueFilePath(dir, name, ENVIRONMENT_EXT);
      const file = EnvironmentFileSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        id,
        name,
        variables: persistVariables(variables, [], { kind: 'environment', id }, this.secrets),
      });
      await writeJsonAtomic(path, file);
      return id;
    });
  }

  updateEnvironment(id: string, variables: VariableInput[]): Promise<void> {
    return this.mutate(async () => {
      const entry = this.entry(id, 'environment');
      await writeJsonAtomic(entry.path, {
        ...entry.file,
        variables: persistVariables(
          variables,
          entry.file.variables,
          { kind: 'environment', id },
          this.secrets,
        ),
      });
    });
  }

  updateGlobals(variables: VariableInput[]): Promise<void> {
    return this.mutate(async () => {
      await writeJsonAtomic(join(this.root, GLOBALS_FILE), {
        schemaVersion: SCHEMA_VERSION,
        variables: persistVariables(variables, this.globals.variables, GLOBAL_SCOPE, this.secrets),
      });
    });
  }

  /**
   * Define o valor de uma variável (cria se não existir). Usado por scripts
   * (`pm.environment.set`) e pelo MCP. Se a variável é secreta, o valor vai
   * para o cofre local.
   */
  setVariable(target: VariableTarget, key: string, value: string): Promise<void> {
    return this.mutate(() =>
      this.writeVariables(target, (vars) => upsertVariable(vars, key, value, target, this.secrets)),
    );
  }

  unsetVariable(target: VariableTarget, key: string): Promise<void> {
    return this.mutate(() =>
      this.writeVariables(target, (vars) => {
        const existing = vars.find((v) => v.key === key);
        if (existing?.type === 'secret') this.secrets.delete(secretScopeOf(target), key);
        return vars.filter((v) => v.key !== key);
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Exemplos

  saveExample(requestId: string, example: Omit<ExampleFile, 'schemaVersion' | 'id'>): Promise<string> {
    return this.mutate(async () => {
      const request = this.entry(requestId, 'request');
      const id = newId();
      const dir = examplesDirOf(request.path);
      const path = await uniqueFilePath(dir, example.name, EXAMPLE_EXT);
      await writeJsonAtomic(path, ExampleFileSchema.parse({ schemaVersion: SCHEMA_VERSION, id, ...example }));
      return id;
    });
  }

  // -------------------------------------------------------------------------
  // Internos: mutação e carga

  private mutate<T>(task: () => Promise<T>): Promise<T> {
    return this.mutex.run(async () => {
      try {
        return await task();
      } finally {
        await this.load();
      }
    });
  }

  private async load(): Promise<void> {
    const problems: LoadProblem[] = [];
    const entries = new Map<string, Entry>();
    const seen = new Set<string>();

    // Manifesto: cria na primeira abertura.
    const manifestPath = join(this.root, MANIFEST_FILE);
    const rawManifest = await readJsonIfExists(manifestPath).catch((error: unknown) => {
      problems.push({ path: manifestPath, message: describeError(error) });
      return undefined;
    });
    const parsedManifest = WorkspaceManifestSchema.safeParse(rawManifest);
    if (parsedManifest.success) {
      this.manifest = parsedManifest.data;
    } else {
      if (rawManifest !== undefined)
        problems.push({ path: manifestPath, message: z.prettifyError(parsedManifest.error) });
      this.manifest ??= { schemaVersion: SCHEMA_VERSION, id: newId(), name: this.defaultName, order: [] };
      if (rawManifest === undefined) await writeJsonAtomic(manifestPath, this.manifest);
    }

    // Globais.
    const globalsPath = join(this.root, GLOBALS_FILE);
    this.globals = (await this.readFile(globalsPath, GlobalsFileSchema, problems, true)) ?? {
      schemaVersion: SCHEMA_VERSION,
      variables: [],
    };

    // Ambientes.
    const environments: EnvironmentView[] = [];
    const envDir = join(this.root, ENVIRONMENTS_DIR);
    for (const name of await listFiles(envDir, ENVIRONMENT_EXT)) {
      const path = join(envDir, name);
      const file = await this.readFile(path, EnvironmentFileSchema, problems);
      if (!file) continue;
      const id = await this.ensureUniqueId(file, path, seen);
      entries.set(id, { kind: 'environment', id, path, file: { ...file, id } });
      environments.push({
        id,
        name: file.name,
        variables: viewVariables(file.variables, { kind: 'environment', id }, this.secrets),
      });
    }
    environments.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    // Coleções.
    const collections: CollectionNode[] = [];
    const colDir = join(this.root, COLLECTIONS_DIR);
    for (const dirName of await listDirs(colDir)) {
      const dir = join(colDir, dirName);
      const metaPath = join(dir, COLLECTION_FILE);
      if (!(await exists(metaPath))) {
        problems.push({ path: dir, message: `Pasta ignorada: falta o arquivo ${COLLECTION_FILE}.` });
        continue;
      }
      const file = await this.readFile(metaPath, CollectionFileSchema, problems);
      if (!file) continue;
      const id = await this.ensureUniqueId(file, metaPath, seen);
      entries.set(id, { kind: 'collection', id, dir, file: { ...file, id } });
      collections.push({
        kind: 'collection',
        id,
        name: file.name,
        auth: file.auth,
        variables: viewVariables(file.variables, { kind: 'collection', id }, this.secrets),
        scripts: file.scripts,
        description: file.description,
        children: await this.loadChildren(dir, id, file.order, entries, seen, problems),
      });
    }

    this.entries = entries;
    this.current = {
      root: this.root,
      id: this.manifest.id,
      name: this.manifest.name,
      globals: viewVariables(this.globals.variables, GLOBAL_SCOPE, this.secrets),
      environments,
      collections: sortByOrder(collections, this.manifest.order),
      problems,
    };
  }

  private async loadChildren(
    dir: string,
    parentId: string,
    order: readonly string[],
    entries: Map<string, Entry>,
    seen: Set<string>,
    problems: LoadProblem[],
  ): Promise<ChildNode[]> {
    const children: ChildNode[] = [];
    let dirents: import('node:fs').Dirent[];
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      problems.push({ path: dir, message: describeError(error) });
      return children;
    }

    for (const d of dirents) {
      const path = join(dir, d.name);
      if (d.isDirectory()) {
        if (d.name.endsWith(EXAMPLES_SUFFIX)) continue;
        const metaPath = join(path, FOLDER_FILE);
        if (!(await exists(metaPath))) continue;
        const file = await this.readFile(metaPath, FolderFileSchema, problems);
        if (!file) continue;
        const id = await this.ensureUniqueId(file, metaPath, seen);
        entries.set(id, { kind: 'folder', id, dir: path, parentId, file: { ...file, id } });
        const node: FolderNode = {
          kind: 'folder',
          id,
          name: file.name,
          parentId,
          auth: file.auth,
          scripts: file.scripts,
          description: file.description,
          children: await this.loadChildren(path, id, file.order, entries, seen, problems),
        };
        children.push(node);
      } else if (d.isFile() && d.name.endsWith(REQUEST_EXT)) {
        const file = await this.readFile(path, RequestFileSchema, problems);
        if (!file) continue;
        const id = await this.ensureUniqueId(file, path, seen);
        entries.set(id, { kind: 'request', id, path, parentId, file: { ...file, id } });
        const { schemaVersion: _v, id: _id, name, ...data } = file;
        const node: RequestNode = {
          kind: 'request',
          id,
          name,
          parentId,
          data,
          examples: await this.loadExamples(path, id, entries, seen, problems),
        };
        children.push(node);
      }
    }
    return sortByOrder(children, order);
  }

  private async loadExamples(
    requestPath: string,
    requestId: string,
    entries: Map<string, Entry>,
    seen: Set<string>,
    problems: LoadProblem[],
  ): Promise<ExampleFile[]> {
    const dir = examplesDirOf(requestPath);
    const examples: ExampleFile[] = [];
    for (const name of await listFiles(dir, EXAMPLE_EXT)) {
      const path = join(dir, name);
      const file = await this.readFile(path, ExampleFileSchema, problems);
      if (!file) continue;
      const id = await this.ensureUniqueId(file, path, seen);
      entries.set(id, { kind: 'example', id, path, requestId, file: { ...file, id } });
      examples.push({ ...file, id });
    }
    return examples.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  private async readFile<T>(
    path: string,
    schema: z.ZodType<T>,
    problems: LoadProblem[],
    optional = false,
  ): Promise<T | undefined> {
    let raw: unknown;
    try {
      raw = await readJson(path);
    } catch (error) {
      if (optional && isNotFound(error)) return undefined;
      problems.push({ path, message: describeError(error) });
      return undefined;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      problems.push({ path, message: z.prettifyError(parsed.error) });
      return undefined;
    }
    return parsed.data;
  }

  /**
   * Ids repetidos acontecem quando alguém copia um arquivo manualmente. A
   * cópia recebe um id novo, gravado no arquivo.
   */
  private async ensureUniqueId(file: { id: string }, path: string, seen: Set<string>): Promise<string> {
    let id = file.id;
    if (seen.has(id)) {
      id = newId();
      await writeJsonAtomic(path, { ...file, id });
    }
    seen.add(id);
    return id;
  }

  // -------------------------------------------------------------------------
  // Internos: helpers de escrita

  private entry<K extends ItemKind>(id: string, kind: K): Extract<Entry, { kind: K }> {
    const entry = this.entries.get(id);
    if (!entry || entry.kind !== kind) throw notFound(id);
    return entry as Extract<Entry, { kind: K }>;
  }

  private container(id: string): ContainerEntry {
    const entry = this.entries.get(id);
    if (!entry || (entry.kind !== 'collection' && entry.kind !== 'folder')) {
      throw new WorkspaceError('Destino não encontrado: escolha uma coleção ou pasta.');
    }
    return entry;
  }

  private isDescendant(candidateId: string, ancestorId: string): boolean {
    let current = this.entries.get(candidateId);
    while (current && (current.kind === 'folder' || current.kind === 'request')) {
      if (current.parentId === ancestorId) return true;
      current = this.entries.get(current.parentId);
    }
    return false;
  }

  /** Ordem efetiva dos filhos (a do snapshot, que já inclui itens fora do `order`). */
  private childOrder(container: ContainerEntry): string[] {
    const ids: string[] = [];
    for (const entry of this.entries.values()) {
      if ((entry.kind === 'folder' || entry.kind === 'request') && entry.parentId === container.id)
        ids.push(entry.id);
    }
    const order = container.file.order.filter((id) => ids.includes(id));
    return [...order, ...ids.filter((id) => !order.includes(id))];
  }

  private collectionOrder(): string[] {
    return this.current.collections.map((c) => c.id);
  }

  private async insertInOrder(container: ContainerEntry, id: string, index?: number): Promise<void> {
    const order = this.childOrder(container);
    order.splice(clampIndex(index, order.length), 0, id);
    await this.writeOrder(container, order);
  }

  private async writeOrder(container: ContainerEntry, order: string[]): Promise<void> {
    const metaFile = container.kind === 'collection' ? COLLECTION_FILE : FOLDER_FILE;
    await writeJsonAtomic(join(container.dir, metaFile), { ...container.file, order });
    container.file.order = order;
  }

  private async writeManifest(manifest: WorkspaceManifest): Promise<void> {
    this.manifest = manifest;
    await writeJsonAtomic(join(this.root, MANIFEST_FILE), manifest);
  }

  private async requestPath(dir: string, name: string, currentPath?: string): Promise<string> {
    return uniqueFilePath(dir, name, REQUEST_EXT, currentPath);
  }

  private async writeVariables(
    target: VariableTarget,
    change: (vars: Variable[]) => Variable[],
  ): Promise<void> {
    if (target.kind === 'global') {
      await writeJsonAtomic(join(this.root, GLOBALS_FILE), {
        schemaVersion: SCHEMA_VERSION,
        variables: change(this.globals.variables),
      });
    } else if (target.kind === 'environment') {
      const entry = this.entry(target.id, 'environment');
      await writeJsonAtomic(entry.path, { ...entry.file, variables: change(entry.file.variables) });
    } else {
      const entry = this.entry(target.id, 'collection');
      await writeJsonAtomic(join(entry.dir, COLLECTION_FILE), {
        ...entry.file,
        variables: change(entry.file.variables),
      });
    }
  }

  private async copyExamples(fromRequestPath: string, toRequestPath: string): Promise<void> {
    const from = examplesDirOf(fromRequestPath);
    if (!(await exists(from))) return;
    const to = examplesDirOf(toRequestPath);
    for (const name of await listFiles(from, EXAMPLE_EXT)) {
      const file = ExampleFileSchema.parse(await readJson(join(from, name)));
      await writeJsonAtomic(join(to, name), { ...file, id: newId() });
    }
  }

  /** Copia uma pasta/coleção inteira trocando todos os ids. Retorna o id da raiz. */
  private async copyContainerTree(
    fromDir: string,
    toDir: string,
    rootName: string,
    withExamples: boolean,
  ): Promise<string> {
    await cp(fromDir, toDir, {
      recursive: true,
      filter: (src) => !src.endsWith(TEMP_SUFFIX) && (withExamples || !src.endsWith(EXAMPLES_SUFFIX)),
    });
    const idMap = new Map<string, string>();
    const files: string[] = [];
    await collectJsonFiles(toDir, files);

    // 1ª passada: gera ids novos.
    for (const path of files) {
      const data = (await readJson(path)) as { id?: string };
      if (typeof data.id === 'string') idMap.set(data.id, newId());
    }
    // 2ª passada: grava com ids e ordens remapeados.
    let rootId = '';
    for (const path of files) {
      const data = (await readJson(path)) as { id?: string; order?: string[]; name?: string };
      if (typeof data.id !== 'string') continue;
      const id = idMap.get(data.id) ?? newId();
      const isRoot =
        dirname(path) === toDir && (path.endsWith(COLLECTION_FILE) || path.endsWith(FOLDER_FILE));
      if (isRoot) rootId = id;
      await writeJsonAtomic(path, {
        ...data,
        id,
        ...(isRoot ? { name: rootName } : {}),
        ...(data.order ? { order: data.order.map((o) => idMap.get(o) ?? o) } : {}),
      });
    }
    return rootId;
  }
}

// ---------------------------------------------------------------------------
// Funções auxiliares

function secretScopeOf(target: VariableTarget): SecretScope {
  return target.kind === 'global' ? GLOBAL_SCOPE : { kind: target.kind, id: target.id };
}

function upsertVariable(
  vars: Variable[],
  key: string,
  value: string,
  target: VariableTarget,
  secrets: SecretStore,
): Variable[] {
  const existing = vars.find((v) => v.key === key);
  if (existing?.type === 'secret') {
    secrets.set(secretScopeOf(target), key, value);
    return vars;
  }
  if (existing) return vars.map((v) => (v.key === key ? { ...v, value } : v));
  return [...vars, { key, value, type: 'default', enabled: true }];
}

function examplesDirOf(requestPath: string): string {
  return join(dirname(requestPath), `${stem(basename(requestPath), REQUEST_EXT)}${EXAMPLES_SUFFIX}`);
}

function sortByOrder<T extends { id: string; name: string }>(items: T[], order: readonly string[]): T[] {
  const position = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const pa = position.get(a.id);
    const pb = position.get(b.id);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined || index < 0 || index > length) return length;
  return index;
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

async function listFiles(dir: string, ext: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isFile() && d.name.endsWith(ext) && !d.name.endsWith(TEMP_SUFFIX))
      .map((d) => d.name);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

async function collectJsonFiles(dir: string, out: string[]): Promise<void> {
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, d.name);
    if (d.isDirectory()) await collectJsonFiles(path, out);
    else if (d.name.endsWith('.json')) out.push(path);
  }
}

/** Caminho "<dir>/<slug><ext>" que não colide com outros arquivos (exceto `currentPath`). */
async function uniqueFilePath(dir: string, name: string, ext: string, currentPath?: string): Promise<string> {
  const taken = (await listFiles(dir, ext))
    .filter((f) => !currentPath || join(dir, f) !== currentPath)
    .map((f) => stem(f, ext));
  return join(dir, `${uniqueSlug(name, taken)}${ext}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/**
 * Renomeia lidando com a diferença só de maiúsculas no Windows ("a" -> "A")
 * e com bloqueios temporários (antivírus, indexador) com algumas tentativas.
 */
async function renameRobust(from: string, to: string): Promise<void> {
  if (from === to) return;
  await mkdir(dirname(to), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt < 4 && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

function notFound(id: string): WorkspaceError {
  return new WorkspaceError(`Item não encontrado: ${id}`);
}

function describeError(error: unknown): string {
  if (error instanceof SyntaxError) return `JSON inválido: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/** Caminho relativo ao workspace, com "/" (para mensagens e relatórios). */
export function relativeToWorkspace(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}
