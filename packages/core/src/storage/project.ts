import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isNotFound, TEMP_SUFFIX } from '../util/fs';
import { MANIFEST_FILE } from './layout';

export interface FolderInspection {
  path: string;
  name: string;
  /** Já é um workspace do app (tem o manifesto). */
  isWorkspace: boolean;
  /** Pasta vazia (ou inexistente). */
  isEmpty: boolean;
  /** Existe .gitignore na pasta ou no repositório acima. */
  gitignorePath: string | null;
  /** O .gitignore já ignora os arquivos temporários do app. */
  ignoresTemp: boolean;
  /** Está dentro de um repositório Git. */
  inGitRepo: boolean;
  hasReadme: boolean;
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

/** Procura a raiz do repositório Git subindo a partir da pasta. */
async function findGitRoot(start: string): Promise<string | null> {
  let current = start;
  for (;;) {
    if (await exists(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const TEMP_PATTERN = `*${TEMP_SUFFIX}`;

/** Analisa uma pasta antes de abri-la como workspace de projeto. */
export async function inspectFolder(path: string): Promise<FolderInspection> {
  const entries = await readdir(path).catch((error: unknown) => {
    if (isNotFound(error)) return [] as string[];
    throw error;
  });
  const gitRoot = await findGitRoot(path);
  const candidates = [
    join(path, '.gitignore'),
    ...(gitRoot && gitRoot !== path ? [join(gitRoot, '.gitignore')] : []),
  ];
  let gitignorePath: string | null = null;
  let ignoresTemp = false;
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;
    gitignorePath ??= candidate;
    const text = await readFile(candidate, 'utf8');
    if (text.split(/\r?\n/).some((line) => line.trim() === TEMP_PATTERN)) ignoresTemp = true;
  }
  return {
    path,
    name: basename(path),
    isWorkspace: entries.includes(MANIFEST_FILE),
    isEmpty: entries.length === 0,
    gitignorePath,
    ignoresTemp,
    inGitRepo: gitRoot !== null,
    hasReadme: entries.some((e) => e.toLowerCase() === 'readme.md'),
  };
}

const README = (name: string) => `# ${name}

Coleções de API deste projeto, no formato do app **Rota** (um arquivo JSON por requisição).

- \`collections/\` — coleções, pastas e requisições (\`*.req.json\`) e exemplos salvos.
- \`environments/\` — ambientes (\`*.env.json\`).
- \`globals.json\` — variáveis globais.

Variáveis do tipo **secreta** guardam só o nome aqui; o valor fica cifrado na máquina de cada pessoa
e nunca vai para o Git. Abra esta pasta no Rota em "Abrir pasta como workspace".
`;

/**
 * Prepara a pasta de um projeto (com confirmação do usuário):
 * acrescenta os temporários do app ao .gitignore e cria um README explicativo.
 */
export async function prepareProjectFolder(
  path: string,
  options: { gitignore: boolean; readme: boolean },
): Promise<void> {
  if (options.gitignore) {
    const target = join(path, '.gitignore');
    const current = (await exists(target)) ? await readFile(target, 'utf8') : '';
    if (!current.split(/\r?\n/).some((line) => line.trim() === TEMP_PATTERN)) {
      const prefix = current && !current.endsWith('\n') ? '\n' : '';
      await writeFile(
        target,
        `${current}${prefix}${current ? '\n' : ''}# Rota: arquivos temporários de gravação\n${TEMP_PATTERN}\n`,
      );
    }
  }
  if (options.readme && !(await exists(join(path, 'README.md')))) {
    await writeFile(join(path, 'README.md'), README(basename(path)));
  }
}
