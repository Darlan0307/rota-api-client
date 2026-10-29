import { DEFAULT_EVIDENCE_OPTIONS, type EvidenceOptions, type HistorySummary } from '@rota/core/shared';
import { Bot, Check, Copy, FileDown, FileText, LoaderCircle } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { MenuEntry } from '../../components/ActionMenu';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextArea, TextInput } from '../../components/form';
import { MethodBadge } from '../../components/MethodBadge';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { statusTone } from '../../lib/format';
import type { RequestTab } from '../../state/tabs';
import { toast } from '../../state/toasts';
import { useActiveEnvironmentId, useSnapshot } from '../../state/workspace';

/**
 * Relatório de evidências: o usuário marca envios do histórico (ex.: login e
 * a consulta que falhou), escreve o que aconteceu e leva tudo em Markdown ou
 * PDF para um colega ou o suporte da API.
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
const OPTIONS_KEY = 'rota:evidence-options';
type Toggles = Pick<
  EvidenceOptions,
  'requestHeaders' | 'responseHeaders' | 'tests' | 'curl' | 'maskSensitive'
>;

function loadToggles(): Toggles {
  const defaults: Toggles = {
    requestHeaders: DEFAULT_EVIDENCE_OPTIONS.requestHeaders,
    responseHeaders: DEFAULT_EVIDENCE_OPTIONS.responseHeaders,
    tests: DEFAULT_EVIDENCE_OPTIONS.tests,
    curl: DEFAULT_EVIDENCE_OPTIONS.curl,
    maskSensitive: DEFAULT_EVIDENCE_OPTIONS.maskSensitive,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') as Partial<Toggles>;
    for (const key of Object.keys(defaults) as (keyof Toggles)[])
      if (typeof saved[key] === 'boolean') defaults[key] = saved[key];
  } catch {
    // Sem localStorage (ou valor inválido): usa o padrão.
  }
  return defaults;
}

function saveToggles(toggles: Toggles): void {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(toggles));
  } catch {
    // Preferência só desta máquina: perder não tem problema.
  }
}

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
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [environment, setEnvironment] = useState(environmentName);
  const [toggles, setToggles] = useState<Toggles>(loadToggles);
  const [preview, setPreview] = useState('');
  const [rendering, setRendering] = useState(false);
  const [busy, setBusy] = useState<'md' | 'pdf' | null>(null);

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
    if (failed) return `${failed.status === null ? 'Falha' : `Erro ${failed.status}`} em ${failed.name}`;
    if (chosen.length === 1 && chosen[0]) return `Envio de ${chosen[0].name}`;
    return DEFAULT_EVIDENCE_OPTIONS.title;
  }, [chosen]);

  const options: EvidenceOptions = useMemo(
    () => ({
      ...DEFAULT_EVIDENCE_OPTIONS,
      ...toggles,
      title: title.trim() || suggestedTitle,
      notes,
      environment,
    }),
    [toggles, title, suggestedTitle, notes, environment],
  );

  useEffect(() => {
    if (selected.length === 0) {
      setPreview('');
      return;
    }
    let alive = true;
    setRendering(true);
    const timer = setTimeout(() => {
      api
        .invoke('evidence:render', selected, options)
        .then((markdown) => alive && setPreview(markdown))
        .catch(
          (error: unknown) =>
            alive && setPreview(`Não foi possível montar o relatório: ${errorMessage(error)}`),
        )
        .finally(() => alive && setRendering(false));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [selected, options]);

  function setToggle(key: keyof Toggles, value: boolean) {
    const next = { ...toggles, [key]: value };
    setToggles(next);
    saveToggles(next);
  }

  function toggleItem(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  /** Marca também os envios feitos logo antes do primeiro marcado (o login, por exemplo). */
  function addPrevious(count: number) {
    if (!items) return;
    const indexes = selected.map((id) => items.findIndex((i) => i.id === id)).filter((i) => i >= 0);
    const oldest = indexes.length > 0 ? Math.max(...indexes) : -1;
    const extra = items.slice(oldest + 1, oldest + 1 + count).map((i) => i.id);
    setSelected((current) => [...new Set([...current, ...extra])]);
  }

  async function copy() {
    if (!preview) return;
    await navigator.clipboard.writeText(preview);
    toast.success('Relatório copiado em Markdown.');
  }

  async function save(format: 'md' | 'pdf') {
    setBusy(format);
    try {
      const path = await api.invoke('evidence:save', selected, options, format);
      if (path) toast.success(`Relatório salvo em ${path}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const empty = selected.length === 0;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title="Relatório de evidências"
      className="h-[min(860px,90vh)] w-[min(1180px,96vw)]"
    >
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[400px] shrink-0 flex-col border-r border-border">
          <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
            <p className="text-xs text-fg-muted">
              Envios do histórico <span className="text-fg-subtle">({selected.length} marcados)</span>
            </p>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => addPrevious(1)} disabled={!items?.length}>
                + anterior
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])} disabled={empty}>
                Limpar
              </Button>
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-2">
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
                onToggle={() => toggleItem(item.id)}
              />
            ))}
          </ul>
          <div className="space-y-2.5 border-t border-border px-4 py-3">
            <TextInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={suggestedTitle}
              aria-label="Título"
            />
            <TextArea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="O que aconteceu? O que era esperado e o que veio? (opcional)"
            />
            <TextInput
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              placeholder="Ambiente (ex.: Homologação)"
              aria-label="Ambiente"
            />
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-1">
              <Toggle
                label="Headers enviados"
                checked={toggles.requestHeaders}
                onChange={(v) => setToggle('requestHeaders', v)}
              />
              <Toggle
                label="Headers da resposta"
                checked={toggles.responseHeaders}
                onChange={(v) => setToggle('responseHeaders', v)}
              />
              <Toggle
                label="Testes (pm.test)"
                checked={toggles.tests}
                onChange={(v) => setToggle('tests', v)}
              />
              <Toggle
                label="cURL para reproduzir"
                checked={toggles.curl}
                onChange={(v) => setToggle('curl', v)}
              />
            </div>
            <Toggle
              label="Mascarar tokens, senhas e headers de autenticação"
              hint="Mesmo os que não são variáveis secretas. Variáveis secretas sempre saem como ••••••."
              checked={toggles.maskSensitive}
              onChange={(v) => setToggle('maskSensitive', v)}
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4 text-xs text-fg-muted">
            Prévia (Markdown)
            {rendering && <LoaderCircle className="size-3.5 animate-spin" />}
          </div>
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-relaxed text-fg">
            {empty ? (
              <span className="text-fg-subtle">Marque ao menos um envio para montar o relatório.</span>
            ) : (
              preview
            )}
          </pre>
          <div className="flex items-center gap-2 border-t border-border px-4 py-3">
            <p className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
              Variáveis comuns aparecem com o valor; secretas como ••••••.
            </p>
            <Button onClick={() => void copy()} disabled={empty || !preview}>
              <Copy className="size-3.5" /> Copiar Markdown
            </Button>
            <Button onClick={() => void save('md')} disabled={empty || busy !== null}>
              {busy === 'md' ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <FileDown className="size-3.5" />
              )}
              Salvar .md
            </Button>
            <Button variant="primary" onClick={() => void save('pdf')} disabled={empty || busy !== null}>
              {busy === 'pdf' ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <FileDown className="size-3.5" />
              )}
              Salvar PDF
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function HistoryOption({
  item,
  checked,
  onToggle,
}: {
  item: HistorySummary;
  checked: boolean;
  onToggle: () => void;
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
    <li>
      <div
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={activateOnKey(onToggle)}
        title={`${item.method} ${item.url}`}
        className={cn(
          'flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors',
          checked ? 'bg-primary-soft' : 'hover:bg-surface-2',
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
    </li>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={activateOnKey(() => onChange(!checked))}
      className="flex cursor-pointer items-start gap-2 text-xs text-fg-muted hover:text-fg"
      title={hint}
    >
      <CheckMark checked={checked} className="mt-px" />
      <span>
        {label}
        {hint && <span className="block text-2xs text-fg-subtle">{hint}</span>}
      </span>
    </div>
  );
}

function CheckMark({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
        checked ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong',
        className,
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}

/** Espaço e Enter acionam os itens marcáveis (são div role=checkbox). */
function activateOnKey(action: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    action();
  };
}
