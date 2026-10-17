import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isNotFound, stringifyJson, TEMP_SUFFIX } from '../util/fs';

/** Onde uma variável secreta está definida. Para globais, `id` é "globals". */
export interface SecretScope {
  /** 'trash': segredos de itens na lixeira (para restaurar). */
  kind: 'global' | 'collection' | 'environment' | 'trash';
  id: string;
}

export const GLOBAL_SCOPE: SecretScope = { kind: 'global', id: 'globals' };

export interface SecretStore {
  get(scope: SecretScope, key: string): string | undefined;
  has(scope: SecretScope, key: string): boolean;
  set(scope: SecretScope, key: string, value: string): void;
  delete(scope: SecretScope, key: string): void;
  rename(scope: SecretScope, oldKey: string, newKey: string): void;
  /** Remove todos os segredos de um escopo (ex.: ambiente excluído). */
  deleteScope(scope: SecretScope): void;
  /** Todos os valores secretos conhecidos (para mascarar respostas e histórico). */
  allValues(): string[];
}

function entryId(scope: SecretScope, key: string): string {
  return `${scope.kind}/${scope.id}/${key}`;
}

/** Guarda segredos em memória. Usado em testes. */
export class MemorySecretStore implements SecretStore {
  private readonly map = new Map<string, string>();

  get(scope: SecretScope, key: string) {
    return this.map.get(entryId(scope, key));
  }
  has(scope: SecretScope, key: string) {
    return this.map.has(entryId(scope, key));
  }
  set(scope: SecretScope, key: string, value: string) {
    this.map.set(entryId(scope, key), value);
  }
  delete(scope: SecretScope, key: string) {
    this.map.delete(entryId(scope, key));
  }
  rename(scope: SecretScope, oldKey: string, newKey: string) {
    const value = this.get(scope, oldKey);
    if (value === undefined) return;
    this.delete(scope, oldKey);
    this.set(scope, newKey, value);
  }
  deleteScope(scope: SecretScope) {
    const prefix = `${scope.kind}/${scope.id}/`;
    for (const id of [...this.map.keys()]) if (id.startsWith(prefix)) this.map.delete(id);
  }
  allValues() {
    return [...this.map.values()];
  }
}

interface EncryptedEntry {
  iv: string;
  tag: string;
  data: string;
}

interface SecretsFile {
  version: 1;
  entries: Record<string, EncryptedEntry>;
}

/**
 * Segredos cifrados (AES-256-GCM) num arquivo local, fora do workspace.
 *
 * A chave de 256 bits vem de `getKey` — no app e no MCP ela fica no Windows
 * Credential Manager (ver keyring.ts). Guardamos só a chave no Credential
 * Manager porque ele limita cada valor a ~1280 caracteres, menos que muitos JWTs.
 *
 * App e MCP podem escrever no mesmo arquivo; por isso cada operação relê o
 * arquivo se ele mudou desde a última leitura.
 */
export class EncryptedFileSecretStore implements SecretStore {
  private cache = new Map<string, string>();
  private loadedMtimeMs = -1;
  private key: Buffer | undefined;

  constructor(
    private readonly filePath: string,
    private readonly getKey: () => Buffer,
  ) {}

  get(scope: SecretScope, key: string) {
    this.refresh();
    return this.cache.get(entryId(scope, key));
  }

  has(scope: SecretScope, key: string) {
    this.refresh();
    return this.cache.has(entryId(scope, key));
  }

  set(scope: SecretScope, key: string, value: string) {
    this.mutate((map) => map.set(entryId(scope, key), value));
  }

  delete(scope: SecretScope, key: string) {
    this.mutate((map) => map.delete(entryId(scope, key)));
  }

  rename(scope: SecretScope, oldKey: string, newKey: string) {
    this.mutate((map) => {
      const value = map.get(entryId(scope, oldKey));
      if (value === undefined) return;
      map.delete(entryId(scope, oldKey));
      map.set(entryId(scope, newKey), value);
    });
  }

  deleteScope(scope: SecretScope) {
    const prefix = `${scope.kind}/${scope.id}/`;
    this.mutate((map) => {
      for (const id of [...map.keys()]) if (id.startsWith(prefix)) map.delete(id);
    });
  }

  allValues() {
    this.refresh();
    return [...this.cache.values()];
  }

  private masterKey(): Buffer {
    this.key ??= this.getKey();
    if (this.key.length !== 32) throw new Error('A chave de segredos deve ter 32 bytes');
    return this.key;
  }

  private refresh(): void {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(this.filePath).mtimeMs;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      this.cache = new Map();
      this.loadedMtimeMs = -1;
      return;
    }
    if (mtimeMs === this.loadedMtimeMs) return;

    const file = JSON.parse(readFileSync(this.filePath, 'utf8')) as SecretsFile;
    const map = new Map<string, string>();
    for (const [id, entry] of Object.entries(file.entries ?? {})) {
      try {
        map.set(id, this.decrypt(entry));
      } catch {
        // Entrada corrompida ou cifrada com outra chave: ignorada (valor perdido).
      }
    }
    this.cache = map;
    this.loadedMtimeMs = mtimeMs;
  }

  private mutate(change: (map: Map<string, string>) => void): void {
    this.refresh();
    const next = new Map(this.cache);
    change(next);

    const file: SecretsFile = { version: 1, entries: {} };
    for (const [id, value] of [...next.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      file.entries[id] = this.encrypt(value);
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${randomBytes(4).toString('hex')}${TEMP_SUFFIX}`;
    writeFileSync(tmp, stringifyJson(file));
    renameSync(tmp, this.filePath);

    this.cache = next;
    this.loadedMtimeMs = statSync(this.filePath).mtimeMs;
  }

  private encrypt(value: string): EncryptedEntry {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey(), iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
  }

  private decrypt(entry: EncryptedEntry): string {
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey(), Buffer.from(entry.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(entry.data, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  }
}
