import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemorySecretStore } from '../secrets/secret-store';
import { inspectFolder, prepareProjectFolder } from './project';
import { WorkspaceStore } from './workspace-store';

let repo: string;
beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'rota-proj-'));
  await mkdir(join(repo, '.git'));
  await writeFile(join(repo, '.gitignore'), 'node_modules/');
});
afterEach(() => rm(repo, { recursive: true, force: true }));

describe('workspace de projeto', () => {
  it('inspeciona uma pasta dentro de um repositório', async () => {
    const folder = join(repo, 'api');
    const info = await inspectFolder(folder);
    expect(info).toMatchObject({
      name: 'api',
      isWorkspace: false,
      isEmpty: true,
      inGitRepo: true,
      gitignorePath: join(repo, '.gitignore'),
      ignoresTemp: false,
      hasReadme: false,
    });

    await WorkspaceStore.open(folder, { secrets: new MemorySecretStore() });
    expect((await inspectFolder(folder)).isWorkspace).toBe(true);
  });

  it('acrescenta o padrão ao .gitignore uma única vez e cria o README', async () => {
    await prepareProjectFolder(repo, { gitignore: true, readme: true });
    await prepareProjectFolder(repo, { gitignore: true, readme: true });
    const gitignore = await readFile(join(repo, '.gitignore'), 'utf8');
    expect(gitignore).toBe('node_modules/\n\n# Rota: arquivos temporários de gravação\n*.rota-tmp\n');
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toContain('Rota');
    expect((await inspectFolder(repo)).ignoresTemp).toBe(true);
  });
});
