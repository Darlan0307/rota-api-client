import { type ChildNode, type CollectionNode, isContainer } from '@rota/core/shared';
import { CheckCircle2, ChevronRight, Folder, Info, Library, XCircle } from 'lucide-react';
import { type ComponentType, type FormEvent, useState } from 'react';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { Field, TextInput } from '../components/form';
import { cn } from '../lib/cn';
import { saveRequestAs } from '../state/actions';
import { type ConfirmOptions, type PromptOptions, useDialogs } from '../state/dialogs';
import { useTabs } from '../state/tabs';
import { useToasts } from '../state/toasts';
import { useUiStore } from '../state/ui';
import { useSnapshot } from '../state/workspace';

/** Diálogos/painéis das funcionalidades (importação, confirmações do MCP...). */
const overlays: ComponentType[] = [];
export function registerOverlay(component: ComponentType): void {
  if (!overlays.includes(component)) overlays.push(component);
}

/** Renderiza os diálogos imperativos (confirm/prompt), o "Salvar como", overlays e toasts. */
export function DialogHost() {
  const current = useDialogs((s) => s.current);
  return (
    <>
      {overlays.map((Overlay, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lista fixa registrada na inicialização
        <Overlay key={i} />
      ))}
      <SaveAsDialog />
      {/* Confirmações por último: ficam acima de qualquer outro diálogo. */}
      {current?.kind === 'confirm' && <ConfirmView options={current.options} resolve={current.resolve} />}
      {current?.kind === 'prompt' && <PromptView options={current.options} resolve={current.resolve} />}
      <Toaster />
    </>
  );
}

function ConfirmView({
  options,
  resolve,
}: {
  options: ConfirmOptions;
  resolve: (r: 'confirm' | 'alternate' | 'cancel') => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && resolve('cancel')}
      title={options.title}
      className="w-[min(460px,92vw)]"
    >
      <div className="space-y-5 p-5">
        {options.description && (
          <div className="text-[13px] leading-relaxed text-fg-muted">{options.description}</div>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={() => resolve('cancel')}>{options.cancelLabel ?? 'Cancelar'}</Button>
          {options.alternateLabel && (
            <Button variant="danger" onClick={() => resolve('alternate')}>
              {options.alternateLabel}
            </Button>
          )}
          <Button
            autoFocus
            variant={options.danger ? 'danger' : 'primary'}
            onClick={() => resolve('confirm')}
          >
            {options.confirmLabel ?? 'Confirmar'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function PromptView({ options, resolve }: { options: PromptOptions; resolve: (v: string | null) => void }) {
  const [value, setValue] = useState(options.initialValue ?? '');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = options.validate?.(value) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    resolve(value.trim());
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && resolve(null)}
      title={options.title}
      className="w-[min(440px,92vw)]"
    >
      <form onSubmit={submit} className="space-y-5 p-5">
        <Field
          label={options.label ?? 'Nome'}
          hint={error ? <span className="text-danger">{error}</span> : undefined}
        >
          <TextInput
            autoFocus
            value={value}
            placeholder={options.placeholder}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={() => resolve(null)}>Cancelar</Button>
          <Button type="submit" variant="primary">
            {options.confirmLabel ?? 'Confirmar'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Salvar requisição nova em uma coleção/pasta

function SaveAsDialog() {
  const tabId = useUiStore((s) => s.saveAsTabId);
  const tab = useTabs((s) => s.tabs.find((t) => t.id === tabId));
  if (!tabId || tab?.kind !== 'request') return null;
  // key: o formulário reinicia (com os valores da aba) a cada abertura.
  return <SaveAsForm key={tabId} tabId={tabId} title={tab.title} parentId={tab.parentId} />;
}

function SaveAsForm({
  tabId,
  title,
  parentId: initialParent,
}: {
  tabId: string;
  title: string;
  parentId: string | null;
}) {
  const setTabId = useUiStore((s) => s.setSaveAsTabId);
  const snapshot = useSnapshot();
  const [name, setName] = useState(title === 'Nova requisição' ? '' : title);
  const [parentId, setParentId] = useState<string | null>(
    initialParent ?? snapshot.collections[0]?.id ?? null,
  );
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!parentId || name.trim() === '') return;
    setSaving(true);
    const ok = await saveRequestAs(tabId, parentId, name.trim());
    setSaving(false);
    if (ok) {
      useUiStore.getState().setExpanded(parentId, true);
      setTabId(null);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && setTabId(null)}
      title="Salvar requisição"
      className="w-[min(520px,92vw)]"
    >
      <form onSubmit={submit} className="flex min-h-0 flex-col gap-4 p-5">
        <Field label="Nome">
          <TextInput
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Listar pedidos"
          />
        </Field>
        <Field label="Salvar em">
          {snapshot.collections.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-fg-muted">
              Crie uma coleção primeiro (botão + na sidebar).
            </p>
          ) : (
            <div className="max-h-64 overflow-auto rounded-md border border-border p-1">
              {snapshot.collections.map((c) => (
                <DestinationRow key={c.id} node={c} depth={0} selected={parentId} onSelect={setParentId} />
              ))}
            </div>
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setTabId(null)}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={!parentId || name.trim() === '' || saving}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DestinationRow({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: CollectionNode | ChildNode;
  depth: number;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (!isContainer(node)) return null;
  const folders = node.children.filter(isContainer);
  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        style={{ paddingLeft: depth * 16 + 8 }}
        className={cn(
          'flex h-7 w-full items-center gap-1.5 rounded pr-2 text-left text-[13px]',
          selected === node.id ? 'bg-primary-soft text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
        )}
      >
        {folders.length > 0 ? (
          <ChevronRight className="size-3 rotate-90 text-fg-subtle" />
        ) : (
          <span className="w-3" />
        )}
        {node.kind === 'collection' ? <Library className="size-3.5" /> : <Folder className="size-3.5" />}
        <span className="truncate">{node.name}</span>
      </button>
      {folders.map((f) => (
        <DestinationRow key={f.id} node={f} depth={depth + 1} selected={selected} onSelect={onSelect} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Toasts

function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border bg-elevated px-3 py-2.5 text-[13px] shadow-xl shadow-black/40 animate-pop-in"
        >
          {t.kind === 'success' && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}
          {t.kind === 'error' && <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
          {t.kind === 'info' && <Info className="mt-0.5 size-4 shrink-0 text-primary" />}
          <p className="min-w-0 flex-1 break-words leading-snug text-fg">{t.message}</p>
          <button
            type="button"
            aria-label="Fechar aviso"
            onClick={() => dismiss(t.id)}
            className="text-fg-subtle hover:text-fg"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
