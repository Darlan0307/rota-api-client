import { DEFAULT_EVIDENCE_OPTIONS, type EvidenceOptions, type HistorySummary } from '@rota/core/shared';
import { Bot, Copy, FileDown, FileText, Image, LoaderCircle, RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { MenuEntry } from '../../components/ActionMenu';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextInput } from '../../components/form';
import { MethodBadge } from '../../components/MethodBadge';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { statusTone } from '../../lib/format';
import type { RequestTab } from '../../state/tabs';
import { toast } from '../../state/toasts';
import { useActiveEnvironmentId, useSnapshot } from '../../state/workspace';
import { loadPreset, presetOf, ROTA_PRESET, samePreset, savePreset } from './defaults';
import { activateOnKey, CheckMark, ContentPanel, type Patch, TextsPanel } from './EvidencePanels';

/**
 * Relatório de evidências: o usuário marca envios do histórico (ex.: login e
 * a consulta que falhou), escolhe o que entra e leva tudo em Markdown, PDF ou
 * imagem para um colega ou o suporte da API.
 */

/** Como achar o envio que já vem marcado: pelo id do histórico ou pela hora do envio. */
type Preselect = { historyId: string } | { at: string } | null;

const useEvidence = create<{ open: boolean; preselect: Preselect }>()(() => ({
  open: false,
  preselect: null,
}));

export function openEvidenceDialog(preselect: Preselect = null): void {
  useEvidence.setState({ open: true, preselect });
}

const close = () => useEvidence.setState({ open: false, preselect: null });

export function evidenceAction(tab: RequestTab): MenuEntry | null {
  const run = tab.run;
  if (!run?.result || run.status !== 'done') return null;
  const preselect: Preselect = run.viewing
    ? { historyId: run.viewing.historyId }
    : { at: run.result.startedAt };
  return { label: 'Relatório de evidências', icon: FileText, onSelect: () => openEvidenceDialog(preselect) };
}

const LIST_LIMIT = 40;
type LeftTab = 'sends' | 'content' | 'texts';
type PreviewTab = 'markdown' | 'image';
type ImageLayout = 'cards' | 'full';
type Busy = 'md' | 'pdf' | 'copy-image' | 'save-image' | null;

export function EvidenceDialog() {
  const open = useEvidence((s) => s.open);
  const preselect = useEvidence((s) => s.preselect);
  if (!open) return null;
  return <EvidenceForm preselect={preselect} />;
}

function EvidenceForm({ preselect }: { preselect: Preselect }) {
  const snapshot = useSnapshot();
  const activeEnvironmentId = useActiveEnvironmentId();
  const environmentName = snapshot.environments.find((e) => e.id === activeEnvironmentId)?.name ?? '';

  const [items, setItems] = useState<HistorySummary[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState(loadPreset);
  const [form, setForm] = useState<EvidenceOptions>(() => ({
    ...DEFAULT_EVIDENCE_OPTIONS,
    ...loadPreset(),
    title: '',
    environment: environmentName,
  }));
  const [leftTab, setLeftTab] = useState<LeftTab>('sends');
  const [previewTab, setPreviewTab] = useState<PreviewTab>('markdown');
  const [layout, setLayout] = useState<ImageLayout>('cards');
  const [markdown, setMarkdown] = useState('');
  const [image, setImage] = useState<{ src: string; parts: number } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);

  const patch: Patch = (next) => setForm((f) => ({ ...f, ...(typeof next === 'function' ? next(f) : next) }));

  useEffect(() => {
    let alive = true;
    api
      .invoke('history:list', '', LIST_LIMIT)
      .then(({ items: list }) => {
        if (!alive) return;
        setItems(list);
        const found = preselect
          ? list.find((i) =>
              'historyId' in preselect ? i.id === preselect.historyId : i.at === preselect.at,
            )
          : list[0];
        if (found) setSelected([found.id]);
      })
      .catch((error: unknown) => toast.error(errorMessage(error)));
    return () => {
      alive = false;
    };
  }, [preselect]);

  const chosen = useMemo(() => (items ?? []).filter((i) => selected.includes(i.id)), [items, selected]);
  // Título sugerido pelo que foi marcado, até o usuário escrever o dele.
  const suggestedTitle = useMemo(() => {
    const failed = chosen.find((i) => i.status === null || i.status >= 400);
    const nameOf = (i: HistorySummary) => form.stepNames[i.id]?.trim() || i.name;
    if (failed) return `${failed.status === null ? 'Falha' : `Erro ${failed.status}`} em ${nameOf(failed)}`;
    if (chosen.length === 1 && chosen[0]) return `Envio de ${nameOf(chosen[0])}`;
    return DEFAULT_EVIDENCE_OPTIONS.title;
  }, [chosen, form.stepNames]);

  const options: EvidenceOptions = useMemo(
    () => ({ ...form, title: form.title.trim() || suggestedTitle }),
    [form, suggestedTitle],
  );
  const empty = selected.length === 0;

  // Prévia: só a aba visível é montada (a imagem é renderizada no processo principal).
  useEffect(() => {
    if (empty) {
      setMarkdown('');
      setImage(null);
      return;
    }
    let alive = true;
    setRendering(true);
    const timer = setTimeout(
      () => {
        const job =
          previewTab === 'markdown'
            ? api.invoke('evidence:render', selected, options).then((md) => alive && setMarkdown(md))
            : api
                .invoke('evidence:image', selected, options, layout, 'preview')
                .then((r) => alive && setImage({ src: r.preview ?? '', parts: r.parts }));
        job
          .catch(
            (error: unknown) =>
              alive && toast.error(`Não foi possível montar a prévia: ${errorMessage(error)}`),
          )
          .finally(() => alive && setRendering(false));
      },
      previewTab === 'markdown' ? 200 : 450,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [selected, options, previewTab, layout, empty]);

  function toggleItem(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  /** Marca também o envio feito logo antes do mais antigo marcado (o login, por exemplo). */
  function addPrevious() {
    if (!items) return;
    const indexes = selected.map((id) => items.findIndex((i) => i.id === id)).filter((i) => i >= 0);
    const oldest = indexes.length > 0 ? Math.max(...indexes) : -1;
    const extra = items[oldest + 1];
    if (extra) setSelected((current) => [...new Set([...current, extra.id])]);
  }

  async function run(kind: Exclude<Busy, null>, action: () => Promise<void>) {
    setBusy(kind);
    try {
      await action();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const copyMarkdown = () =>
    run('md', async () => {
      await navigator.clipboard.writeText(await api.invoke('evidence:render', selected, options));
      toast.success('Relatório copiado em Markdown.');
    });
  const saveFile = (format: 'md' | 'pdf') =>
    run(format, async () => {
      const path = await api.invoke('evidence:save', selected, options, format);
      if (path) toast.success(`Relatório salvo em ${path}`);
    });
  const copyImage = () =>
    run('copy-image', async () => {
      await api.invoke('evidence:image', selected, options, layout, 'copy');
      toast.success('Imagem copiada. Cole no chat ou no e-mail com Ctrl+V.');
    });
  const saveImage = () =>
    run('save-image', async () => {
      const r = await api.invoke('evidence:image', selected, options, layout, 'save');
      if (r.path)
        toast.success(
          r.parts > 1 ? `${r.parts} imagens salvas junto de ${r.path}` : `Imagem salva em ${r.path}`,
        );
    });

  const current = presetOf(form);
  const differsFromSaved = !samePreset(current, saved);
  const differsFromRota = !samePreset(current, ROTA_PRESET);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title="Relatório de evidências"
      className="h-[min(900px,92vh)] w-[min(1240px,96vw)]"
    >
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[420px] shrink-0 flex-col border-r border-border">
          <div className="flex h-10 shrink-0 items-stretch gap-4 border-b border-border px-4">
            {(
              [
                ['sends', `Envios (${selected.length})`],
                ['content', 'Conteúdo'],
                ['texts', 'Textos'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={leftTab === id}
                onClick={() => setLeftTab(id)}
                className={cn(
                  'relative text-[13px] transition-colors',
                  leftTab === id ? 'text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {label}
                {leftTab === id && (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
                )}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {leftTab === 'sends' && (
              <SendsPanel
                items={items}
                selected={selected}
                stepNames={form.stepNames}
                onToggle={toggleItem}
                onRename={(id, name) => patch((f) => ({ stepNames: { ...f.stepNames, [id]: name } }))}
                onAddPrevious={addPrevious}
                onClear={() => setSelected([])}
              />
            )}
            {leftTab === 'content' && <ContentPanel options={form} patch={patch} />}
            {leftTab === 'texts' && (
              <TextsPanel options={form} patch={patch} suggestedTitle={suggestedTitle} />
            )}
          </div>

          <div className="flex items-center gap-1.5 border-t border-border px-4 py-2.5">
            <p className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
              {differsFromSaved ? 'Opções diferentes do seu padrão' : 'Usando o seu padrão'}
            </p>
            <Button
              size="sm"
              variant="ghost"
              disabled={!differsFromRota}
              title="Volta às opções e textos padrão do Rota (não apaga o seu padrão salvo)"
              onClick={() => setForm((f) => ({ ...f, ...ROTA_PRESET }))}
            >
              <RotateCcw className="size-3.5" /> Padrão do Rota
            </Button>
            <Button
              size="sm"
              disabled={!differsFromSaved}
              title="O que está marcado, os limites, o título da seção e o rodapé passam a vir assim ao abrir"
              onClick={() => {
                if (savePreset(current)) {
                  setSaved(current);
                  toast.success('Padrão salvo: o relatório vai abrir com estas opções.');
                } else {
                  toast.error('Não foi possível salvar o padrão neste computador.');
                }
              }}
            >
              <Save className="size-3.5" /> Salvar como padrão
            </Button>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-stretch gap-4 border-b border-border px-4">
            {(
              [
                ['markdown', 'Markdown / PDF'],
                ['image', 'Imagem'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={previewTab === id}
                onClick={() => setPreviewTab(id)}
                className={cn(
                  'relative text-[13px] transition-colors',
                  previewTab === id ? 'text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {label}
                {previewTab === id && (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
                )}
              </button>
            ))}
            {previewTab === 'image' && (
              <div className="my-auto ml-2 flex gap-1 rounded-md bg-surface-2 p-0.5">
                {(
                  [
                    ['cards', 'Cartões resumidos'],
                    ['full', 'Relatório completo'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={layout === id}
                    onClick={() => setLayout(id)}
                    className={cn(
                      'h-6 rounded px-2 text-xs transition-colors',
                      layout === id ? 'bg-elevated text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex-1" />
            {rendering && <LoaderCircle className="my-auto size-3.5 animate-spin text-fg-subtle" />}
          </div>

          {empty ? (
            <p className="flex-1 px-4 py-6 text-center text-xs text-fg-subtle">
              Marque ao menos um envio na aba Envios para montar o relatório.
            </p>
          ) : previewTab === 'markdown' ? (
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-relaxed text-fg">
              {markdown}
            </pre>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto bg-surface px-4 py-3">
              {image && image.parts > 1 && (
                <p className="mb-2 text-xs text-warning">
                  Ficou longo: ao salvar vira {image.parts} imagens, e não cabe na área de transferência. A
                  prévia mostra a primeira parte. Os cartões resumidos ou menos itens marcados deixam numa
                  imagem só.
                </p>
              )}
              {image?.src && (
                <img
                  src={image.src}
                  alt="Prévia da imagem do relatório"
                  className="mx-auto w-full max-w-[760px] rounded-md border border-border shadow-sm"
                />
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
            {previewTab === 'markdown' ? (
              <>
                <Button onClick={() => void copyMarkdown()} disabled={empty || busy !== null}>
                  <Copy className="size-3.5" /> Copiar Markdown
                </Button>
                <Button onClick={() => void saveFile('md')} disabled={empty || busy !== null}>
                  {busy === 'md' ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <FileDown className="size-3.5" />
                  )}
                  Salvar .md
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void saveFile('pdf')}
                  disabled={empty || busy !== null}
                >
                  {busy === 'pdf' ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <FileDown className="size-3.5" />
                  )}
                  Salvar PDF
                </Button>
              </>
            ) : (
              <>
                <Button onClick={() => void saveImage()} disabled={empty || busy !== null}>
                  {busy === 'save-image' ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <FileDown className="size-3.5" />
                  )}
                  Salvar PNG
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void copyImage()}
                  disabled={empty || busy !== null || (image?.parts ?? 1) > 1}
                >
                  {busy === 'copy-image' ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Image className="size-3.5" />
                  )}
                  Copiar imagem
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function SendsPanel({
  items,
  selected,
  stepNames,
  onToggle,
  onRename,
  onAddPrevious,
  onClear,
}: {
  items: HistorySummary[] | null;
  selected: string[];
  stepNames: Record<string, string>;
  onToggle: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onAddPrevious: () => void;
  onClear: () => void;
}) {
  return (
    <div className="pb-2">
      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-2.5">
        <p className="text-2xs text-fg-subtle">Os marcados entram na ordem em que foram enviados.</p>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" onClick={onAddPrevious} disabled={!items?.length}>
            + anterior
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear} disabled={selected.length === 0}>
            Limpar
          </Button>
        </div>
      </div>
      <ul className="px-2">
        {items === null && <li className="px-2 py-6 text-center text-xs text-fg-subtle">Carregando…</li>}
        {items?.length === 0 && (
          <li className="px-2 py-6 text-center text-xs text-fg-subtle">
            Nenhum envio no histórico ainda. Envie as requisições e volte aqui.
          </li>
        )}
        {items?.map((item) => (
          <HistoryOption
            key={item.id}
            item={item}
            checked={selected.includes(item.id)}
            customName={stepNames[item.id] ?? ''}
            onToggle={() => onToggle(item.id)}
            onRename={(name) => onRename(item.id, name)}
          />
        ))}
      </ul>
    </div>
  );
}

function HistoryOption({
  item,
  checked,
  customName,
  onToggle,
  onRename,
}: {
  item: HistorySummary;
  checked: boolean;
  customName: string;
  onToggle: () => void;
  onRename: (name: string) => void;
}) {
  const tone = item.status !== null ? statusTone(item.status) : 'danger';
  const when = new Date(item.at).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return (
    <li className={cn('rounded-md', checked && 'bg-primary-soft')}>
      <div
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={activateOnKey(onToggle)}
        title={`${item.method} ${item.url}`}
        className={cn(
          'flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors',
          !checked && 'hover:bg-surface-2',
        )}
      >
        <CheckMark checked={checked} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <MethodBadge method={item.method} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{item.name}</span>
            {item.source === 'mcp' && (
              <Bot className="size-3 shrink-0 text-fg-subtle" aria-label="Enviada pelo Claude" />
            )}
            <span
              className={cn(
                'shrink-0 font-mono text-2xs font-semibold',
                tone === 'success' && 'text-success',
                tone === 'warning' && 'text-warning',
                tone === 'danger' && 'text-danger',
                tone === 'muted' && 'text-fg-muted',
              )}
            >
              {item.status ?? 'erro'}
            </span>
          </p>
          <p className="flex gap-2 text-2xs text-fg-subtle">
            <span className="shrink-0">{when}</span>
            <span className="min-w-0 truncate font-mono">{item.url}</span>
          </p>
        </div>
      </div>
      {checked && (
        <div className="pb-2 pl-[34px] pr-2">
          <TextInput
            value={customName}
            onChange={(e) => onRename(e.target.value)}
            placeholder={`Nome no relatório: ${item.name}`}
            aria-label={`Nome de "${item.name}" no relatório`}
            className="h-7 text-xs"
          />
        </div>
      )}
    </li>
  );
}
