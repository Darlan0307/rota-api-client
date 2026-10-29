import type { Appearance } from '@rota/core/shared';
import { Ban, Check, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextInput } from '../../components/form';
import { api, errorMessage, runCommand } from '../../lib/api';
import { cn } from '../../lib/cn';
import {
  type AppearanceKind,
  ChoiceIcon,
  findIconChoice,
  ICON_GROUPS,
  ITEM_COLORS,
  ItemIcon,
} from '../../lib/item-icons';
import { toast } from '../../state/toasts';
import { offerUndo } from '../../state/undo';

interface AppearanceTarget {
  id: string;
  name: string;
  kind: AppearanceKind;
  appearance?: Appearance | undefined;
}

const TITLES: Record<AppearanceKind, string> = {
  collection: 'da coleção',
  folder: 'da pasta',
  environment: 'do ambiente',
  tunnel: 'do túnel',
};

/** Coleções, pastas e ambientes ficam no workspace; túneis, nas configurações da máquina. */
async function save(target: AppearanceTarget, appearance: Appearance | null): Promise<boolean> {
  if (target.kind !== 'tunnel')
    return (await runCommand({ type: 'setAppearance', id: target.id, appearance })) !== undefined;
  try {
    // Objeto vazio volta ao padrão (o túnel guarda só o que vier preenchido).
    await api.invoke('tunnel:update', target.id, { appearance: appearance ?? {} });
    return true;
  } catch (error) {
    toast.error(errorMessage(error));
    return false;
  }
}

const useAppearanceDialog = create<{ target: AppearanceTarget | null }>()(() => ({ target: null }));

export function openAppearanceDialog(target: AppearanceTarget): void {
  useAppearanceDialog.setState({ target });
}

const close = () => useAppearanceDialog.setState({ target: null });

/** Busca sem acento e sem diferenciar maiúsculas ("cartao" acha "Cartão"). */
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function AppearanceDialog() {
  const target = useAppearanceDialog((s) => s.target);
  if (!target) return null;
  return <AppearanceForm key={target.id} target={target} />;
}

function AppearanceForm({ target }: { target: AppearanceTarget }) {
  const [icon, setIcon] = useState<string | undefined>(
    findIconChoice(target.appearance?.icon) ? target.appearance?.icon : undefined,
  );
  const [color, setColor] = useState<string | undefined>(target.appearance?.color);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return ICON_GROUPS;
    return ICON_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((item) => fold(`${item.label} ${item.keywords ?? ''} ${g.label}`).includes(q)),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  const next: Appearance = { ...(icon ? { icon } : {}), ...(color ? { color } : {}) };
  const isDefault = !icon && !color;

  async function apply(value: Appearance | null) {
    const previous = target.appearance ?? null;
    if (!(await save(target, value))) return;
    close();
    offerUndo(
      value ? `Aparência de "${target.name}" alterada.` : `"${target.name}" voltou ao ícone padrão.`,
      () => save(target, previous),
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={`Ícone e cor ${TITLES[target.kind]}`}
      placement="top"
      className="w-[min(560px,94vw)]"
    >
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-surface-2">
          <ItemIcon kind={target.kind} appearance={next} className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">{target.name}</p>
          <p className="text-xs text-fg-subtle">
            {findIconChoice(icon)?.label ?? 'Ícone padrão'}
            {color ? ` · ${ITEM_COLORS.find((c) => c.value === color)?.label ?? color}` : ''}
          </p>
        </div>
      </div>

      <div className="space-y-2 px-5 pt-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <TextInput
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar ícone (ex.: pagamento, erp, pix, stripe)"
            className="pl-8"
          />
        </div>
      </div>

      <div className="max-h-[42vh] min-h-40 overflow-y-auto px-5 py-3">
        {groups.length === 0 && (
          <p className="py-8 text-center text-xs text-fg-subtle">Nenhum ícone encontrado.</p>
        )}
        {groups.map((group) => (
          <section key={group.label} className="mb-3">
            <h3 className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
              {group.label}
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1">
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={item.label}
                  aria-label={item.label}
                  aria-pressed={icon === item.id}
                  onClick={() => setIcon(icon === item.id ? undefined : item.id)}
                  className={cn(
                    'flex aspect-square items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg',
                    icon === item.id && 'bg-primary-soft text-fg ring-1 ring-primary',
                  )}
                >
                  <ChoiceIcon choice={item} className="size-[18px]" />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="border-t border-border px-5 py-3">
        <p className="mb-2 text-xs text-fg-muted">Cor</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            title="Sem cor (marcas usam a cor delas)"
            aria-label="Sem cor"
            aria-pressed={!color}
            onClick={() => setColor(undefined)}
            className={cn(
              'flex size-7 items-center justify-center rounded-full border border-border text-fg-subtle hover:border-border-strong',
              !color && 'ring-2 ring-primary ring-offset-2 ring-offset-elevated',
            )}
          >
            <Ban className="size-3.5" />
          </button>
          {ITEM_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.label}
              aria-label={c.label}
              aria-pressed={color === c.value}
              onClick={() => setColor(c.value)}
              className={cn(
                'flex size-7 items-center justify-center rounded-full transition-transform hover:scale-110',
                color === c.value && 'ring-2 ring-primary ring-offset-2 ring-offset-elevated',
              )}
              style={{ backgroundColor: c.value }}
            >
              {color === c.value && <Check className="size-3.5 text-black/70" strokeWidth={3} />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-5 py-3">
        <Button
          variant="ghost"
          disabled={!target.appearance}
          onClick={() => void apply(null)}
          title="Volta ao ícone padrão, sem cor"
        >
          Restaurar padrão
        </Button>
        <div className="flex-1" />
        <Button onClick={close}>Cancelar</Button>
        <Button variant="primary" onClick={() => void apply(isDefault ? null : next)}>
          Aplicar
        </Button>
      </div>
    </Dialog>
  );
}
