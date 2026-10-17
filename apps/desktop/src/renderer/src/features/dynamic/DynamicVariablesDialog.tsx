import { DYNAMIC_CATEGORY_LABELS, type DynamicCategory, type DynamicVariable } from '@rota/core/shared';
import { Copy, Dices, RefreshCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { IconButton } from '../../components/IconButton';
import { DYNAMIC_SUGGESTIONS } from '../../lib/variables';
import { toast } from '../../state/toasts';

const useDynamicDialog = create<{ open: boolean; set(open: boolean): void }>()((set) => ({
  open: false,
  set: (open) => set({ open }),
}));

export function openDynamicVariables(): void {
  useDynamicDialog.getState().set(true);
}

const REUSE_TIP = 'pm.variables.set("cpf", pm.variables.replaceIn("{{$cpf}}"));';

function copyRef(name: string) {
  void navigator.clipboard.writeText(`{{${name}}}`);
  toast.success(`{{${name}}} copiado. Cole em qualquer campo da requisição.`);
}

/** Lista das variáveis dinâmicas (dados de teste) com exemplos e cópia rápida. */
export function DynamicVariablesDialog() {
  const open = useDynamicDialog((s) => s.open);
  const setOpen = useDynamicDialog((s) => s.set);
  const [query, setQuery] = useState('');
  // Mudar a "semente" gera exemplos novos.
  const [seed, setSeed] = useState(0);

  const groups = useMemo(() => {
    void seed;
    const q = query.trim().toLowerCase();
    const map = new Map<DynamicCategory, { variable: DynamicVariable; example: string }[]>();
    for (const variable of DYNAMIC_SUGGESTIONS) {
      if (q && !`${variable.name} ${variable.description}`.toLowerCase().includes(q)) continue;
      const list = map.get(variable.category) ?? [];
      list.push({ variable, example: variable.generate() });
      map.set(variable.category, list);
    }
    return [...map.entries()];
  }, [query, seed]);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Dados de teste"
      className="w-[min(680px,calc(100vw-32px))]"
    >
      <div className="space-y-3 border-b border-border px-5 py-4">
        <p className="text-[13px] leading-relaxed text-fg-muted">
          Use em qualquer campo (URL, params, headers, body). Cada{' '}
          <code className="font-mono text-primary">{'{{$nome}}'}</code> gera um valor <b>novo a cada envio</b>
          . Ao digitar <code className="font-mono text-primary">{'{{$'}</code> num campo, a lista aparece.
        </p>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar (cpf, data, e-mail…)"
              spellCheck={false}
              className="h-8 w-full rounded-md border border-border bg-surface-2 pl-8 pr-2.5 text-[13px] text-fg outline-none placeholder:text-fg-subtle hover:border-border-strong focus:border-primary"
            />
          </div>
          <Button size="sm" onClick={() => setSeed((s) => s + 1)}>
            <RefreshCw className="size-3.5" /> Novos exemplos
          </Button>
        </div>
      </div>

      <div className="max-h-[52vh] overflow-y-auto px-3 py-2">
        {groups.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-fg-subtle">Nada encontrado.</p>
        )}
        {groups.map(([category, items]) => (
          <section key={category} className="py-1.5">
            <h3 className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wide text-fg-subtle">
              {DYNAMIC_CATEGORY_LABELS[category]}
            </h3>
            <ul>
              {items.map(({ variable, example }) => (
                <li key={variable.name}>
                  <button
                    type="button"
                    onClick={() => copyRef(variable.name)}
                    title="Copiar"
                    className="group grid w-full grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,13rem)_auto]"
                  >
                    <span className="truncate font-mono text-xs text-primary">{`{{${variable.name}}}`}</span>
                    <span className="truncate text-xs text-fg-muted">{variable.description}</span>
                    <span className="hidden truncate font-mono text-xs text-fg sm:block">{example}</span>
                    <Copy className="size-3.5 text-fg-subtle opacity-0 group-hover:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="border-t border-border px-5 py-3 text-xs text-fg-subtle">
        Precisa do mesmo valor em mais de um lugar? Guarde-o num pré-script:{' '}
        <code className="select-text font-mono text-fg-muted">{REUSE_TIP}</code> e use{' '}
        <code className="font-mono text-fg-muted">{'{{cpf}}'}</code>.
      </div>
    </Dialog>
  );
}

export function DynamicVariablesButton() {
  return (
    <IconButton
      icon={Dices}
      className="size-7"
      label="Dados de teste ({{$cpf}}, {{$nome}}…)"
      onClick={openDynamicVariables}
    />
  );
}
