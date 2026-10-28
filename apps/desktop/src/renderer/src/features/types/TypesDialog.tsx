import {
  type DbTable,
  generateTypes,
  pascalCase,
  TYPE_TARGET_LABELS,
  TYPE_TARGETS,
  type TypeTarget,
  tableToTypeScript,
  tryParseJson,
} from '@rota/core/shared';
import { Braces, Check, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { create } from 'zustand';
import type { MenuEntry } from '../../components/ActionMenu';
import { Button } from '../../components/Button';
import { CodeEditor } from '../../components/CodeEditor';
import { Dialog } from '../../components/Dialog';
import { TextInput } from '../../components/form';
import { cn } from '../../lib/cn';
import type { RequestTab } from '../../state/tabs';
import { toast } from '../../state/toasts';

type TypesSource = { kind: 'json'; value: unknown; name: string } | { kind: 'table'; table: DbTable };

const useTypes = create<{ source: TypesSource | null }>()(() => ({ source: null }));

export function openTypesForJson(value: unknown, name: string): void {
  useTypes.setState({ source: { kind: 'json', value, name } });
}

export function openTypesForTable(table: DbTable): void {
  useTypes.setState({ source: { kind: 'table', table } });
}

const TARGET_KEY = 'rota:types-target';

function loadTarget(): TypeTarget {
  try {
    const saved = localStorage.getItem(TARGET_KEY);
    if (saved && (TYPE_TARGETS as readonly string[]).includes(saved)) return saved as TypeTarget;
  } catch {
    // Sem localStorage: usa o padrão.
  }
  return 'typescript';
}

export function TypesDialog() {
  const source = useTypes((s) => s.source);
  if (!source) return null;
  return (
    <TypesDialogContent
      key={source.kind === 'json' ? `json:${source.name}` : `table:${source.table.name}`}
      source={source}
    />
  );
}

function TypesDialogContent({ source }: { source: TypesSource }) {
  const [target, setTarget] = useState<TypeTarget>(loadTarget);
  const [name, setName] = useState(source.kind === 'json' ? pascalCase(source.name) : '');
  const [copied, setCopied] = useState(false);

  const code = useMemo(() => {
    if (source.kind === 'table') return tableToTypeScript(source.table);
    return generateTypes(source.value, target, name.trim() || 'Resposta');
  }, [source, target, name]);

  const choose = (t: TypeTarget) => {
    setTarget(t);
    try {
      localStorage.setItem(TARGET_KEY, t);
    } catch {
      // Vale só nesta sessão.
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && useTypes.setState({ source: null })}
      title={source.kind === 'table' ? `Tipo da tabela ${source.table.name}` : 'Gerar tipo da resposta'}
      className="h-[min(640px,86vh)] w-[min(860px,94vw)]"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        {source.kind === 'json' ? (
          <>
            {TYPE_TARGETS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => choose(t)}
                className={cn(
                  'h-7 rounded-md px-2.5 text-xs transition-colors',
                  target === t ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {TYPE_TARGET_LABELS[t]}
              </button>
            ))}
            <label htmlFor="types-name" className="ml-2 text-xs text-fg-muted">
              Nome
            </label>
            <TextInput
              id="types-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
              className="h-7 w-48 font-mono text-xs"
            />
          </>
        ) : (
          <span className="text-xs text-fg-muted">TypeScript</span>
        )}
        <div className="flex-1" />
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor
          value={code}
          language={target === 'jsonschema' && source.kind === 'json' ? 'json' : 'javascript'}
          readOnly
        />
      </div>
      <p className="shrink-0 border-t border-border px-4 py-2 text-xs text-fg-subtle">
        {source.kind === 'table'
          ? 'Tipos naturais do TypeScript para cada coluna; confira como o driver do seu projeto entrega datas, decimais e BIGINT.'
          : 'Deduzido desta resposta: campos que faltam em parte dos itens de uma lista viram opcionais. Confira antes de usar.'}
      </p>
    </Dialog>
  );
}

/** Botão "Tipo" no cabeçalho da resposta (só para JSON). */
/** "Gerar tipo" no menu da resposta (só para respostas que parecem JSON). */
export function generateTypesAction(tab: RequestTab): MenuEntry | null {
  const response = tab.run?.result?.response;
  if (response?.body.encoding !== 'utf8') return null;
  const body = response.body.data;
  if (!/^\s*[[{]/.test(body)) return null;
  return {
    label: 'Gerar tipo (TypeScript, Zod, JSON Schema)…',
    icon: Braces,
    onSelect: () => {
      const parsed = tryParseJson(body);
      if (parsed) openTypesForJson(parsed.value, tab.title);
      else toast.info('A resposta não é um JSON válido.');
    },
  };
}
