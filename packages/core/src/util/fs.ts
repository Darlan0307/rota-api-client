import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** JSON com indentação de 2 espaços e quebra de linha final (diffs limpos). */
export function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export const TEMP_SUFFIX = '.rota-tmp';

/**
 * Grava de forma atômica: escreve num arquivo temporário e renomeia. Evita
 * arquivos corrompidos se o app fechar no meio da escrita, e o watcher nunca
 * vê um JSON pela metade.
 */
export async function writeFileAtomic(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString('hex')}${TEMP_SUFFIX}`;
  try {
    await writeFile(tmp, content);
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, stringifyJson(value));
}

export async function readJson(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf8');
  // Remove BOM (arquivos editados no Bloco de Notas antigo).
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

export async function readJsonIfExists(path: string): Promise<unknown | undefined> {
  try {
    return await readJson(path);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}
