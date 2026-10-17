import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { SecretScope } from '../secrets/secret-store';
import type { ItemDescription, ItemKind, WorkspaceStore } from '../storage/workspace-store';
import { WorkspaceError } from '../storage/workspace-store';
import { isNotFound, readJson, writeJsonAtomic } from '../util/fs';
import { newId } from '../util/ids';
import { Mutex } from '../util/mutex';

const TrashEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(['collection', 'folder', 'request', 'environment', 'example']),
  itemId: z.string(),
  name: z.string(),
  deletedAt: z.string(),
  parentId: z.string().optional(),
  index: z.number().optional(),
  breadcrumb: z.array(z.string()).default([]),
  secretKeys: z.array(z.string()).default([]),
  /** Quantas cópias de arquivos/pastas foram guardadas (files/0, files/1...). */
  fileCount: z.number().int(),
});
export type TrashEntry = z.infer<typeof TrashEntrySchema>;

const SECRET_KIND: Partial<Record<ItemKind, SecretScope['kind']>> = {
  collection: 'collection',
  environment: 'environment',
};

/**
 * Lixeira do workspace. Itens excluídos são copiados para a pasta local
 * (em %APPDATA%, fora do Git) junto com os valores secretos, e podem ser
 * restaurados no mesmo lugar.
 */
export class Trash {
  private readonly mutex = new Mutex();

  constructor(
    private readonly dir: string,
    private readonly store: WorkspaceStore,
  ) {}

  /** Move um item (e tudo dentro dele) para a lixeira. */
  moveToTrash(itemId: string): Promise<TrashEntry> {
    return this.mutex.run(async () => {
      const item = this.store.describeItem(itemId);
      if (!item) throw new WorkspaceError('Item não encontrado.');
      const entry: TrashEntry = {
        id: newId(),
        kind: item.kind,
        itemId: item.id,
        name: item.name,
        deletedAt: new Date().toISOString(),
        ...(item.parentId ? { parentId: item.parentId } : {}),
        ...(item.index !== undefined && item.index >= 0 ? { index: item.index } : {}),
        breadcrumb: item.breadcrumb,
        secretKeys: item.secretKeys,
        fileCount: item.paths.length,
      };
      const entryDir = join(this.dir, entry.id);
      await this.copyFiles(item, entryDir);
      this.moveSecrets(
        item.kind,
        { kind: SECRET_KIND[item.kind] ?? 'trash', id: item.id },
        trashScope(entry),
        item.secretKeys,
      );
      await writeJsonAtomic(join(entryDir, 'entry.json'), entry);
      try {
        await this.store.remove(itemId);
      } catch (error) {
        // Não conseguiu excluir: desfaz a cópia para não duplicar.
        this.moveSecrets(
          item.kind,
          trashScope(entry),
          { kind: SECRET_KIND[item.kind] ?? 'trash', id: item.id },
          item.secretKeys,
        );
        await rm(entryDir, { recursive: true, force: true });
        throw error;
      }
      return entry;
    });
  }

  /** Itens na lixeira, os mais recentes primeiro. */
  async list(): Promise<TrashEntry[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const entries: TrashEntry[] = [];
    for (const name of names) {
      try {
        entries.push(TrashEntrySchema.parse(await readJson(join(this.dir, name, 'entry.json'))));
      } catch {
        // Entrada incompleta (ex.: exclusão interrompida): ignorada.
      }
    }
    return entries.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  /** Devolve o item ao workspace, no lugar de origem. */
  restore(entryId: string): Promise<TrashEntry> {
    return this.mutex.run(async () => {
      const entry = await this.read(entryId);
      const entryDir = join(this.dir, entry.id);
      const sources = Array.from({ length: entry.fileCount }, (_, i) => join(entryDir, 'files', String(i)));
      await this.store.restoreItem(
        {
          kind: entry.kind,
          id: entry.itemId,
          name: entry.name,
          ...(entry.parentId ? { parentId: entry.parentId } : {}),
          ...(entry.index !== undefined ? { index: entry.index } : {}),
        },
        sources,
      );
      this.moveSecrets(
        entry.kind,
        trashScope(entry),
        { kind: SECRET_KIND[entry.kind] ?? 'trash', id: entry.itemId },
        entry.secretKeys,
      );
      await rm(entryDir, { recursive: true, force: true });
      await this.store.reload();
      return entry;
    });
  }

  /** Exclui definitivamente um item da lixeira. */
  remove(entryId: string): Promise<void> {
    return this.mutex.run(async () => {
      const entry = await this.read(entryId);
      this.store.secrets.deleteScope(trashScope(entry));
      await rm(join(this.dir, entry.id), { recursive: true, force: true });
    });
  }

  /** Esvazia a lixeira. Retorna quantos itens foram apagados. */
  async empty(): Promise<number> {
    const entries = await this.list();
    for (const entry of entries) await this.remove(entry.id);
    return entries.length;
  }

  private async read(entryId: string): Promise<TrashEntry> {
    try {
      return TrashEntrySchema.parse(await readJson(join(this.dir, entryId, 'entry.json')));
    } catch {
      throw new WorkspaceError('Este item não está mais na lixeira.');
    }
  }

  private async copyFiles(item: ItemDescription, entryDir: string): Promise<void> {
    await mkdir(join(entryDir, 'files'), { recursive: true });
    for (const [i, path] of item.paths.entries()) {
      const exists = await stat(path).then(
        () => true,
        () => false,
      );
      if (exists) await cp(path, join(entryDir, 'files', String(i)), { recursive: true });
    }
  }

  private moveSecrets(kind: ItemKind, from: SecretScope, to: SecretScope, keys: readonly string[]): void {
    if (!SECRET_KIND[kind]) return;
    const secrets = this.store.secrets;
    for (const key of keys) {
      const value = secrets.get(from, key);
      if (value === undefined) continue;
      secrets.set(to, key, value);
      secrets.delete(from, key);
    }
  }
}

function trashScope(entry: Pick<TrashEntry, 'id'>): SecretScope {
  return { kind: 'trash', id: entry.id };
}
