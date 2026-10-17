import {
  type CaptureScope,
  captureLine,
  collectionOf,
  formatJsonPath,
  type JsonPath,
  suggestVariableName,
  upsertCaptureLine,
  type VariableInput,
  type VariableView,
} from '@rota/core/shared';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { WorkspaceCommand } from '../../../../shared/ipc';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Checkbox, Field, Select, TextInput } from '../../components/form';
import { runCommand } from '../../lib/api';
import { saveTab } from '../../state/actions';
import { isDirty, type RequestTab, useTabs } from '../../state/tabs';
import { toast } from '../../state/toasts';
import { useActiveEnvironmentId, useSnapshot } from '../../state/workspace';

interface Target {
  tabId: string;
  path: JsonPath;
  value: unknown;
}

const useSaveToVariable = create<{ target: Target | null; set(target: Target | null): void }>()((set) => ({
  target: null,
  set: (target) => set({ target }),
}));

export function openSaveToVariable(target: Target): void {
  useSaveToVariable.getState().set(target);
}

const SENSITIVE = /token|secret|segredo|senha|password|passwd|api[-_]?key|auth|cookie|session/i;
const VALID_NAME = /^[\w.-]+$/;

/** Texto gravado na variável: objetos e listas viram JSON. */
export function variableText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

function upsertVariable(
  list: readonly VariableView[],
  key: string,
  value: string,
  secret: boolean,
): VariableInput[] {
  const inputs: VariableInput[] = list.map((v) => ({
    key: v.key,
    type: v.type,
    enabled: v.enabled,
    description: v.description,
    // Segredos sem `value` mantêm o valor salvo.
    value: v.type === 'secret' ? undefined : (v.value ?? ''),
  }));
  const existing = inputs.find((v) => v.key === key);
  const type = secret || existing?.type === 'secret' ? 'secret' : 'default';
  if (existing) Object.assign(existing, { value, type, enabled: true });
  else inputs.push({ key, type, enabled: true, value });
  return inputs;
}

/**
 * Guarda um campo da resposta numa variável: grava o valor agora e, se
 * marcado, inclui no script pós-resposta a linha que atualiza a cada envio.
 */
export function SaveToVariableDialog() {
  const target = useSaveToVariable((s) => s.target);
  const close = () => useSaveToVariable.getState().set(null);
  const tab = useTabs((s) =>
    s.tabs.find((t): t is RequestTab => t.id === target?.tabId && t.kind === 'request'),
  );
  const snapshot = useSnapshot();
  const envId = useActiveEnvironmentId();
  const env = snapshot.environments.find((e) => e.id === envId);
  const contextId = tab?.itemId ?? tab?.parentId;
  const collection = contextId ? collectionOf(snapshot, contextId) : undefined;

  const scopes: { value: CaptureScope; label: string }[] = [
    ...(env ? [{ value: 'environment' as const, label: `Ambiente: ${env.name}` }] : []),
    ...(collection ? [{ value: 'collection' as const, label: `Coleção: ${collection.name}` }] : []),
    { value: 'globals', label: 'Globais' },
  ];

  const [name, setName] = useState('');
  const [scope, setScope] = useState<CaptureScope>('globals');
  const [auto, setAuto] = useState(true);
  const [secret, setSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  // Valores iniciais a cada abertura.
  // biome-ignore lint/correctness/useExhaustiveDependencies: só quando muda o campo escolhido
  useEffect(() => {
    if (!target) return;
    const suggested = suggestVariableName(target.path);
    setName(suggested);
    setScope(scopes[0]?.value ?? 'globals');
    setAuto(true);
    setSecret(SENSITIVE.test(suggested) || SENSITIVE.test(formatJsonPath(target.path)));
  }, [target]);

  if (!target) return null;
  const trimmed = name.trim();
  const nameError =
    trimmed === '' ? 'Informe um nome.' : VALID_NAME.test(trimmed) ? null : 'Use letras, números, _ . ou -';
  const line = captureLine(scope, trimmed || 'nome', target.path);
  const preview = variableText(target.value);

  async function save() {
    if (!target || !tab || nameError) return;
    setSaving(true);
    try {
      const value = variableText(target.value);
      let command: WorkspaceCommand;
      if (scope === 'environment' && env)
        command = {
          type: 'updateEnvironment',
          id: env.id,
          variables: upsertVariable(env.variables, trimmed, value, secret),
        };
      else if (scope === 'collection' && collection)
        command = {
          type: 'updateCollection',
          id: collection.id,
          variables: upsertVariable(collection.variables, trimmed, value, secret),
        };
      else
        command = {
          type: 'updateGlobals',
          variables: upsertVariable(snapshot.globals, trimmed, value, secret),
        };
      if (!(await runCommand(command))) return;

      let note = '';
      if (auto) {
        const wasDirty = isDirty(tab);
        const postResponse = upsertCaptureLine(
          tab.draft.scripts.postResponse,
          trimmed,
          captureLine(scope, trimmed, target.path),
        );
        useTabs.getState().update<RequestTab>(tab.id, (t) => ({
          ...t,
          draft: { ...t.draft, scripts: { ...t.draft.scripts, postResponse } },
        }));
        // Sem outras alterações pendentes, já salva; senão fica junto das alterações para o Ctrl+S.
        if (!wasDirty && tab.itemId) {
          await saveTab(tab.id);
          note = ' A cada envio o valor é atualizado (Scripts › Pós-resposta).';
        } else {
          note = ' A linha que atualiza a cada envio foi para Scripts › Pós-resposta; salve a requisição.';
        }
      }
      const where = scopes.find((s) => s.value === scope)?.label ?? scope;
      toast.success(`{{${trimmed}}} salva em ${where}.${note}`);
      close();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title="Salvar em variável"
      className="w-[min(520px,calc(100vw-32px))]"
    >
      <form
        className="space-y-4 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="rounded-md border border-border bg-surface px-3 py-2">
          <p className="truncate font-mono text-xs text-fg-muted">{formatJsonPath(target.path)}</p>
          <p className="mt-0.5 line-clamp-2 break-all font-mono text-xs text-fg">
            {preview === '' ? '(vazio)' : preview.length > 300 ? `${preview.slice(0, 300)}…` : preview}
          </p>
        </div>

        <Field label="Nome da variável" hint={nameError ?? `Use como {{${trimmed}}} em qualquer campo.`}>
          <TextInput
            mono
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
        </Field>

        <Field label="Onde salvar">
          <Select value={scope} options={scopes} onChange={setScope} triggerClassName="h-8 w-full" />
        </Field>

        <div className="space-y-2.5">
          <OptionRow checked={auto} onChange={setAuto} label="Atualizar a cada envio">
            Inclui no script pós-resposta:
            <code className="mt-1 block break-all rounded bg-bg px-2 py-1 font-mono text-2xs text-fg-muted">
              {line}
            </code>
          </OptionRow>
          <OptionRow checked={secret} onChange={setSecret} label="Variável secreta">
            O valor fica cifrado neste computador, nunca nos arquivos do projeto.
          </OptionRow>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={close}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={Boolean(nameError) || saving}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function OptionRow({
  checked,
  onChange,
  label,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox checked={checked} onChange={onChange} label={label} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => onChange(!checked)} className="text-left text-[13px] text-fg">
          {label}
        </button>
        <div className="text-xs text-fg-subtle">{children}</div>
      </div>
    </div>
  );
}
