import { type ExampleFile, findNode, formatJson } from '@rota/core/shared';
import { BookmarkPlus, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { CodeEditor } from '../../components/CodeEditor';
import { MethodBadge } from '../../components/MethodBadge';
import { TabStrip } from '../../components/TabStrip';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatDateTime, formatDuration, statusTone } from '../../lib/format';
import { promptDialog } from '../../state/dialogs';
import { type ExampleTab, type RequestTab, useTabs } from '../../state/tabs';
import { toast } from '../../state/toasts';
import { useWorkspace } from '../../state/workspace';
import { openItemById } from '../request/open';
import { removeItem, renameItem } from '../sidebar/item-actions';

/** Salva a resposta atual como exemplo nomeado da requisição. */
export async function saveResponseAsExample(tab: RequestTab): Promise<void> {
  const response = tab.run?.result?.response;
  if (!response) return;
  if (!tab.itemId) {
    toast.info('Salve a requisição antes de guardar exemplos.');
    return;
  }
  const name = await promptDialog({
    title: 'Salvar como exemplo',
    label: 'Nome do exemplo',
    initialValue: `${response.status} ${response.statusText}`.trim(),
    validate: (v) => (v.trim() ? null : 'Informe um nome.'),
  });
  if (!name) return;
  try {
    await api.invoke('examples:save', {
      requestId: tab.itemId,
      name,
      request: tab.run?.result?.request ?? null,
      response,
    });
    toast.success(`Exemplo "${name}" salvo. Valores secretos foram mascarados no arquivo.`);
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

export function SaveExampleButton({ tab }: { tab: RequestTab }) {
  if (!tab.run?.result?.response) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => void saveResponseAsExample(tab)}
      title="Salvar como exemplo"
    >
      <BookmarkPlus className="size-3.5" />
      Exemplo
    </Button>
  );
}

function languageOf(example: ExampleFile): 'json' | 'xml' | 'html' | 'plaintext' {
  const ct = example.response.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? '';
  if (/json/i.test(ct) || /^\s*[[{]/.test(example.response.body)) return 'json';
  if (/html/i.test(ct)) return 'html';
  if (/xml/i.test(ct)) return 'xml';
  return 'plaintext';
}

function pretty(text: string, language: string): string {
  if (language !== 'json') return text;
  return formatJson(text) ?? text;
}

/** Visualização (somente leitura) de um exemplo salvo. */
export function ExampleTabView({ tab }: { tab: ExampleTab }) {
  const ex = tab.base;
  const [section, setSection] = useState<'body' | 'headers' | 'request'>('body');
  const tone = statusTone(ex.response.status);
  const language = languageOf(ex);

  async function rename() {
    const name = await promptDialog({ title: 'Renomear exemplo', initialValue: ex.name });
    if (name && tab.itemId) await renameItem(tab.itemId, ex.name, name);
  }

  async function remove() {
    if (!tab.itemId) return;
    useTabs.getState().close(tab.id);
    await removeItem(tab.itemId, ex.name);
  }

  const requestName =
    useWorkspace((s) => {
      const snap = s.state?.snapshot;
      return snap ? findNode(snap, tab.requestId)?.name : undefined;
    }) ?? 'requisição';

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{ex.name}</h1>
          <p className="text-xs text-fg-muted">
            Exemplo salvo de{' '}
            <button
              type="button"
              onClick={() => openItemById(tab.requestId)}
              className="text-primary hover:underline"
            >
              {requestName}
            </button>
            {ex.savedAt ? ` · ${formatDateTime(ex.savedAt)}` : ''}
          </p>
        </div>
        <span
          className={cn(
            'font-mono text-xs font-semibold',
            tone === 'success' && 'text-success',
            tone === 'warning' && 'text-warning',
            tone === 'danger' && 'text-danger',
          )}
        >
          {ex.response.status} {ex.response.statusText}
        </span>
        {ex.response.timeMs !== undefined && (
          <span className="font-mono text-xs text-fg-muted">{formatDuration(ex.response.timeMs)}</span>
        )}
        <Button size="sm" variant="ghost" onClick={() => openItemById(tab.requestId)}>
          <ExternalLink className="size-3.5" /> Requisição
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void rename()}>
          <Pencil className="size-3.5" /> Renomear
        </Button>
        <Button size="sm" variant="danger" onClick={() => void remove()}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <TabStrip activeKey={section} className="h-10 shrink-0 items-stretch gap-4 border-b border-border px-6">
        {(
          [
            ['body', 'Body da resposta'],
            ['headers', `Headers (${ex.response.headers.length})`],
            ...(ex.request ? [['request', 'Requisição original']] : []),
          ] as [typeof section, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            onClick={() => setSection(id)}
            className={cn(
              'relative shrink-0 text-[13px]',
              section === id ? 'text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {label}
            {section === id && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </TabStrip>
      <div className="min-h-0 flex-1 overflow-auto">
        {section === 'body' && (
          <CodeEditor value={pretty(ex.response.body, language)} language={language} readOnly />
        )}
        {section === 'headers' && (
          <table className="m-6 w-[calc(100%-3rem)] select-text text-xs">
            <tbody>
              {ex.response.headers.map((h, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: headers podem se repetir
                <tr key={i} className="border-b border-border">
                  <td className="w-1/3 py-1.5 pr-4 font-mono text-fg-muted">{h.key}</td>
                  <td className="break-all py-1.5 font-mono">{h.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {section === 'request' && ex.request && (
          <div className="space-y-4 p-6 text-xs">
            <p className="flex items-center gap-2 font-mono">
              <MethodBadge method={ex.request.method} short={false} />
              <span className="select-text break-all">{ex.request.url}</span>
            </p>
            {ex.request.headers.length > 0 && (
              <div className="select-text rounded-md border border-border p-3 font-mono">
                {ex.request.headers.map((h, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: headers podem se repetir
                  <p key={i}>
                    <span className="text-fg-muted">{h.key}:</span> {h.value}
                  </p>
                ))}
              </div>
            )}
            {ex.request.body && (
              <pre className="select-text overflow-auto rounded-md border border-border p-3 font-mono">
                {ex.request.body}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
