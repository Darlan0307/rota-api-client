import type { ImportCounts, ImportPreview, ImportReport, ImportResultItem } from '@rota/core/shared';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileCode2,
  FileJson,
  Globe,
  Layers,
  Library,
  LoaderCircle,
  Lock,
  Upload,
  XCircle,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { create } from 'zustand';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Checkbox } from '../../components/form';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useTabs } from '../../state/tabs';
import { toast } from '../../state/toasts';
import { useUiStore } from '../../state/ui';
import { useWorkspace } from '../../state/workspace';

type Step = 'select' | 'preview' | 'importing' | 'report';

interface ImportState {
  open: boolean;
  step: Step;
  previews: ImportPreview[];
  /** Por arquivo: chaves marcadas para virar secretas. */
  secretKeys: Record<string, string[]>;
  report: ImportReport | null;
  show(): void;
  close(): void;
}

export const useImport = create<ImportState>()((set) => ({
  open: false,
  step: 'select',
  previews: [],
  secretKeys: {},
  report: null,
  show: () => set({ open: true, step: 'select', previews: [], secretKeys: {}, report: null }),
  close: () => set({ open: false }),
}));

export function openImportDialog(): void {
  useImport.getState().show();
}

const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;

async function addFiles(paths: string[]) {
  if (paths.length === 0) return;
  const state = useImport.getState();
  const known = new Set(state.previews.map((p) => p.fileName));
  const fresh = paths.filter((p) => !known.has(p));
  try {
    const previews = await api.invoke('import:preview', fresh);
    const secretKeys = { ...state.secretKeys };
    // Sugestão: variáveis com nome de segredo já vêm marcadas.
    for (const p of previews) secretKeys[p.fileName] = [...p.sensitiveKeys];
    useImport.setState({ previews: [...state.previews, ...previews], secretKeys, step: 'preview' });
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

export function ImportDialog() {
  const { open, step, close } = useImport();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && step !== 'importing' && close()}
      title="Importar (Postman ou OpenAPI)"
      className="max-h-[86vh] w-[min(720px,94vw)]"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {step === 'select' && <SelectStep />}
        {step === 'preview' && <PreviewStep />}
        {step === 'importing' && (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-[13px] text-fg-muted">
            <LoaderCircle className="size-6 animate-spin text-primary" />
            Importando…
          </div>
        )}
        {step === 'report' && <ReportStep />}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function DropZone({ compact = false }: { compact?: boolean }) {
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => addFiles(await api.invoke('import:pickFiles'))}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void addFiles([...e.dataTransfer.files].map((f) => api.pathForFile(f)));
      }}
      className={cn(
        'flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-center transition-colors',
        compact ? 'p-4' : 'p-10',
        over ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong hover:bg-surface',
      )}
    >
      <Upload className={cn('text-fg-subtle', compact ? 'size-4' : 'size-7')} strokeWidth={1.5} />
      <span className="text-[13px] text-fg">
        {compact
          ? 'Adicionar mais arquivos'
          : 'Arraste os arquivos .json/.yaml aqui ou clique para selecionar'}
      </span>
      {!compact && (
        <span className="text-xs text-fg-muted">
          Postman (coleções v2.1, ambientes e globais) ou OpenAPI 3 / Swagger 2.0
        </span>
      )}
    </button>
  );
}

function SelectStep() {
  return (
    <div className="space-y-5 overflow-auto p-5">
      <DropZone />
      <div className="rounded-lg bg-surface p-4 text-xs leading-relaxed text-fg-muted">
        <p className="mb-1.5 font-medium text-fg">Como exportar do Postman</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            <span className="text-fg">Coleção:</span> clique nos "…" da coleção → Export → Collection v2.1.
          </li>
          <li>
            <span className="text-fg">Ambiente:</span> em Environments, "…" do ambiente → Export.
          </li>
          <li>
            <span className="text-fg">Globais:</span> em Environments → Globals → Export.
          </li>
        </ul>
        <p className="mb-1.5 mt-3 font-medium text-fg">OpenAPI / Swagger</p>
        <p>
          Cada tag vira uma pasta; a URL base vai para a variável <code className="font-mono">baseUrl</code>,
          parâmetros de caminho viram variáveis da coleção e as respostas documentadas viram exemplos (base
          para a verificação de contrato).
        </p>
        <p className="mt-2">
          Pastas, autenticação, variáveis, scripts e exemplos são preservados. O que não for suportado aparece
          no relatório ao final.
        </p>
      </div>
    </div>
  );
}

const UNKNOWN_KIND = { label: 'Desconhecido', icon: FileJson };
const kindInfo = (kind: string) => KIND[kind] ?? UNKNOWN_KIND;

const KIND: Record<string, { label: string; icon: typeof Library }> = {
  collection: { label: 'Coleção', icon: Library },
  environment: { label: 'Ambiente', icon: Layers },
  globals: { label: 'Variáveis globais', icon: Globe },
  openapi: { label: 'OpenAPI', icon: FileCode2 },
  unknown: { label: 'Desconhecido', icon: FileJson },
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function countsText(kind: string, c: ImportCounts): string {
  if (kind === 'collection' || kind === 'openapi') {
    return [
      plural(c.requests, 'requisição', 'requisições'),
      c.folders ? plural(c.folders, 'pasta', 'pastas') : null,
      c.examples ? plural(c.examples, 'exemplo', 'exemplos') : null,
      c.variables ? plural(c.variables, 'variável', 'variáveis') : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  return `${plural(c.variables, 'variável', 'variáveis')}${c.secrets ? ` (${plural(c.secrets, 'secreta', 'secretas')})` : ''}`;
}

function PreviewStep() {
  const { previews, secretKeys } = useImport();
  const valid = previews.filter((p) => !p.error);

  function toggleSecret(file: string, key: string, checked: boolean) {
    const current = useImport.getState().secretKeys[file] ?? [];
    useImport.setState({
      secretKeys: {
        ...useImport.getState().secretKeys,
        [file]: checked ? [...current, key] : current.filter((k) => k !== key),
      },
    });
  }

  async function run() {
    useImport.setState({ step: 'importing' });
    try {
      const report = await api.invoke(
        'import:run',
        valid.map((p) => p.fileName),
        secretKeys,
      );
      useImport.setState({ report, step: 'report' });
    } catch (error) {
      toast.error(errorMessage(error));
      useImport.setState({ step: 'preview' });
    }
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-5">
        {previews.map((p) => {
          const { icon: Icon, label } = kindInfo(p.kind);
          return (
            <div
              key={p.fileName}
              className={cn(
                'rounded-lg border p-3',
                p.error ? 'border-danger/40 bg-danger/5' : 'border-border',
              )}
            >
              <div className="flex items-start gap-3">
                <Icon
                  className={cn('mt-0.5 size-4 shrink-0', p.error ? 'text-danger' : 'text-primary')}
                  strokeWidth={1.75}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-fg">{p.name}</p>
                  <p className="truncate text-xs text-fg-subtle" title={p.fileName}>
                    {label}
                    {p.version ? ` v${p.version}` : ''} · {basename(p.fileName)}
                  </p>
                  {p.error ? (
                    <p className="mt-1 text-xs text-danger">{p.error}</p>
                  ) : (
                    <p className="mt-1 text-xs text-fg-muted">{countsText(p.kind, p.counts)}</p>
                  )}
                </div>
                <button
                  type="button"
                  className="text-xs text-fg-subtle hover:text-fg"
                  onClick={() => useImport.setState({ previews: previews.filter((x) => x !== p) })}
                >
                  Remover
                </button>
              </div>

              {p.sensitiveKeys.length > 0 && (
                <div className="mt-3 rounded-md bg-surface p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
                    <Lock className="size-3.5 text-warning" /> Estas variáveis parecem segredos
                  </p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    Marcadas viram <span className="text-fg">secretas</span>: o valor fica cifrado só nesta
                    máquina e não vai para os arquivos versionados.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                    {p.sensitiveKeys.map((key) => {
                      const checked = (secretKeys[p.fileName] ?? []).includes(key);
                      return (
                        <span key={key} className="flex items-center gap-1.5 font-mono text-xs text-fg">
                          <Checkbox
                            checked={checked}
                            label={key}
                            onChange={(c) => toggleSecret(p.fileName, key, c)}
                          />
                          {key}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <DropZone compact />
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border p-4">
        <Button onClick={() => useImport.getState().close()}>Cancelar</Button>
        <Button variant="primary" disabled={valid.length === 0} onClick={() => void run()}>
          Importar {valid.length > 1 ? `${valid.length} arquivos` : ''}
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function ReportStep() {
  const report = useImport((s) => s.report);
  if (!report) return null;
  const ok = report.items.filter((i) => !i.error);
  const warnings = report.items.reduce((n, i) => n + i.warnings.length, 0);

  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-5">
        <div className="flex items-center gap-2 text-[13px]">
          <CheckCircle2 className="size-4 text-success" />
          <span className="text-fg">
            {ok.length} de {report.items.length}{' '}
            {report.items.length === 1 ? 'arquivo importado' : 'arquivos importados'}
          </span>
          {warnings > 0 && (
            <span className="text-fg-muted">
              · {warnings} {warnings === 1 ? 'observação' : 'observações'}
            </span>
          )}
        </div>
        {report.items.map((item) => (
          <ReportItem key={item.fileName} item={item} />
        ))}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border p-4">
        <Button variant="primary" onClick={() => useImport.getState().close()}>
          Concluir
        </Button>
      </div>
    </>
  );
}

function ReportItem({ item }: { item: ImportResultItem }) {
  const [open, setOpen] = useState(item.warnings.length > 0 && item.warnings.length <= 8);
  const { icon: Icon, label } = kindInfo(item.kind);

  function openItem() {
    const snapshot = useWorkspace.getState().state?.snapshot;
    if (!snapshot || !item.id) return;
    if (item.kind === 'collection' || item.kind === 'openapi') {
      useUiStore.getState().showSection('collections');
      useUiStore.getState().setExpanded(item.id, true);
      useTabs.getState().openItem('collection', item.id, snapshot);
    } else if (item.kind === 'environment') {
      useUiStore.getState().showSection('environments');
      useTabs.getState().openItem('environment', item.id, snapshot);
    } else if (item.kind === 'globals') {
      useTabs.getState().openGlobals(snapshot);
    }
    useImport.getState().close();
  }

  return (
    <div className={cn('rounded-lg border', item.error ? 'border-danger/40' : 'border-border')}>
      <div className="flex items-center gap-3 p-3">
        {item.error ? (
          <XCircle className="size-4 shrink-0 text-danger" />
        ) : (
          <Icon className="size-4 shrink-0 text-success" strokeWidth={1.75} />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{item.name}</p>
          <p className="text-xs text-fg-muted">
            {item.error ? (
              <span className="text-danger">{item.error}</span>
            ) : (
              `${label} · ${countsText(item.kind, item.counts)}`
            )}
          </p>
        </div>
        {!item.error && (
          <Button size="sm" onClick={openItem}>
            Abrir
          </Button>
        )}
      </div>
      {item.warnings.length > 0 && (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-warning hover:bg-surface"
          >
            <AlertTriangle className="size-3.5" />
            {item.warnings.length}{' '}
            {item.warnings.length === 1
              ? 'item não importado ou adaptado'
              : 'itens não importados ou adaptados'}
            <ChevronDown className={cn('ml-auto size-3.5 transition-transform', open && 'rotate-180')} />
          </button>
          {open && (
            <ul className="space-y-1.5 px-3 pb-3 text-xs">
              {item.warnings.map((w, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lista estática do relatório
                <li key={i} className="rounded-md bg-surface px-2.5 py-1.5">
                  <Path path={w.path} />
                  <p className="mt-0.5 text-fg">{w.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Path({ path }: { path: string }): ReactNode {
  return <p className="truncate font-mono text-2xs text-fg-subtle">{path}</p>;
}
