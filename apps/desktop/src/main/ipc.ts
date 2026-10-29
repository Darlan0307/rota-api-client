import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  buildBackup,
  collectionToMarkdown,
  createdWorkspacesDir,
  type EvidenceStep,
  escapeHtml,
  exportCollectionToPostman,
  exportEnvironmentToPostman,
  exportGlobalsToPostman,
  generateCode,
  importPostmanFiles,
  inspectFolder,
  MANIFEST_FILE,
  MemorySecretStore,
  maskSecretValues,
  prepareForDisplay,
  prepareProjectFolder,
  previewPostmanFiles,
  readJsonIfExists,
  renderEvidenceCards,
  renderEvidenceHtml,
  renderEvidenceMarkdown,
  slugify,
  uniqueSlug,
  variableScopeFor,
  WorkspaceStore,
  withRecentWorkspace,
} from '@rota/core';
import {
  app,
  BrowserWindow,
  ClipboardItem,
  clipboard,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  shell,
} from 'electron';
import {
  IPC_ERROR_PREFIX,
  type IpcArgs,
  type IpcChannel,
  type IpcResult,
  type McpLaunchConfig,
  type McpStatus,
} from '../shared/ipc';
import { htmlToImages, htmlToPdf } from './pdf';
import type { DatabaseService } from './services/database-service';
import type { LoadTestService } from './services/loadtest-service';
import type { McpBridge } from './services/mcp-bridge';
import {
  claudeCodeCommand,
  claudeCodeStatuses,
  claudeDesktopSnippet,
  claudeDesktopStatus,
  findClaudeDesktopConfigPath,
  installInClaudeDesktop,
  mcpLaunchConfig,
  readIfExists,
  testMcpServer,
} from './services/mcp-setup';
import type { RequestService } from './services/request-service';
import type { SettingsService } from './services/settings-service';
import type { TunnelService } from './services/tunnel-service';
import type { WorkspaceService } from './services/workspace-service';

type Handler<C extends IpcChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcArgs<C>
) => IpcResult<C> | Promise<IpcResult<C>>;

function handle<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...(args as IpcArgs<C>));
    } catch (error) {
      // Prefixo permite ao preload recuperar a mensagem original para o usuário.
      throw new Error(`${IPC_ERROR_PREFIX}${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

export interface Services {
  mcp: McpBridge;
  workspace: WorkspaceService;
  requests: RequestService;
  settings: SettingsService;
  loadTests: LoadTestService;
  tunnels: TunnelService;
  databases: DatabaseService;
}

export function registerIpcHandlers({
  workspace,
  requests,
  settings,
  loadTests,
  mcp,
  tunnels,
  databases,
}: Services): void {
  handle('db:state', () => databases.state());
  handle('db:saveConnection', (_e, input, password) => databases.saveConnection(input, password));
  handle('db:duplicateConnection', (_e, id) => databases.duplicateConnection(id));
  handle('db:removeConnection', (_e, id) => databases.removeConnection(id));
  handle('db:saveCredential', (_e, input, password) => databases.saveCredential(input, password));
  handle('db:removeCredential', (_e, id) => databases.removeCredential(id));
  handle('db:test', (_e, input, password) => databases.test(input, password));
  handle('db:connect', (_e, id) => databases.connect(id));
  handle('db:disconnect', (_e, id) => databases.disconnect(id));
  handle('db:schema', (_e, id) => databases.schema(id));
  handle('db:run', (_e, id, sql, limit, options) => databases.run(id, sql, limit, options));
  handle('db:cancel', (_e, id) => databases.cancel(id));
  handle('db:history', (_e, id) => databases.history(id));
  handle('db:clearHistory', (_e, id) => databases.clearHistory(id));

  handle('tunnel:list', () => tunnels.views());
  handle('tunnel:binary', () => tunnels.binary());
  handle('tunnel:install', (event) =>
    tunnels.install((received, total) => event.sender.send('tunnel:download', { received, total })),
  );
  handle('tunnel:create', (_e, patch) => tunnels.create(patch));
  handle('tunnel:update', (_e, id, patch) => tunnels.update(id, patch));
  handle('tunnel:remove', (_e, id) => tunnels.remove(id));
  handle('tunnel:start', (_e, id) => tunnels.start(id));
  handle('tunnel:stop', (_e, id) => tunnels.stop(id));
  handle('tunnel:exchange', (_e, id, exchangeId) => tunnels.exchange(id, exchangeId));
  handle('tunnel:replay', (_e, id, exchangeId) => tunnels.replay(id, exchangeId));
  handle('tunnel:clear', (_e, id) => tunnels.clear(id));
  handle('tunnel:test', (_e, id, path) => tunnels.test(id, path));
  handle('tunnel:setWebhookSecret', (_e, id, value) => tunnels.setWebhookSecret(id, value));
  // O corpo simulado aceita {{variáveis}} das globais e do ambiente ativo, além dos dados de teste.
  handle('tunnel:simulate', (_e, id, input) =>
    tunnels.simulate(
      id,
      input,
      variableScopeFor(workspace.current, { environmentId: workspace.activeEnvironmentId }),
    ),
  );

  handle('mcp:respond', (_e, id, approved, rememberForSession) =>
    mcp.respond(id, approved, rememberForSession),
  );
  handle('mcp:sessionApprovals', () => mcp.sessionApprovals());
  handle('mcp:clearSessionApprovals', () => mcp.clearSessionApprovals());

  const launchConfig = () => mcpLaunchConfig(process.execPath, app.getAppPath(), process.env.ROTA_DATA_DIR);
  const desktopStatus = async (config: McpLaunchConfig) => {
    const path = await findClaudeDesktopConfigPath();
    return { path, status: claudeDesktopStatus(await readIfExists(path), config) };
  };
  handle('mcp:setup', async () => {
    const config = launchConfig();
    return {
      config,
      desktopSnippet: claudeDesktopSnippet(config),
      claudeCodeCommand: claudeCodeCommand(config),
      claudeDesktop: await desktopStatus(config),
      development: !app.isPackaged,
    };
  });
  handle('mcp:installClaudeDesktop', async () =>
    installInClaudeDesktop(await findClaudeDesktopConfigPath(), launchConfig()),
  );
  // Uma verificação por execução do app: a barra de status pede ao abrir e a
  // tela de configurações só repete quando o usuário pede.
  let mcpStatus: Promise<McpStatus> | undefined;
  handle('mcp:status', (_e, refresh) => {
    if (!mcpStatus || refresh) {
      const config = launchConfig();
      mcpStatus = Promise.all([
        testMcpServer(config),
        desktopStatus(config),
        claudeCodeStatuses(config),
      ]).then(([server, claudeDesktop, claudeCode]) => ({
        server,
        claudeDesktop,
        claudeCode,
        checkedAt: Date.now(),
      }));
    }
    return mcpStatus;
  });

  handle('app:getInfo', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    userDataPath: app.getPath('userData'),
  }));

  handle('window:setTitleBarColors', (event, colors) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && process.platform === 'win32') {
      win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor });
    }
  });

  handle('settings:get', () => settings.get());
  handle('settings:update', (_e, patch) => settings.update(patch));

  handle('workspace:get', () => workspace.state());
  handle('workspace:command', (_e, command) => workspace.command(command));
  handle('workspace:setActiveEnvironment', (_e, id) => workspace.setActiveEnvironment(id));
  handle('workspace:revealInExplorer', (_e, id) => {
    const path = id ? workspace.current.pathOf(id) : workspace.current.root;
    if (path) shell.showItemInFolder(path);
  });

  handle('secrets:reveal', (_e, target, key) => workspace.revealSecret(target, key));

  handle('request:send', (_e, input) => requests.send(input));
  handle('request:cancel', (_e, runId) => requests.cancel(runId));

  handle('dialog:openFiles', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: Electron.OpenDialogOptions = {
      title: options.title ?? 'Selecionar arquivo',
      properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    };
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? [] : result.filePaths;
  });

  // Importação do Postman: o renderer só passa caminhos; o main lê os arquivos.
  const readFiles = (paths: string[]) =>
    Promise.all(paths.map(async (path) => ({ fileName: path, content: await readFile(path, 'utf8') })));

  handle('import:pickFiles', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Importar do Postman ou OpenAPI',
      buttonLabel: 'Selecionar',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Postman ou OpenAPI (JSON, YAML)', extensions: ['json', 'yaml', 'yml'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });
  handle('import:preview', async (_e, paths) => previewPostmanFiles(await readFiles(paths)));
  handle('import:run', async (_e, paths, secretKeys) => {
    const report = await importPostmanFiles(workspace.current, await readFiles(paths), { secretKeys });
    workspace.emit();
    return report;
  });

  // Histórico
  handle('history:list', (_e, query, limit, requestId) =>
    workspace.history.list({ query, limit, ...(requestId ? { requestId } : {}) }),
  );
  handle('history:get', async (_e, id) => (await workspace.history.get(id)) ?? null);
  handle('history:remove', async (event, id) => {
    await workspace.history.remove(id);
    event.sender.send('history:changed', null);
  });
  handle('history:clear', async (event) => {
    await workspace.history.clear();
    event.sender.send('history:changed', null);
  });

  // Gerar código (segredos mascarados, a menos que o usuário peça para revelar)
  handle('codegen:generate', (_e, input) => {
    const prepared = prepareForDisplay(input.data, {
      store: workspace.current,
      requestId: input.requestId,
      parentId: input.parentId,
      environmentId: workspace.activeEnvironmentId,
      defaultTimeoutMs: settings.get().defaultTimeoutMs,
      reveal: input.reveal,
    });
    return generateCode(prepared, input.target);
  });

  // Exportação (valores secretos nunca vão para os arquivos exportados)
  const saveAs = async (
    event: Electron.IpcMainInvokeEvent,
    defaultName: string,
    ext: 'json' | 'md' | 'csv',
    content: string,
  ) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.SaveDialogOptions = {
      title: 'Exportar',
      defaultPath: defaultName,
      filters: [{ name: { json: 'JSON', md: 'Markdown', csv: 'CSV (Excel)' }[ext], extensions: [ext] }],
    };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, content, 'utf8');
    return result.filePath;
  };
  handle('export:collection', (event, id, format) => {
    const collection = workspace.current.snapshot().collections.find((c) => c.id === id);
    if (!collection) throw new Error('Coleção não encontrada.');
    const base = slugify(collection.name) || 'colecao';
    return format === 'postman'
      ? saveAs(
          event,
          `${base}.postman_collection.json`,
          'json',
          `${JSON.stringify(exportCollectionToPostman(collection), null, 2)}
`,
        )
      : saveAs(event, `${base}.md`, 'md', collectionToMarkdown(collection));
  });
  handle('export:all', async (event, includeSecrets) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Onde salvar o backup',
      buttonLabel: 'Salvar backup aqui',
      properties: ['openDirectory', 'createDirectory'],
    };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const base = picked.filePaths[0];
    if (picked.canceled || !base) return null;
    const store = workspace.current;
    const backup = buildBackup(store.snapshot(), {
      ...(includeSecrets ? { revealSecret: (target, key) => store.revealSecret(target, key) } : {}),
    });
    // Horário local: Rota-backup-2026-10-17_15h40.
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}`;
    const folder = join(base, `Rota-backup-${stamp}`);
    for (const file of backup.files) {
      const target = join(folder, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, 'utf8');
    }
    shell.showItemInFolder(join(folder, 'LEIA-ME.txt'));
    return {
      folder,
      files: backup.files.length,
      collections: backup.collections,
      environments: backup.environments,
      secretsIncluded: backup.secretsIncluded,
      secretsTotal: backup.secretsTotal,
    };
  });
  // BOM: o Excel só reconhece os acentos de um CSV em UTF-8 com ele.
  handle('export:csv', (event, name, csv) =>
    saveAs(event, `${slugify(name) || 'tabela'}.csv`, 'csv', `﻿${csv}`),
  );

  // Pacote de contexto: antes de sair do app (copiar ou salvar), troca todo valor
  // secreto conhecido do workspace (qualquer coleção e ambiente) por ••••••.
  const maskWorkspaceSecrets = (text: string, html = false) => {
    const store = workspace.current;
    const snapshot = store.snapshot();
    const secrets = new Set<string>();
    for (const environmentId of [null, ...snapshot.environments.map((e) => e.id)])
      for (const parentId of [undefined, ...snapshot.collections.map((c) => c.id)])
        for (const value of variableScopeFor(store, { parentId, environmentId }).secretValues())
          secrets.add(value);
    const values = [...secrets];
    if (html) values.push(...values.map(escapeHtml));
    return maskSecretValues(text, values);
  };
  handle('context:mask', (_e, markdown) => maskWorkspaceSecrets(markdown));
  handle('context:save', async (event, markdown, folder) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.SaveDialogOptions = {
      title: 'Salvar pacote de contexto',
      defaultPath: join(folder || app.getPath('documents'), 'contexto-rota.md'),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, maskWorkspaceSecrets(markdown), 'utf8');
    return result.filePath;
  });
  // Relatório de evidências: o histórico já guarda os envios mascarados, e o
  // texto final ainda passa pela máscara de todos os segredos do workspace.
  const evidenceSteps = async (ids: string[]): Promise<EvidenceStep[]> => {
    const steps: EvidenceStep[] = [];
    for (const id of ids) {
      const entry = await workspace.history.get(id);
      if (entry)
        steps.push({
          id: entry.id,
          name: entry.name,
          at: entry.at,
          source: entry.source,
          result: entry.result,
        });
    }
    if (steps.length === 0) throw new Error('Nenhum dos envios escolhidos está mais no histórico.');
    return steps;
  };
  const askSavePath = async (
    event: IpcMainInvokeEvent,
    name: string,
    filter: Electron.FileFilter,
  ): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.SaveDialogOptions = {
      title: 'Salvar relatório',
      defaultPath: join(app.getPath('documents'), name),
      filters: [filter],
    };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? null : result.filePath;
  };
  handle('evidence:render', async (_e, ids, options) =>
    maskWorkspaceSecrets(renderEvidenceMarkdown(await evidenceSteps(ids), options)),
  );
  handle('evidence:save', async (event, ids, options, format) => {
    const steps = await evidenceSteps(ids);
    const path = await askSavePath(
      event,
      `${slugify(options.title) || 'relatorio'}.${format}`,
      format === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'Markdown', extensions: ['md'] },
    );
    if (!path) return null;
    if (format === 'md') {
      await writeFile(path, maskWorkspaceSecrets(renderEvidenceMarkdown(steps, options)), 'utf8');
    } else {
      await writeFile(path, await htmlToPdf(maskWorkspaceSecrets(renderEvidenceHtml(steps, options), true)));
    }
    return path;
  });
  handle('evidence:image', async (event, ids, options, layout, action) => {
    const steps = await evidenceSteps(ids);
    const html =
      layout === 'cards' ? renderEvidenceCards(steps, options) : renderEvidenceHtml(steps, options);
    const parts = await htmlToImages(maskWorkspaceSecrets(html, true), layout === 'cards' ? 760 : 900);
    if (action === 'preview') {
      const first = parts[0];
      return { parts: parts.length, preview: first ? first.toDataURL() : '' };
    }
    if (action === 'copy') {
      if (parts.length > 1 || !parts[0])
        throw new Error(
          `A imagem ficou grande demais para copiar (${parts.length} partes). Salve como PNG, use os cartões resumidos ou desmarque algumas partes.`,
        );
      await clipboard.write([
        new ClipboardItem({
          'image/png': new Blob([new Uint8Array(parts[0].toPNG())], { type: 'image/png' }),
        }),
      ]);
      return { parts: 1 };
    }
    const path = await askSavePath(event, `${slugify(options.title) || 'relatorio'}.png`, {
      name: 'Imagem PNG',
      extensions: ['png'],
    });
    if (!path) return { parts: parts.length, path: null };
    if (parts.length === 1 && parts[0]) {
      await writeFile(path, parts[0].toPNG());
    } else {
      // Relatório longo: uma imagem por parte (relatorio-1.png, relatorio-2.png...).
      const base = path.replace(/\.png$/i, '');
      for (const [i, part] of parts.entries()) await writeFile(`${base}-${i + 1}.png`, part.toPNG());
    }
    return { parts: parts.length, path };
  });
  handle('export:variables', (event, id) => {
    const snap = workspace.current.snapshot();
    if (id === null) {
      return saveAs(
        event,
        'globals.postman_globals.json',
        'json',
        `${JSON.stringify(exportGlobalsToPostman(snap.globals), null, 2)}
`,
      );
    }
    const env = snap.environments.find((e) => e.id === id);
    if (!env) throw new Error('Ambiente não encontrado.');
    return saveAs(
      event,
      `${slugify(env.name) || 'ambiente'}.postman_environment.json`,
      'json',
      `${JSON.stringify(exportEnvironmentToPostman(env), null, 2)}
`,
    );
  });

  // Teste de carga
  handle('loadtest:start', (event, input) =>
    loadTests.run(input, (stats) => {
      if (!event.sender.isDestroyed()) event.sender.send('loadtest:progress', { runId: input.runId, stats });
    }),
  );
  handle('loadtest:cancel', (_e, runId) => loadTests.cancel(runId));

  // Lixeira
  const trashChanged = (sender: Electron.WebContents) => sender.send('trash:changed', null);
  handle('trash:list', () => workspace.trash.list());
  handle('trash:restore', async (event, id) => {
    await workspace.trash.restore(id);
    workspace.emit();
    trashChanged(event.sender);
  });
  handle('trash:remove', async (event, id) => {
    await workspace.trash.remove(id);
    trashChanged(event.sender);
  });
  handle('trash:empty', async (event) => {
    const count = await workspace.trash.empty();
    trashChanged(event.sender);
    return count;
  });

  // Workspaces de projeto
  handle('workspace:pickFolder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Abrir pasta como workspace',
      buttonLabel: 'Abrir',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle('workspace:inspectFolder', (_e, path) => inspectFolder(path));
  handle('workspace:open', async (event, path, prepare) => {
    if (path && prepare) await prepareProjectFolder(path, prepare);
    const state = await workspace.open(path);
    const current = settings.get();
    await settings.update({
      currentWorkspace: path,
      ...(path ? { recentWorkspaces: withRecentWorkspace(current, path).recentWorkspaces } : {}),
    });
    trashChanged(event.sender);
    event.sender.send('history:changed', null);
    workspace.emit();
    return state;
  });
  handle('workspace:recent', async () => {
    const current = settings.get();
    // Nome do rota.workspace.json; sem ele (pasta apagada, sem acesso), o nome da pasta.
    const recent = await Promise.all(
      current.recentWorkspaces.map(async (path) => {
        const manifest = (await readJsonIfExists(join(path, MANIFEST_FILE)).catch(() => undefined)) as
          | { name?: unknown }
          | undefined;
        const name =
          typeof manifest?.name === 'string' && manifest.name.trim() ? manifest.name : basename(path);
        return { path, name };
      }),
    );
    return { current: current.currentWorkspace, recent, startup: current.startupWorkspace };
  });
  handle('workspace:create', async (_e, rawName) => {
    const name = rawName.trim();
    if (!name) throw new Error('Dê um nome para o workspace.');
    const base = createdWorkspacesDir();
    await mkdir(base, { recursive: true });
    const existing = (await readdir(base, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const path = join(base, uniqueSlug(slugify(name) || 'workspace', existing));
    // Abrir o store cria a pasta e o rota.workspace.json com o nome escolhido.
    await WorkspaceStore.open(path, { secrets: new MemorySecretStore(), defaultName: name });
    await settings.update({ recentWorkspaces: withRecentWorkspace(settings.get(), path).recentWorkspaces });
    return path;
  });
  handle('workspace:setStartup', async (_e, startup) => {
    await settings.update({ startupWorkspace: startup });
  });
  handle('workspace:forgetRecent', async (_e, path) => {
    const current = settings.get();
    await settings.update({ recentWorkspaces: current.recentWorkspaces.filter((p) => p !== path) });
  });

  // Exemplos: o arquivo é versionado, então valores secretos são mascarados antes de gravar.
  handle('examples:save', async (_e, input) => {
    const store = workspace.current;
    const secrets = variableScopeFor(store, {
      requestId: input.requestId,
      environmentId: workspace.activeEnvironmentId,
    }).secretValues();
    const mask = (text: string) => maskSecretValues(text, secrets);
    const res = input.response;
    const body =
      res.body.encoding === 'utf8' ? mask(res.body.data) : '(resposta binária não salva no exemplo)';
    const id = await store.saveExample(input.requestId, {
      name: input.name,
      ...(input.request
        ? {
            request: {
              method: input.request.method,
              url: mask(input.request.url),
              headers: input.request.headers.map(([key, value]) => ({
                key,
                value: mask(value),
                enabled: true,
              })),
              ...(input.request.body.kind === 'text' ? { body: mask(input.request.body.text) } : {}),
            },
          }
        : {}),
      response: {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers.map(([key, value]) => ({ key, value: mask(value), enabled: true })),
        body,
        timeMs: res.timings.total,
      },
      savedAt: new Date().toISOString(),
    });
    workspace.emit();
    return id;
  });
}
