import { CODEGEN_LABELS, CODEGEN_TARGETS, type CodegenTarget } from '@rota/core/shared';
import { Check, Code2, Copy, Eye, EyeOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Button } from '../../components/Button';
import { CodeEditor } from '../../components/CodeEditor';
import { Dialog } from '../../components/Dialog';
import { Tooltip } from '../../components/Tooltip';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { type RequestTab, useTabs } from '../../state/tabs';

const useCodegen = create<{ tabId: string | null; set(id: string | null): void }>()((set) => ({
  tabId: null,
  set: (tabId) => set({ tabId }),
}));

export function openCodegen(tabId: string): void {
  useCodegen.getState().set(tabId);
}

/** Preferência local: última linguagem escolhida. */
function loadTarget(): CodegenTarget {
  try {
    const saved = localStorage.getItem('rota:codegen-target');
    if (saved && (CODEGEN_TARGETS as readonly string[]).includes(saved)) return saved as CodegenTarget;
  } catch {
    // ignora
  }
  return 'curl';
}

export function CodegenDialog() {
  const tabId = useCodegen((s) => s.tabId);
  const close = () => useCodegen.getState().set(null);
  const tab = useTabs((s) => s.tabs.find((t): t is RequestTab => t.id === tabId && t.kind === 'request'));
  const [target, setTarget] = useState<CodegenTarget>(loadTarget);
  const [reveal, setReveal] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!tab) return;
    let cancelled = false;
    api
      .invoke('codegen:generate', {
        requestId: tab.itemId ?? undefined,
        parentId: tab.parentId ?? undefined,
        data: tab.draft,
        target,
        reveal,
      })
      .then((c) => {
        if (!cancelled) {
          setCode(c);
          setError(null);
        }
      })
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [tab, target, reveal]);

  if (!tab) return null;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) {
          close();
          setReveal(false);
        }
      }}
      title="Gerar código"
      className="h-[min(640px,86vh)] w-[min(860px,94vw)]"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-2">
        {CODEGEN_TARGETS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTarget(t);
              try {
                localStorage.setItem('rota:codegen-target', t);
              } catch {
                // ignora
              }
            }}
            className={cn(
              'h-7 rounded-md px-2.5 text-xs transition-colors',
              target === t ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {CODEGEN_LABELS[t]}
          </button>
        ))}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setReveal((r) => !r)}>
          {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          {reveal ? 'Ocultar segredos' : 'Mostrar segredos'}
        </Button>
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
        {error ? (
          <p className="p-4 text-[13px] text-danger">{error}</p>
        ) : (
          <CodeEditor value={code} language={target === 'curl' ? 'plaintext' : 'javascript'} readOnly />
        )}
      </div>
      <p className="shrink-0 border-t border-border px-4 py-2 text-xs text-fg-subtle">
        Variáveis do ambiente ativo já resolvidas.{' '}
        {reveal ? (
          <span className="text-warning">Atenção: os valores secretos estão visíveis no código.</span>
        ) : (
          'Variáveis secretas aparecem como ••••••.'
        )}
      </p>
    </Dialog>
  );
}

/** Botão "</>" no cabeçalho da requisição. */
export function CodegenButton({ tabId }: { tabId: string }) {
  return (
    <Tooltip label="Gerar código (cURL, fetch, axios)">
      <Button size="sm" variant="ghost" onClick={() => openCodegen(tabId)}>
        <Code2 className="size-3.5" /> Código
      </Button>
    </Tooltip>
  );
}
