import type { Scripts } from '@rota/core/shared';
import { BookOpen, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CodeEditor } from '../../components/CodeEditor';
import { cn } from '../../lib/cn';
import type { monaco } from '../../lib/monaco';
import { installPmTypes } from './pm-types';

type Phase = 'preRequest' | 'postResponse';

interface Snippet {
  label: string;
  phase: Phase | 'both';
  code: string;
}

const SNIPPETS: Snippet[] = [
  {
    label: 'Salvar token do login no ambiente',
    phase: 'postResponse',
    code: 'pm.environment.set("ACCESS_TOKEN", pm.response.json().access_token);',
  },
  {
    label: 'Testar status 200',
    phase: 'postResponse',
    code: 'pm.test("Status 200", () => {\n  pm.response.to.have.status(200);\n});',
  },
  {
    label: 'Testar tempo de resposta',
    phase: 'postResponse',
    code: 'pm.test("Responde em menos de 500 ms", () => {\n  pm.expect(pm.response.responseTime).to.be.below(500);\n});',
  },
  {
    label: 'Testar campo do JSON',
    phase: 'postResponse',
    code: 'pm.test("Tem o campo id", () => {\n  const body = pm.response.json();\n  pm.expect(body).to.have.property("id");\n});',
  },
  {
    label: 'Testar header',
    phase: 'postResponse',
    code: 'pm.test("Content-Type é JSON", () => {\n  pm.response.to.have.header("Content-Type");\n  pm.expect(pm.response.headers.get("Content-Type")).to.include("json");\n});',
  },
  {
    label: 'Salvar variável da coleção',
    phase: 'both',
    code: 'pm.collectionVariables.set("chave", "valor");',
  },
  {
    label: 'Ler variável',
    phase: 'both',
    code: 'const valor = pm.variables.get("chave");\nconsole.log("valor:", valor);',
  },
  {
    label: 'Adicionar header na requisição',
    phase: 'preRequest',
    code: 'pm.request.headers.upsert({ key: "X-Request-Id", value: Date.now() });',
  },
  {
    label: 'Gerar timestamp em variável',
    phase: 'preRequest',
    code: 'pm.variables.set("agora", new Date().toISOString());',
  },
];

const TABS: { id: Phase; label: string; hint: string }[] = [
  {
    id: 'preRequest',
    label: 'Pré-requisição',
    hint: 'Roda antes do envio. Pode alterar variáveis e a requisição (pm.request).',
  },
  {
    id: 'postResponse',
    label: 'Pós-resposta',
    hint: 'Roda depois da resposta. Use para testes (pm.test) e para salvar valores, como tokens.',
  },
];

interface ScriptsEditorProps {
  scripts: Scripts;
  onChange: (scripts: Scripts) => void;
  /** Texto explicando de quem são os scripts (requisição, pasta, coleção). */
  scopeNote?: string;
  onShortcut?: (shortcut: 'send' | 'save') => void;
}

export function ScriptsEditor({ scripts, onChange, scopeNote, onShortcut }: ScriptsEditorProps) {
  const [phase, setPhase] = useState<Phase>(
    scripts.preRequest && !scripts.postResponse ? 'preRequest' : 'postResponse',
  );
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  useEffect(installPmTypes, []);

  function insert(code: string) {
    const editor = editorRef.current;
    const current = scripts[phase];
    if (!editor) {
      onChange({ ...scripts, [phase]: current ? `${current}\n\n${code}` : code });
      return;
    }
    const model = editor.getModel();
    if (!model) return;
    const last = model.getLineCount();
    const prefix = model.getValue().trim() === '' ? '' : '\n\n';
    const column = model.getLineMaxColumn(last);
    editor.executeEdits('snippet', [
      {
        range: { startLineNumber: last, startColumn: column, endLineNumber: last, endColumn: column },
        text: prefix + code,
      },
    ]);
    editor.focus();
  }

  const active = TABS.find((t) => t.id === phase);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 px-4 py-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setPhase(t.id)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors',
                phase === t.id ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {t.label}
              {scripts[t.id].trim() && <span className="size-1.5 rounded-full bg-primary/80" />}
            </button>
          ))}
        </div>
        <p className="shrink-0 px-4 pb-2 text-xs text-fg-subtle">
          {active?.hint} {scopeNote}
        </p>
        <div className="min-h-0 flex-1 border-t border-border">
          <CodeEditor
            key={phase}
            language="javascript"
            value={scripts[phase]}
            onChange={(code) => onChange({ ...scripts, [phase]: code })}
            onEditor={(editor) => {
              editorRef.current = editor;
            }}
            placeholder={
              phase === 'postResponse'
                ? '// ex.: pm.environment.set("ACCESS_TOKEN", pm.response.json().access_token);'
                : '// ex.: pm.variables.set("agora", new Date().toISOString());'
            }
            {...(onShortcut ? { onShortcut } : {})}
          />
        </div>
      </div>

      <aside className="hidden w-60 shrink-0 overflow-y-auto border-l border-border p-3 lg:block">
        <p className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
          <Sparkles className="size-3" /> Trechos prontos
        </p>
        <ul className="space-y-0.5">
          {SNIPPETS.filter((s) => s.phase === 'both' || s.phase === phase).map((s) => (
            <li key={s.label}>
              <button
                type="button"
                onClick={() => insert(s.code)}
                className="w-full rounded-md px-2 py-1.5 text-left text-xs text-primary transition-colors hover:bg-surface-2"
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 rounded-md bg-surface p-2.5 text-2xs leading-relaxed text-fg-muted">
          <p className="mb-1 flex items-center gap-1 font-medium text-fg">
            <BookOpen className="size-3" /> Compatível com o Postman
          </p>
          pm.environment, pm.collectionVariables, pm.globals, pm.variables, pm.request, pm.response, pm.test,
          pm.expect (chai) e console. Sem acesso a arquivos ou rede; limite de 5 s por script.
        </div>
      </aside>
    </div>
  );
}
