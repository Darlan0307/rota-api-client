import * as Dropdown from '@radix-ui/react-dropdown-menu';
import type { FolderInspection } from '@rota/core/shared';
import { Check, ChevronDown, FolderGit2, FolderOpen, FolderPlus, Home, X } from 'lucide-react';
import { useState } from 'react';
import { create } from 'zustand';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Checkbox } from '../../components/form';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { toast } from '../../state/toasts';
import { useWorkspace } from '../../state/workspace';

/** Pasta escolhida que ainda não é workspace (aguardando confirmação). */
const usePending = create<{ folder: FolderInspection | null; set(f: FolderInspection | null): void }>()(
  (set) => ({
    folder: null,
    set: (folder) => set({ folder }),
  }),
);

async function openWorkspace(path: string | null, prepare?: { gitignore: boolean; readme: boolean }) {
  try {
    await api.invoke('workspace:open', path, prepare);
    toast.success(path ? `Workspace aberto: ${basename(path)}` : 'Workspace padrão aberto.');
  } catch (error) {
    toast.error(`Não foi possível abrir o workspace: ${errorMessage(error)}`);
  }
}

/** Escolhe uma pasta; se ainda não for workspace, pergunta antes de criar. */
export async function openFolderAsWorkspace(): Promise<void> {
  const path = await api.invoke('workspace:pickFolder');
  if (!path) return;
  await openPath(path);
}

async function openPath(path: string) {
  const info = await api.invoke('workspace:inspectFolder', path);
  if (info.isWorkspace) await openWorkspace(path);
  else usePending.getState().set(info);
}

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** Seletor de workspace na barra de título. */
export function WorkspaceMenu() {
  const state = useWorkspace((s) => s.state);
  const [recent, setRecent] = useState<string[]>([]);
  if (!state) return null;
  const root = state.snapshot.root;

  return (
    <Dropdown.Root
      onOpenChange={(open) => {
        if (open) void api.invoke('workspace:recent').then((r) => setRecent(r.recent));
      }}
    >
      <Dropdown.Trigger asChild>
        <button
          type="button"
          className="no-drag flex max-w-72 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg data-[state=open]:bg-surface-2"
          title={root}
        >
          {state.isDefault ? (
            <Home className="size-3.5 shrink-0" strokeWidth={1.75} />
          ) : (
            <FolderGit2 className="size-3.5 shrink-0" strokeWidth={1.75} />
          )}
          <span className="truncate">{state.isDefault ? 'Workspace padrão' : state.snapshot.name}</span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="start"
          sideOffset={6}
          className="z-50 w-80 rounded-lg border border-border bg-elevated p-1 text-[13px] shadow-xl shadow-black/40 animate-pop-in"
        >
          <Dropdown.Item
            onSelect={() => !state.isDefault && void openWorkspace(null)}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-surface-2"
          >
            <Check className={cn('size-3.5 text-primary', !state.isDefault && 'invisible')} />
            <Home className="size-3.5 text-fg-subtle" />
            <span className="flex-1">Workspace padrão</span>
          </Dropdown.Item>
          {recent.length > 0 && (
            <>
              <Dropdown.Label className="px-2 pb-1 pt-2 text-2xs font-medium uppercase tracking-wider text-fg-subtle">
                Recentes
              </Dropdown.Label>
              {recent.map((path) => {
                const current = !state.isDefault && path.toLowerCase() === root.toLowerCase();
                return (
                  <Dropdown.Item
                    key={path}
                    onSelect={() => !current && void openPath(path)}
                    className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-surface-2"
                    title={path}
                  >
                    <Check className={cn('size-3.5 shrink-0 text-primary', !current && 'invisible')} />
                    <FolderGit2 className="size-3.5 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{basename(path)}</span>
                      <span className="block truncate text-2xs text-fg-subtle">{path}</span>
                    </span>
                    {!current && (
                      <button
                        type="button"
                        aria-label="Remover dos recentes"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void api
                            .invoke('workspace:forgetRecent', path)
                            .then(() => setRecent((r) => r.filter((p) => p !== path)));
                        }}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-fg-subtle opacity-0 hover:text-fg group-hover:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </Dropdown.Item>
                );
              })}
            </>
          )}
          <Dropdown.Separator className="my-1 h-px bg-border" />
          <Dropdown.Item
            onSelect={() => void openFolderAsWorkspace()}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 pl-[30px] outline-none data-[highlighted]:bg-surface-2"
          >
            <FolderPlus className="size-3.5 text-fg-subtle" /> Abrir pasta como workspace…
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() => void api.invoke('workspace:revealInExplorer')}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 pl-[30px] outline-none data-[highlighted]:bg-surface-2"
          >
            <FolderOpen className="size-3.5 text-fg-subtle" /> Mostrar no Explorer
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

/** Confirmação para transformar uma pasta em workspace (com .gitignore/README opcionais). */
export function NewWorkspaceDialog() {
  const folder = usePending((s) => s.folder);
  const close = () => usePending.getState().set(null);
  if (!folder) return null;
  return <NewWorkspaceForm key={folder.path} folder={folder} close={close} />;
}

function NewWorkspaceForm({ folder, close }: { folder: FolderInspection; close: () => void }) {
  const [gitignore, setGitignore] = useState(folder.inGitRepo && !folder.ignoresTemp);
  const [readme, setReadme] = useState(folder.isEmpty);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title="Abrir pasta como workspace"
      className="w-[min(560px,92vw)]"
    >
      <div className="space-y-4 p-5 text-[13px]">
        <div className="rounded-lg bg-surface p-3">
          <p className="font-medium text-fg">{folder.name}</p>
          <p className="break-all font-mono text-xs text-fg-muted">{folder.path}</p>
        </div>
        <p className="text-fg-muted">
          Esta pasta ainda não é um workspace. Ao abrir, o app cria{' '}
          <span className="font-mono text-fg">rota.workspace.json</span> e guarda as coleções aqui (um arquivo
          por requisição), prontas para versionar com o projeto.
          {!folder.isEmpty && ' Os arquivos existentes não são alterados.'}
        </p>
        <div className="space-y-2.5">
          <div className="flex items-start gap-2.5">
            <Checkbox checked={gitignore} onChange={setGitignore} label=".gitignore" />
            <span>
              <span className="text-fg">Adicionar os temporários do app ao .gitignore</span>
              <span className="block text-xs text-fg-subtle">
                {folder.inGitRepo
                  ? folder.ignoresTemp
                    ? 'O .gitignore já ignora *.rota-tmp.'
                    : 'Acrescenta "*.rota-tmp" (arquivos que existem só durante uma gravação).'
                  : 'A pasta não está num repositório Git; útil se você for versioná-la depois.'}
              </span>
            </span>
          </div>
          <div className="flex items-start gap-2.5">
            <Checkbox checked={readme} onChange={setReadme} label="README" />
            <span>
              <span className="text-fg">Criar um README.md explicando a pasta</span>
              <span className="block text-xs text-fg-subtle">
                {folder.hasReadme
                  ? 'Já existe um README.md; ele não será alterado.'
                  : 'Ajuda o time a entender o formato.'}
              </span>
            </span>
          </div>
        </div>
        <p className="text-xs text-fg-subtle">
          Valores de variáveis secretas nunca vão para esta pasta: ficam cifrados em %APPDATA%. Histórico e
          lixeira também.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={close}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await openWorkspace(folder.path, { gitignore, readme: readme && !folder.hasReadme });
              setBusy(false);
              close();
            }}
          >
            Criar e abrir workspace
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
