import type { WorkspaceSnapshot } from '../model/tree';
import type { VariableTarget } from '../storage/workspace-store';
import { uniqueSlug } from '../util/slug';
import {
  exportCollectionToPostman,
  exportEnvironmentToPostman,
  exportGlobalsToPostman,
} from './postman-export';

/**
 * Backup completo no formato do Postman: todas as coleções, todos os ambientes
 * e as globais, numa pasta. Serve para guardar tudo (ex.: antes de formatar o
 * PC) e reimportar no Rota ou no Postman.
 */

export interface BackupFile {
  /** Caminho relativo dentro da pasta do backup. */
  path: string;
  content: string;
}

export interface BackupOptions {
  /** Valor real de um segredo; ausente = segredos vão vazios. */
  revealSecret?: (target: VariableTarget, key: string) => string | undefined;
  /** Data do backup (para o LEIA-ME). */
  date?: Date;
}

export interface BackupSummary {
  files: BackupFile[];
  collections: number;
  environments: number;
  /** Variáveis secretas com valor incluído. */
  secretsIncluded: number;
  /** Variáveis secretas existentes. */
  secretsTotal: number;
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export function buildBackup(snapshot: WorkspaceSnapshot, options: BackupOptions = {}): BackupSummary {
  const files: BackupFile[] = [];
  let secretsTotal = 0;
  let secretsIncluded = 0;

  const reveal = (target: VariableTarget) =>
    options.revealSecret
      ? (key: string) => {
          const value = options.revealSecret?.(target, key);
          if (value) secretsIncluded++;
          return value;
        }
      : undefined;

  const usedCollections = new Set<string>();
  for (const collection of snapshot.collections) {
    secretsTotal += collection.variables.filter((v) => v.type === 'secret').length;
    const slug = uniqueSlug(collection.name || 'colecao', usedCollections);
    usedCollections.add(slug);
    files.push({
      path: `colecoes/${slug}.postman_collection.json`,
      content: json(exportCollectionToPostman(collection, reveal({ kind: 'collection', id: collection.id }))),
    });
  }

  const usedEnvironments = new Set<string>();
  for (const environment of snapshot.environments) {
    secretsTotal += environment.variables.filter((v) => v.type === 'secret').length;
    const slug = uniqueSlug(environment.name || 'ambiente', usedEnvironments);
    usedEnvironments.add(slug);
    files.push({
      path: `ambientes/${slug}.postman_environment.json`,
      content: json(
        exportEnvironmentToPostman(environment, reveal({ kind: 'environment', id: environment.id })),
      ),
    });
  }

  secretsTotal += snapshot.globals.filter((v) => v.type === 'secret').length;
  files.push({
    path: 'globais.postman_globals.json',
    content: json(exportGlobalsToPostman(snapshot.globals, reveal({ kind: 'global' }))),
  });

  files.push({ path: 'LEIA-ME.txt', content: readme(snapshot, options, secretsIncluded, secretsTotal) });

  return {
    files,
    collections: snapshot.collections.length,
    environments: snapshot.environments.length,
    secretsIncluded,
    secretsTotal,
  };
}

function readme(
  snapshot: WorkspaceSnapshot,
  options: BackupOptions,
  included: number,
  total: number,
): string {
  const date = (options.date ?? new Date()).toLocaleString('pt-BR');
  const secrets =
    total === 0
      ? 'Não há variáveis secretas.'
      : options.revealSecret
        ? [
            `ATENÇÃO: ${included} valor(es) secreto(s) (tokens, senhas) estão em TEXTO PURO nestes arquivos.`,
            'Guarde esta pasta em local seguro e não envie para o Git nem para outras pessoas.',
          ]
        : [
            `${total} variável(is) secreta(s) foram exportadas VAZIAS (tokens e senhas não saem do app).`,
            'Depois de importar, preencha os valores de novo.',
          ];
  return [
    `Backup do Rota — ${date}`,
    `Workspace: ${snapshot.name}`,
    '',
    `- colecoes/: ${snapshot.collections.length} coleção(ões) no formato Postman v2.1`,
    `- ambientes/: ${snapshot.environments.length} ambiente(s)`,
    '- globais.postman_globals.json: variáveis globais',
    '',
    ...(typeof secrets === 'string' ? [secrets] : secrets),
    '',
    'Para restaurar no Rota: Importar (ícone de download na barra de coleções) e selecione todos os .json desta pasta.',
    'No Postman: Import → arraste a pasta ou os arquivos.',
    '',
  ].join('\r\n');
}
