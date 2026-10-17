import { SECRET_MASK, type VariableTarget } from '@rota/core/shared';
import { Eye, EyeOff, Lock, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Checkbox, Select } from '../../components/form';
import { Tooltip } from '../../components/Tooltip';
import { VariableInput } from '../../components/VariableInput';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { toast } from '../../state/toasts';
import { emptyDraft, type VariableDraft } from '../../state/variable-drafts';

interface VariablesEditorProps {
  drafts: VariableDraft[];
  onChange: (drafts: VariableDraft[]) => void;
  /** Onde os segredos estão guardados (para o botão "revelar"). */
  target: VariableTarget;
}

const GRID = 'grid grid-cols-[32px_minmax(0,1fr)_minmax(0,1.5fr)_112px_minmax(0,0.9fr)_36px] items-center';

/** Tabela de variáveis com suporte a variáveis secretas. */
export function VariablesEditor({ drafts, onChange, target }: VariablesEditorProps) {
  // Sempre há uma linha vazia no final para adicionar.
  const rows =
    drafts.length === 0 || !isEmpty(drafts[drafts.length - 1]) ? [...drafts, emptyDraft()] : drafts;

  const update = (uid: string, patch: Partial<VariableDraft>) => {
    const next = rows.map((d) => (d.uid === uid ? { ...d, ...patch } : d));
    const last = next[next.length - 1];
    onChange(last && !isEmpty(last) ? [...next, emptyDraft()] : next);
  };
  const remove = (uid: string) => onChange(rows.filter((d) => d.uid !== uid));

  const keys = rows.map((d) => d.key.trim()).filter(Boolean);
  const duplicates = new Set(keys.filter((k, i) => keys.indexOf(k) !== i));

  return (
    <div className="overflow-hidden rounded-lg border border-border text-xs">
      <div
        className={cn(
          GRID,
          'h-8 border-b border-border bg-surface text-2xs font-medium uppercase tracking-wider text-fg-subtle',
        )}
      >
        <div />
        <div className="px-2">Variável</div>
        <div className="px-2">Valor</div>
        <div className="px-2">Tipo</div>
        <div className="px-2">Descrição</div>
        <div />
      </div>
      {rows.map((d, index) => {
        const last = index === rows.length - 1 && isEmpty(d);
        return (
          <div
            key={d.uid}
            className={cn(
              GRID,
              'group border-b border-border last:border-b-0 hover:bg-surface/60',
              !d.enabled && !last && 'opacity-55',
            )}
          >
            <div className="flex justify-center">
              {!last && (
                <Checkbox
                  checked={d.enabled}
                  label="Habilitada"
                  onChange={(enabled) => update(d.uid, { enabled })}
                />
              )}
            </div>
            <div className="flex min-w-0 items-center border-l border-border">
              <input
                value={d.key}
                onChange={(e) => update(d.uid, { key: e.target.value })}
                placeholder={last ? 'Adicionar variável' : 'nome'}
                spellCheck={false}
                className={cn(
                  'h-8 w-full bg-transparent px-2 font-mono text-xs outline-none placeholder:font-sans placeholder:text-fg-subtle',
                  duplicates.has(d.key.trim()) ? 'text-danger' : 'text-fg',
                )}
                title={duplicates.has(d.key.trim()) ? 'Nome repetido: só a última definição vale' : undefined}
              />
            </div>
            <div className="flex min-w-0 items-center border-l border-border">
              {d.type === 'secret' ? (
                <SecretValue draft={d} target={target} onChange={(patch) => update(d.uid, patch)} />
              ) : (
                <VariableInput
                  size="sm"
                  value={d.value ?? ''}
                  onChange={(value) => update(d.uid, { value })}
                  placeholder="valor"
                />
              )}
            </div>
            <div className="border-l border-border">
              {!last && (
                <Select
                  value={d.type}
                  options={[
                    { value: 'default', label: 'Padrão' },
                    { value: 'secret', label: 'Secreta' },
                  ]}
                  onChange={(type) =>
                    update(d.uid, {
                      type,
                      // Ao virar secreta com um valor digitado, ele precisa ir para o cofre.
                      secretDirty: type === 'secret' && (d.value ?? '') !== '',
                    })
                  }
                  triggerClassName="h-8 w-full rounded-none border-0 bg-transparent"
                />
              )}
            </div>
            <div className="flex min-w-0 items-center border-l border-border">
              <input
                value={d.description}
                onChange={(e) => update(d.uid, { description: e.target.value })}
                placeholder={last ? '' : 'Descrição'}
                className="h-8 w-full bg-transparent px-2 text-xs text-fg-muted outline-none placeholder:text-fg-subtle/70"
              />
            </div>
            <div className="flex justify-center">
              {!last && (
                <button
                  type="button"
                  aria-label={`Remover ${d.key}`}
                  onClick={() => remove(d.uid)}
                  className="flex size-6 items-center justify-center rounded text-fg-subtle opacity-0 transition-opacity hover:bg-surface-2 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function isEmpty(d: VariableDraft | undefined): boolean {
  return !!d && d.key === '' && (d.value ?? '') === '' && d.description === '' && d.originalKey === null;
}

function SecretValue({
  draft,
  target,
  onChange,
}: {
  draft: VariableDraft;
  target: VariableTarget;
  onChange: (patch: Partial<VariableDraft>) => void;
}) {
  const [visible, setVisible] = useState(false);
  const loaded = draft.value !== undefined;

  async function toggle() {
    if (visible) {
      setVisible(false);
      return;
    }
    if (!loaded && draft.hasValue && draft.originalKey) {
      try {
        const value = await api.invoke('secrets:reveal', target, draft.originalKey);
        onChange({ value: value ?? '' });
      } catch (error) {
        toast.error(errorMessage(error));
        return;
      }
    }
    setVisible(true);
  }

  return (
    <div className="flex h-8 w-full min-w-0 items-center">
      <Lock className="ml-2 size-3 shrink-0 text-fg-subtle" />
      <input
        type={visible ? 'text' : 'password'}
        value={draft.value ?? ''}
        onChange={(e) => onChange({ value: e.target.value, secretDirty: true })}
        placeholder={draft.hasValue ? SECRET_MASK : 'sem valor'}
        spellCheck={false}
        autoComplete="off"
        className="h-8 min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-fg outline-none placeholder:text-fg-subtle"
      />
      <Tooltip label={visible ? 'Ocultar' : 'Revelar valor'}>
        <button
          type="button"
          aria-label={visible ? 'Ocultar valor' : 'Revelar valor'}
          onClick={() => void toggle()}
          className="mr-1 flex size-6 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-surface-2 hover:text-fg"
        >
          {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </Tooltip>
    </div>
  );
}
