import {
  applyTestData,
  DYNAMIC_VARIABLES,
  type FillSuggestion,
  generateDynamic,
  jsonSyntaxError,
  suggestTestData,
} from '@rota/core/shared';
import { ArrowRight, Dices } from 'lucide-react';
import { useState } from 'react';
import { create } from 'zustand';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Checkbox, Select } from '../../components/form';
import { toast, useToasts } from '../../state/toasts';

interface FillRequest {
  text: string;
  suggestions: FillSuggestion[];
  apply: (text: string) => void;
}

const useFill = create<{ request: FillRequest | null }>()(() => ({ request: null }));

/** Abre a prévia "Dados de teste" para um corpo JSON; `apply` recebe o texto novo. */
export function openFillTestData(text: string, apply: (text: string) => void): void {
  if (jsonSyntaxError(text)) {
    toast.info('Corrija o JSON antes (o botão Formatar mostra onde está o erro).');
    return;
  }
  const suggestions = suggestTestData(text);
  if (!suggestions || suggestions.length === 0) {
    toast.info(
      'Nenhum campo reconhecido (nome, CPF, e-mail, telefone, CEP, endereço, valor...). Digite {{$ num valor para escolher à mão.',
    );
    return;
  }
  useFill.setState({ request: { text, suggestions, apply } });
}

const OPTIONS = DYNAMIC_VARIABLES.filter((v) => !v.name.startsWith('$random')).map((v) => ({
  value: v.name,
  label: v.name,
  hint: v.description,
}));

export function FillTestDataDialog() {
  const request = useFill((s) => s.request);
  if (!request) return null;
  return <FillContent key={request.text} request={request} />;
}

function FillContent({ request }: { request: FillRequest }) {
  const [rows, setRows] = useState(() =>
    request.suggestions.map((s) => ({ ...s, enabled: true, example: generateDynamic(s.variable) ?? '' })),
  );
  const close = () => useFill.setState({ request: null });
  const chosen = rows.filter((r) => r.enabled);

  const update = (index: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  function apply() {
    const previous = request.text;
    request.apply(applyTestData(request.text, chosen));
    close();
    useToasts
      .getState()
      .push(
        'success',
        `${chosen.length} ${chosen.length === 1 ? 'campo preenchido' : 'campos preenchidos'}.`,
        {
          action: { label: 'Desfazer', run: () => request.apply(previous) },
          duration: 8000,
        },
      );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title="Preencher com dados de teste"
      className="max-h-[86vh] w-[min(760px,94vw)]"
    >
      <p className="shrink-0 border-b border-border px-5 py-3 text-[13px] leading-relaxed text-fg-muted">
        Campos reconhecidos pelo nome. Cada variável gera um valor novo a cada envio (CPF e CNPJ válidos).
        Desmarque o que não quer trocar ou escolha outra variável.
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <table className="w-full text-xs">
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.start}`} className="border-b border-border/60 last:border-0">
                <td className="w-7 py-1.5 pl-2">
                  <Checkbox
                    checked={row.enabled}
                    onChange={(enabled) => update(i, { enabled })}
                    label={`Trocar ${row.path}`}
                  />
                </td>
                <td className="max-w-48 truncate py-1.5 pr-3 font-mono text-fg" title={row.path}>
                  {row.path}
                </td>
                <td className="max-w-40 truncate py-1.5 pr-2 font-mono text-fg-subtle" title={row.current}>
                  {row.current}
                </td>
                <td className="w-5 py-1.5">
                  <ArrowRight className="size-3 text-fg-subtle" />
                </td>
                <td className="py-1.5 pr-2">
                  <Select
                    value={row.variable}
                    options={OPTIONS}
                    onChange={(variable) =>
                      update(i, { variable, example: generateDynamic(variable) ?? '', enabled: true })
                    }
                    ariaLabel={`Variável para ${row.path}`}
                    triggerClassName="w-40 font-mono"
                    className="max-h-72 overflow-y-auto"
                  />
                </td>
                <td className="max-w-44 truncate py-1.5 pr-2 text-fg-muted" title={row.example}>
                  {row.example}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
        <span className="mr-auto text-xs text-fg-subtle">
          {row(chosen.length)} de {rows.length}
        </span>
        <Button size="sm" variant="ghost" onClick={close}>
          Cancelar
        </Button>
        <Button size="sm" variant="primary" disabled={chosen.length === 0} onClick={apply}>
          <Dices className="size-3.5" /> Aplicar
        </Button>
      </div>
    </Dialog>
  );
}

function row(n: number): string {
  return n === 1 ? '1 campo marcado' : `${n} campos marcados`;
}
