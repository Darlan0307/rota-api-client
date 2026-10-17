import type { Body, BodyMode, FormDataField, KeyValue, RawLanguage } from '@rota/core/shared';
import { FileUp, Paperclip, WandSparkles, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { CodeEditor, type EditorLanguage } from '../../components/CodeEditor';
import { EmptyState } from '../../components/EmptyState';
import { Select } from '../../components/form';
import { KeyValueTable } from '../../components/KeyValueTable';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { toast } from '../../state/toasts';

const MODES: { value: BodyMode; label: string }[] = [
  { value: 'none', label: 'Nenhum' },
  { value: 'json', label: 'JSON' },
  { value: 'raw', label: 'Raw' },
  { value: 'formdata', label: 'form-data' },
  { value: 'urlencoded', label: 'x-www-form-urlencoded' },
];

const RAW_LANGUAGES: { value: RawLanguage; label: string; editor: EditorLanguage }[] = [
  { value: 'text', label: 'Texto', editor: 'plaintext' },
  { value: 'json', label: 'JSON', editor: 'json' },
  { value: 'xml', label: 'XML', editor: 'xml' },
  { value: 'html', label: 'HTML', editor: 'html' },
  { value: 'javascript', label: 'JavaScript', editor: 'javascript' },
];

/** Troca o modo preservando o que fizer sentido (texto entre JSON/raw, campos entre forms). */
export function switchBodyMode(body: Body, mode: BodyMode): Body {
  const text = body.mode === 'json' || body.mode === 'raw' ? body.text : '';
  const fields: KeyValue[] =
    body.mode === 'urlencoded'
      ? body.fields
      : body.mode === 'formdata'
        ? body.fields.filter((f) => f.type === 'text').map(({ type: _t, ...f }) => f)
        : [];
  switch (mode) {
    case 'none':
      return { mode };
    case 'json':
      return { mode, text };
    case 'raw':
      return { mode, language: 'text', text };
    case 'urlencoded':
      return { mode, fields };
    case 'formdata':
      return { mode, fields: fields.map((f) => ({ ...f, type: 'text' as const })) };
  }
}

export function formatJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

interface BodyEditorProps {
  body: Body;
  onChange: (body: Body) => void;
  onShortcut?: (shortcut: 'send' | 'save') => void;
}

export function BodyEditor({ body, onChange, onShortcut }: BodyEditorProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 px-4 py-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => body.mode !== m.value && onChange(switchBodyMode(body, m.value))}
            className={cn(
              'h-7 rounded-md px-2.5 text-xs transition-colors',
              body.mode === m.value ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {m.label}
          </button>
        ))}
        <div className="flex-1" />
        {body.mode === 'raw' && (
          <Select
            value={body.language}
            options={RAW_LANGUAGES}
            onChange={(language) => onChange({ ...body, language })}
            align="end"
            ariaLabel="Linguagem do body"
          />
        )}
        {(body.mode === 'json' || (body.mode === 'raw' && body.language === 'json')) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const formatted = formatJson(body.text);
              if (formatted === null) toast.error('O JSON tem erros de sintaxe; não foi possível formatar.');
              else onChange({ ...body, text: formatted });
            }}
          >
            <WandSparkles className="size-3.5" /> Formatar
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 border-t border-border">
        {body.mode === 'none' && (
          <EmptyState compact icon={FileUp} title="Sem body" description="Esta requisição não envia corpo." />
        )}
        {body.mode === 'json' && (
          <CodeEditor
            language="json"
            value={body.text}
            onChange={(text) => onChange({ ...body, text })}
            variables
            placeholder='{ "chave": "{{variavel}}" }'
            {...(onShortcut ? { onShortcut } : {})}
          />
        )}
        {body.mode === 'raw' && (
          <CodeEditor
            language={RAW_LANGUAGES.find((l) => l.value === body.language)?.editor ?? 'plaintext'}
            value={body.text}
            onChange={(text) => onChange({ ...body, text })}
            variables
            {...(onShortcut ? { onShortcut } : {})}
          />
        )}
        {body.mode === 'urlencoded' && (
          <div className="h-full overflow-auto p-4">
            <KeyValueTable
              rows={body.fields}
              onChange={(fields) => onChange({ ...body, fields })}
              createRow={(patch) => ({ key: '', value: '', enabled: true, ...patch })}
            />
          </div>
        )}
        {body.mode === 'formdata' && (
          <div className="h-full overflow-auto p-4">
            <KeyValueTable<FormDataField>
              rows={body.fields}
              onChange={(fields) => onChange({ ...body, fields })}
              createRow={(patch) => ({ key: '', value: '', type: 'text', enabled: true, ...patch })}
              renderExtra={(row, update) => (
                <Select
                  value={row.type}
                  options={[
                    { value: 'text', label: 'Texto' },
                    { value: 'file', label: 'Arquivo' },
                  ]}
                  onChange={(type) => update({ type, value: '' })}
                  triggerClassName="h-7 w-full rounded-none border-0 bg-transparent"
                />
              )}
              renderValue={(row, update) =>
                row.type === 'file' ? (
                  <FilePicker path={row.value} onChange={(value) => update({ value })} />
                ) : null
              }
            />
            <p className="mt-2 text-xs text-fg-subtle">
              Arquivos são lidos do disco no momento do envio; o caminho fica salvo na requisição.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function FilePicker({ path, onChange }: { path: string; onChange: (path: string) => void }) {
  const [over, setOver] = useState(false);
  const name = path.split(/[\\/]/).pop();

  async function pick() {
    const [file] = await api.invoke('dialog:openFiles', { title: 'Selecionar arquivo para enviar' });
    if (file) onChange(file);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) onChange(api.pathForFile(file));
      }}
      className={cn('flex h-7 w-full min-w-0 items-center gap-1.5 px-2', over && 'bg-primary-soft')}
    >
      {path ? (
        <>
          <Paperclip className="size-3.5 shrink-0 text-fg-subtle" />
          <span className="truncate font-mono text-xs text-fg" title={path}>
            {name}
          </span>
          <button
            type="button"
            aria-label="Remover arquivo"
            onClick={() => onChange('')}
            className="ml-auto flex size-5 shrink-0 items-center justify-center rounded text-fg-subtle hover:text-fg"
          >
            <X className="size-3" />
          </button>
        </>
      ) : (
        <button type="button" onClick={pick} className="text-xs text-primary hover:underline">
          Selecionar ou arrastar arquivo
        </button>
      )}
    </div>
  );
}
