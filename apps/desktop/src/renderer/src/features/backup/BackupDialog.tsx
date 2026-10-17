import { AlertTriangle, Archive } from 'lucide-react';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Checkbox } from '../../components/form';
import { api, errorMessage } from '../../lib/api';
import { toast } from '../../state/toasts';
import { useSnapshot } from '../../state/workspace';

const useBackupDialog = create<{ open: boolean; set(open: boolean): void }>()((set) => ({
  open: false,
  set: (open) => set({ open }),
}));

export function openBackupDialog(): void {
  useBackupDialog.getState().set(true);
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Exportar tudo: coleções, ambientes e globais no formato do Postman, numa pasta. */
export function BackupDialog() {
  const open = useBackupDialog((s) => s.open);
  const setOpen = useBackupDialog((s) => s.set);
  const snapshot = useSnapshot();
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [busy, setBusy] = useState(false);

  // Sempre começa sem segredos (escolha consciente a cada backup).
  useEffect(() => {
    if (open) setIncludeSecrets(false);
  }, [open]);

  const secrets =
    snapshot.globals.filter((v) => v.type === 'secret').length +
    snapshot.environments.reduce((n, e) => n + e.variables.filter((v) => v.type === 'secret').length, 0) +
    snapshot.collections.reduce((n, c) => n + c.variables.filter((v) => v.type === 'secret').length, 0);

  async function run() {
    setBusy(true);
    try {
      const result = await api.invoke('export:all', includeSecrets);
      if (!result) return;
      setOpen(false);
      toast.success(
        `Backup salvo em ${result.folder}: ${plural(result.collections, 'coleção', 'coleções')} e ${plural(result.environments, 'ambiente', 'ambientes')}${
          includeSecrets ? `, com ${plural(result.secretsIncluded, 'segredo', 'segredos')}` : ''
        }.`,
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Exportar tudo (backup)"
      className="w-[min(520px,calc(100vw-32px))]"
    >
      <div className="space-y-4 px-5 py-4">
        <p className="text-[13px] leading-relaxed text-fg-muted">
          Salva {plural(snapshot.collections.length, 'coleção', 'coleções')},{' '}
          {plural(snapshot.environments.length, 'ambiente', 'ambientes')} e as variáveis globais numa pasta
          nova, no formato do Postman (v2.1). Dá para importar de volta no Rota ou no Postman, e um LEIA-ME
          explica como.
        </p>

        <div className="flex items-start gap-2.5">
          <Checkbox
            checked={includeSecrets}
            onChange={setIncludeSecrets}
            label="Incluir valores secretos"
            className="mt-0.5"
          />
          <div className="min-w-0 text-xs">
            <button
              type="button"
              onClick={() => setIncludeSecrets((v) => !v)}
              className="text-left text-[13px] text-fg"
            >
              Incluir valores secretos (tokens, senhas)
            </button>
            <p className="mt-0.5 leading-relaxed text-fg-subtle">
              {secrets === 0
                ? 'Você não tem variáveis secretas.'
                : `Você tem ${plural(secrets, 'variável secreta', 'variáveis secretas')}. Sem esta opção elas vão vazias: os valores ficam só neste PC, cifrados, e se perdem se o Windows for reinstalado.`}
            </p>
          </div>
        </div>

        {includeSecrets && (
          <div className="flex gap-2.5 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-relaxed text-fg">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>
              Os valores secretos ficam em <b>texto puro</b> nos arquivos. Guarde a pasta em local seguro
              (pendrive, cofre de senhas, nuvem pessoal) e <b>não envie para o Git</b> nem para outras
              pessoas.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="primary" disabled={busy} onClick={() => void run()}>
            <Archive className="size-3.5" /> Escolher pasta e exportar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
