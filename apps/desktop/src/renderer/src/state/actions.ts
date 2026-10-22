import { api, errorMessage, runCommand } from '../lib/api';
import { confirmDialog } from './dialogs';
import { isDirty, type RequestTab, type Tab, useTabs } from './tabs';
import { toast } from './toasts';
import { useUiStore } from './ui';
import { draftsToInputs } from './variable-drafts';

function getTab(id: string): Tab | undefined {
  return useTabs.getState().tabs.find((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// Envio

export async function sendRequest(tabId: string): Promise<void> {
  const tab = getTab(tabId);
  if (tab?.kind !== 'request' || tab.run?.status === 'sending') return;
  if (tab.draft.url.trim() === '') {
    toast.info('Informe a URL antes de enviar.');
    return;
  }

  const runId = crypto.randomUUID();
  useTabs.getState().update<RequestTab>(tabId, (t) => ({
    ...t,
    run: {
      runId,
      status: 'sending',
      startedAt: Date.now(),
      ...(t.run?.result ? { result: t.run.result } : {}),
    },
  }));

  try {
    const result = await api.invoke('request:send', {
      runId,
      requestId: tab.itemId ?? undefined,
      parentId: tab.parentId ?? undefined,
      name: tab.title,
      data: tab.draft,
    });
    useTabs
      .getState()
      .update<RequestTab>(tabId, (t) =>
        t.run?.runId === runId ? { ...t, run: { ...t.run, status: 'done', result } } : t,
      );
  } catch (error) {
    useTabs.getState().update<RequestTab>(tabId, (t) =>
      t.run?.runId === runId
        ? {
            ...t,
            run: {
              ...t.run,
              status: 'done',
              result: {
                request: null,
                response: null,
                error: { code: 'unknown', message: errorMessage(error) },
                startedAt: new Date().toISOString(),
              },
            },
          }
        : t,
    );
  }
}

export function cancelRequest(tabId: string): void {
  const tab = getTab(tabId);
  if (tab?.kind === 'request' && tab.run?.status === 'sending')
    void api.invoke('request:cancel', tab.run.runId);
}

// ---------------------------------------------------------------------------
// Salvar

/** Salva a aba. Retorna false se não salvou (erro ou "Salvar como" pendente). */
export async function saveTab(tabId: string): Promise<boolean> {
  const tab = getTab(tabId);
  if (!tab) return false;
  const tabs = useTabs.getState();

  switch (tab.kind) {
    case 'request': {
      if (!tab.itemId) {
        useUiStore.getState().setSaveAsTabId(tabId);
        return false;
      }
      if (!isDirty(tab) && !tab.conflict) return true;
      const data = tab.draft;
      const ok = await runCommand({ type: 'updateRequest', id: tab.itemId, data });
      if (!ok) return false;
      tabs.markSaved(tabId, {}, data);
      return true;
    }
    case 'environment': {
      if (!tab.itemId) return false;
      const ok = await runCommand({
        type: 'updateEnvironment',
        id: tab.itemId,
        variables: draftsToInputs(tab.draft, tab.base),
      });
      if (ok) tabs.markSaved(tabId);
      return Boolean(ok);
    }
    case 'globals': {
      const ok = await runCommand({ type: 'updateGlobals', variables: draftsToInputs(tab.draft, tab.base) });
      if (ok) tabs.markSaved(tabId);
      return Boolean(ok);
    }
    case 'collection': {
      if (!tab.itemId) return false;
      const ok = await runCommand({
        type: 'updateCollection',
        id: tab.itemId,
        auth: tab.draft.auth,
        description: tab.draft.description,
        scripts: tab.draft.scripts,
        variables: draftsToInputs(tab.draft.variables, tab.base.variables),
      });
      if (ok) tabs.markSaved(tabId);
      return Boolean(ok);
    }
    case 'folder': {
      if (!tab.itemId) return false;
      const ok = await runCommand({
        type: 'updateFolder',
        id: tab.itemId,
        auth: tab.draft.auth,
        description: tab.draft.description,
        scripts: tab.draft.scripts,
      });
      if (ok) tabs.markSaved(tabId);
      return Boolean(ok);
    }
    case 'example':
    case 'loadtest':
    case 'tunnel':
    case 'database':
      return true;
  }
}

/** Salva uma requisição nova em uma coleção/pasta. */
export async function saveRequestAs(tabId: string, parentId: string, name: string): Promise<boolean> {
  const tab = getTab(tabId);
  if (tab?.kind !== 'request') return false;
  const data = tab.draft;
  const result = await runCommand({ type: 'createRequest', parentId, name, data });
  if (!result?.id) return false;
  useTabs.getState().markSaved(tabId, { itemId: result.id, parentId, title: name }, data);
  toast.success(`"${name}" salva.`);
  return true;
}

// ---------------------------------------------------------------------------
// Fechar

/** Fecha a aba perguntando antes se houver alterações não salvas. */
export async function closeTab(
  tabId: string,
  options: { force?: boolean; discard?: boolean } = {},
): Promise<void> {
  const tab = getTab(tabId);
  if (!tab) return;
  if (tab.pinned && !options.force) {
    toast.info('Aba fixada: desafixe-a (ou use "Fechar" no menu da aba) para fechar.');
    return;
  }
  if (isDirty(tab) && !options.discard) {
    const choice = await confirmDialog({
      title: `Salvar alterações em "${tab.title}"?`,
      description: 'Se você não salvar, as alterações feitas nesta aba serão perdidas.',
      confirmLabel: 'Salvar',
      alternateLabel: 'Descartar',
    });
    if (choice === 'cancel') return;
    if (choice === 'confirm' && !(await saveTab(tabId))) return;
  }
  if (tab.kind === 'request') cancelRequest(tabId);
  if (tab.kind === 'loadtest' && tab.status === 'running' && tab.runId) {
    const choice = await confirmDialog({
      title: 'Cancelar o teste de carga?',
      description: 'O teste está em andamento. Fechar a aba interrompe o envio.',
      confirmLabel: 'Cancelar teste e fechar',
      danger: true,
    });
    if (choice !== 'confirm') return;
    void api.invoke('loadtest:cancel', tab.runId);
  }
  useTabs.getState().close(tabId);
}

/**
 * Fecha as abas não fixadas (exceto `keepId`). Com uma só alterada, pergunta
 * como no fechamento normal; com várias, pergunta uma vez em vez de abrir um
 * diálogo por aba.
 */
export async function closeUnpinnedTabs(keepId?: string): Promise<void> {
  const targets = useTabs.getState().tabs.filter((t) => !t.pinned && t.id !== keepId);
  const dirty = targets.filter(isDirty);
  let discard = false;
  if (dirty.length > 1) {
    const choice = await confirmDialog({
      title: `${dirty.length} abas têm alterações não salvas`,
      description: `Fechar descarta as alterações em: ${dirty
        .slice(0, 6)
        .map((t) => `"${t.title}"`)
        .join(
          ', ',
        )}${dirty.length > 6 ? ` e mais ${dirty.length - 6}` : ''}. Para manter alguma, cancele e salve-a antes (Ctrl+S).`,
      confirmLabel: 'Descartar e fechar',
      danger: true,
    });
    if (choice !== 'confirm') return;
    discard = true;
  }
  for (const tab of targets) await closeTab(tab.id, { discard });
}
