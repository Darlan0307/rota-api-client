import {
  DEFAULT_EVIDENCE_FOOTER,
  type EvidenceInclude,
  type EvidenceOptions,
  TECHNICAL_HEADERS,
} from '@rota/core/shared';
import { Check } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Field, TextArea, TextInput } from '../../components/form';
import { cn } from '../../lib/cn';

/** Aceita função: cliques seguidos precisam partir do estado mais recente. */
export type Patch = (
  patch: Partial<EvidenceOptions> | ((current: EvidenceOptions) => Partial<EvidenceOptions>),
) => void;

const INCLUDE_GROUPS: {
  title: string;
  items: { key: keyof EvidenceInclude; label: string; hint?: string }[];
}[] = [
  {
    title: 'Topo do relatório',
    items: [
      { key: 'generatedAt', label: 'Data em que foi gerado' },
      { key: 'environment', label: 'Nome do ambiente' },
      { key: 'notes', label: 'Texto "O que aconteceu"' },
      { key: 'summary', label: 'Tabela com a sequência', hint: 'Só aparece com 2 envios ou mais.' },
    ],
  },
  {
    title: 'Requisição',
    items: [
      { key: 'time', label: 'Horário de cada envio' },
      { key: 'fullUrl', label: 'URL completa', hint: 'Desmarcado, mostra só o caminho (sem o servidor).' },
      { key: 'requestHeaders', label: 'Headers enviados' },
      { key: 'requestBody', label: 'Corpo enviado' },
      { key: 'curl', label: 'cURL para reproduzir', hint: 'Só no Markdown e no PDF/relatório completo.' },
    ],
  },
  {
    title: 'Resposta',
    items: [
      { key: 'responseMeta', label: 'Tempo e tamanho' },
      { key: 'responseHeaders', label: 'Headers da resposta' },
      { key: 'responseBody', label: 'Corpo da resposta' },
      { key: 'tests', label: 'Resultado dos testes (pm.test)' },
      { key: 'warnings', label: 'Avisos do envio', hint: 'Ex.: corpo JSON inválido depois das variáveis.' },
    ],
  },
];

/** Aba "Conteúdo": o que entra, headers e máscaras. */
export function ContentPanel({ options, patch }: { options: EvidenceOptions; patch: Patch }) {
  const setInclude = (key: keyof EvidenceInclude, value: boolean) =>
    patch((f) => ({ include: { ...f.include, [key]: value } }));

  return (
    <div className="space-y-5 px-4 py-3">
      {INCLUDE_GROUPS.map((group) => (
        <Group key={group.title} title={group.title}>
          {group.items.map((item) => (
            <Toggle
              key={item.key}
              label={item.label}
              {...(item.hint ? { hint: item.hint } : {})}
              checked={options.include[item.key]}
              onChange={(v) => setInclude(item.key, v)}
            />
          ))}
        </Group>
      ))}

      <Group title="Headers">
        <Toggle
          label="Esconder headers técnicos"
          hint={`Ex.: ${TECHNICAL_HEADERS.slice(0, 7).join(', ')}…`}
          checked={options.hideTechnicalHeaders}
          onChange={(v) => patch({ hideTechnicalHeaders: v })}
        />
      </Group>

      <Group title="Segurança">
        <Toggle
          label="Mascarar tokens, senhas e headers de autenticação"
          hint="Mesmo os que não são variáveis secretas (secretas sempre saem como ••••••)."
          checked={options.maskSensitive}
          onChange={(v) => patch({ maskSensitive: v })}
        />
        <Field
          label="Mascarar também estes campos"
          hint="Nomes separados por vírgula. Vale para corpo, headers e URL."
        >
          <TextInput
            value={options.extraMaskedFields}
            onChange={(e) => patch({ extraMaskedFields: e.target.value })}
            placeholder="ex.: cpf, email, telefone"
            disabled={!options.maskSensitive}
          />
        </Field>
      </Group>

      <Group title="Tamanho">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Caracteres por corpo">
            <TextInput
              type="number"
              min={500}
              step={1000}
              value={options.maxBodyChars}
              onChange={(e) =>
                patch({ maxBodyChars: clampInt(e.target.value, 500, 500_000, options.maxBodyChars) })
              }
            />
          </Field>
          <Field label="Linhas por corpo (cartões)">
            <TextInput
              type="number"
              min={3}
              max={200}
              value={options.cardBodyLines}
              onChange={(e) =>
                patch({ cardBodyLines: clampInt(e.target.value, 3, 200, options.cardBodyLines) })
              }
            />
          </Field>
        </div>
      </Group>
    </div>
  );
}

/** Aba "Textos": título, ambiente, texto livre e rodapé. */
export function TextsPanel({
  options,
  patch,
  suggestedTitle,
}: {
  options: EvidenceOptions;
  patch: Patch;
  suggestedTitle: string;
}) {
  return (
    <div className="space-y-4 px-4 py-3">
      <Field label="Título">
        <TextInput
          value={options.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder={suggestedTitle}
        />
      </Field>
      <Field label="Ambiente">
        <TextInput
          value={options.environment}
          onChange={(e) => patch({ environment: e.target.value })}
          placeholder="ex.: Homologação"
        />
      </Field>
      <Field label="Título da seção do texto livre">
        <TextInput
          value={options.notesHeading}
          onChange={(e) => patch({ notesHeading: e.target.value })}
          placeholder="O que aconteceu"
        />
      </Field>
      <Field label={options.notesHeading.trim() || 'O que aconteceu'}>
        <TextArea
          rows={5}
          value={options.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          placeholder="O que você fez, o que era esperado e o que veio. Aparece no topo do relatório."
        />
      </Field>
      <Field
        label="Rodapé"
        hint={
          <span>
            Vazio: sem rodapé.{' '}
            {options.footer !== DEFAULT_EVIDENCE_FOOTER && (
              <button
                type="button"
                className="cursor-pointer text-primary hover:underline"
                onClick={() => patch({ footer: DEFAULT_EVIDENCE_FOOTER })}
              >
                Usar o texto padrão
              </button>
            )}
          </span>
        }
      >
        <TextArea rows={2} value={options.footer} onChange={(e) => patch({ footer: e.target.value })} />
      </Field>
    </div>
  );
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">{title}</h3>
      {children}
    </section>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={activateOnKey(() => onChange(!checked))}
      className="flex cursor-pointer items-start gap-2 text-xs text-fg-muted hover:text-fg"
    >
      <CheckMark checked={checked} className="mt-px" />
      <span>
        {label}
        {hint && <span className="block text-2xs text-fg-subtle">{hint}</span>}
      </span>
    </div>
  );
}

export function CheckMark({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
        checked ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong',
        className,
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}

/** Espaço e Enter acionam os itens marcáveis (são div role=checkbox). */
export function activateOnKey(action: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    action();
  };
}
