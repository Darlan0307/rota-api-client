import { CONTEXT_KIND_LABELS, type ContextItem, renderContextPack } from '@rota/core/shared';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Database,
  FileDown,
  Globe,
  NotebookPen,
  Package,
  PackagePlus,
  StickyNote,
  Trash2,
  Webhook,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MenuEntry } from '../../components/ActionMenu';
import { Button } from '../../components/Button';
import { CodeEditor } from '../../components/CodeEditor';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { TextArea, TextInput } from '../../components/form';
import { IconButton } from '../../components/IconButton';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { confirmDialog } from '../../state/dialogs';
import type { RequestTab } from '../../state/tabs';
import { toast } from '../../state/toasts';
import { useWorkspace } from '../../state/workspace';
import {
  addNoteToPack,
  addRequestToPack,
  clearPack,
  movePackItem,
  openContextPack,
  removeFromPack,
  updatePackItem,
  useContextPack,
} from './state';

const ICONS = {
  request: Globe,
  table: Database,
  profile: Database,
  webhook: Webhook,
  note: StickyNote,
} as const;

function folderKey(root: string | undefined): string {
  return `rota:context-pack-folder:${root ?? ''}`;
}

function readFolder(root: string | undefined): string | undefined {
  try {
    return localStorage.getItem(folderKey(root)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Painel do pacote de contexto: itens, ordem, notas, prévia e saída (copiar ou salvar). */
export function ContextPackDialog() {
  const open = useContextPack((s) => s.open);
  const items = useContextPack((s) => s.items);
  const root = useWorkspace((s) => s.state?.snapshot.root);
  const [preview, setPreview] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .invoke('context:mask', renderContextPack(items))
        .then((text) => !cancelled && setPreview(text))
        .catch((error: unknown) => !cancelled && setPreview(errorMessage(error)));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, items]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(await api.invoke('context:mask', renderContextPack(items)));
      toast.success('Pacote copiado. Cole no Claude Code.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function save() {
    try {
      const path = await api.invoke('context:save', renderContextPack(items), readFolder(root));
      if (!path) return;
      try {
        localStorage.setItem(folderKey(root), path.replace(/[\\/][^\\/]+$/, ''));
      } catch {
        // Sem localStorage: só não lembra a pasta.
      }
      toast.success(`Pacote salvo em ${path}. Peça ao Claude Code para ler esse arquivo.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function clear() {
    const choice = await confirmDialog({
      title: 'Esvaziar o pacote?',
      description: 'Os itens saem do pacote (nada é apagado das coleções, bancos ou túneis).',
      confirmLabel: 'Esvaziar',
      danger: true,
    });
    if (choice === 'confirm') clearPack();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => openContextPack(o)}
      title="Pacote de contexto para o Claude"
      className="h-[min(760px,90vh)] w-[min(1100px,96vw)]"
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-r">
          <p className="shrink-0 px-4 pt-3 pb-2 text-xs leading-relaxed text-fg-muted">
            Junte requisições, tabelas, perfis e webhooks e entregue tudo de uma vez ao Claude Code. Nada vai
            pelo MCP: sai só quando você copia ou salva, com os segredos trocados por ••••••.
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {items.length === 0 ? (
              <EmptyState
                compact
                icon={Package}
                title="Pacote vazio"
                description='Use "Pacote" na resposta de uma requisição, "Adicionar ao pacote" numa tabela ou no perfil, ou no inspetor do túnel.'
              />
            ) : (
              <ul className="space-y-1">
                {items.map((item, i) => (
                  <PackItemRow key={item.id} item={item} first={i === 0} last={i === items.length - 1} />
                ))}
              </ul>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
            <Button size="sm" variant="ghost" onClick={addNoteToPack}>
              <NotebookPen className="size-3.5" /> Nota
            </Button>
            <div className="flex-1" />
            {items.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => void clear()}>
                <Trash2 className="size-3.5" /> Esvaziar
              </Button>
            )}
          </div>
        </div>
        <div className="flex min-h-[240px] min-w-0 flex-col">
          <p className="flex h-9 shrink-0 items-center px-4 text-xs text-fg-muted">
            Prévia (o que será entregue)
          </p>
          <div className="min-h-0 flex-1 border-t border-border">
            <CodeEditor value={preview} language="plaintext" readOnly wordWrap />
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
        <span className="mr-auto text-xs text-fg-subtle">
          {items.length === 1 ? '1 item' : `${items.length} itens`} · fica só na memória até você salvar
        </span>
        <Button disabled={items.length === 0} onClick={() => void copy()}>
          <Copy className="size-3.5" /> Copiar
        </Button>
        <Button variant="primary" disabled={items.length === 0} onClick={() => void save()}>
          <FileDown className="size-3.5" /> Salvar no projeto…
        </Button>
      </div>
    </Dialog>
  );
}

function PackItemRow({ item, first, last }: { item: ContextItem; first: boolean; last: boolean }) {
  const Icon = ICONS[item.kind];
  return (
    <li className="rounded-md border border-border bg-surface p-2">
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0 text-fg-subtle" />
        <span className="shrink-0 rounded bg-surface-2 px-1 text-2xs text-fg-muted">
          {CONTEXT_KIND_LABELS[item.kind]}
        </span>
        {item.kind === 'note' ? (
          <TextInput
            value={item.title}
            onChange={(e) => updatePackItem(item.id, { title: e.target.value })}
            className="h-6 min-w-0 flex-1 text-xs"
            aria-label="Título da nota"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs text-fg" title={item.title}>
            {item.title}
          </span>
        )}
        <IconButton
          icon={ArrowUp}
          label="Subir"
          size="sm"
          disabled={first}
          onClick={() => movePackItem(item.id, -1)}
        />
        <IconButton
          icon={ArrowDown}
          label="Descer"
          size="sm"
          disabled={last}
          onClick={() => movePackItem(item.id, 1)}
        />
        <IconButton icon={X} label="Tirar do pacote" size="sm" onClick={() => removeFromPack(item.id)} />
      </div>
      {item.kind === 'note' && (
        <TextArea
          value={item.text}
          onChange={(e) => updatePackItem(item.id, { text: e.target.value })}
          placeholder="Ex.: o que você quer que o Claude faça com isto, regras do projeto, dúvidas…"
          className={cn('mt-1.5 min-h-20 w-full text-xs')}
          aria-label="Texto da nota"
        />
      )}
    </li>
  );
}

/** Indicador na barra de status (aparece com itens no pacote). */
export function ContextPackIndicator() {
  const count = useContextPack((s) => s.items.length);
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={() => openContextPack()}
      className="flex items-center gap-1 text-primary hover:underline"
      title="Abrir o pacote de contexto"
    >
      <Package className="size-3" /> Pacote ({count})
    </button>
  );
}

/** Botão "Pacote" no cabeçalho da resposta. */
export function addToPackAction(tab: RequestTab): MenuEntry | null {
  if (!tab.run?.result?.response) return null;
  return {
    label: 'Adicionar ao pacote de contexto',
    icon: PackagePlus,
    onSelect: () => addRequestToPack(tab),
  };
}
