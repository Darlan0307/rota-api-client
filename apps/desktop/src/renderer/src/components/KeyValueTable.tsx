import { GripVertical, Trash2 } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { useElementWidth } from '../lib/use-element-width';
import { Checkbox } from './form';
import { VariableInput } from './VariableInput';

export interface KeyValueRow {
  key: string;
  value: string;
  enabled: boolean;
  description?: string | undefined;
}

interface KeyValueTableProps<T extends KeyValueRow> {
  rows: readonly T[];
  onChange: (rows: T[]) => void;
  /** Cria uma linha nova a partir de uma chave/valor digitados na linha vazia. */
  createRow: (patch: Partial<T>) => T;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Renderização customizada do valor (ex.: seletor de arquivo no form-data). */
  renderValue?: (row: T, update: (patch: Partial<T>) => void) => ReactNode;
  /** Coluna extra antes do valor (ex.: tipo texto/arquivo). */
  renderExtra?: (row: T, update: (patch: Partial<T>) => void) => ReactNode;
  showDescription?: boolean;
}

/**
 * Tabela editável de chave/valor (params, headers, form). Sempre há uma linha
 * vazia no final: digitar nela cria uma nova linha.
 */
/** Largura (px) abaixo da qual a coluna de descrição é escondida. */
const NARROW_TABLE_WIDTH = 520;

export function KeyValueTable<T extends KeyValueRow>({
  rows,
  onChange,
  createRow,
  keyPlaceholder = 'Chave',
  valuePlaceholder = 'Valor',
  renderValue,
  renderExtra,
  showDescription: showDescriptionProp = true,
}: KeyValueTableProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef);
  // Em painéis estreitos a descrição some para chave e valor terem espaço.
  const showDescription = showDescriptionProp && (width === 0 || width >= NARROW_TABLE_WIDTH);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  /** Campo que deve receber o foco ao criar uma linha pela linha vazia. */
  const [focusNew, setFocusNew] = useState<{ index: number; field: 'key' | 'value' } | null>(null);

  const update = (index: number, patch: Partial<T>) => {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));
  const addFromEmpty = (patch: Partial<T>, field: 'key' | 'value') => {
    setFocusNew({ index: rows.length, field });
    onChange([...rows, createRow(patch)]);
  };

  const allEnabled = rows.length > 0 && rows.every((r) => r.enabled);

  function drop(target: number) {
    if (dragIndex === null || dragIndex === target) return;
    const next = [...rows];
    const [moved] = next.splice(dragIndex, 1);
    if (moved) next.splice(target > dragIndex ? target - 1 : target, 0, moved);
    onChange(next);
  }

  const gridCols = cn(
    'grid items-center',
    renderExtra
      ? showDescription
        ? 'grid-cols-[28px_minmax(0,1fr)_88px_minmax(0,1.4fr)_minmax(0,0.8fr)_32px]'
        : 'grid-cols-[28px_minmax(0,1fr)_88px_minmax(0,1.4fr)_32px]'
      : showDescription
        ? 'grid-cols-[28px_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_32px]'
        : 'grid-cols-[28px_minmax(0,1fr)_minmax(0,1.4fr)_32px]',
  );

  return (
    <div ref={rootRef} className="overflow-hidden rounded-lg border border-border text-xs">
      <div
        className={cn(
          gridCols,
          'h-8 border-b border-border bg-surface text-2xs font-medium uppercase tracking-wider text-fg-subtle',
        )}
      >
        <div className="flex justify-center">
          {rows.length > 0 && (
            <Checkbox
              checked={allEnabled}
              label="Marcar todos"
              onChange={(checked) => onChange(rows.map((r) => ({ ...r, enabled: checked })))}
            />
          )}
        </div>
        <div className="px-2">{keyPlaceholder}</div>
        {renderExtra && <div className="px-2">Tipo</div>}
        <div className="px-2">{valuePlaceholder}</div>
        {showDescription && <div className="px-2">Descrição</div>}
        <div />
      </div>

      {rows.map((row, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: linhas não têm id estável; a posição é a identidade
          key={index}
          onDragOver={(e) => {
            if (dragIndex === null) return;
            e.preventDefault();
            setDropIndex(index);
          }}
          onDrop={(e) => {
            e.preventDefault();
            drop(index);
            setDragIndex(null);
            setDropIndex(null);
          }}
          className={cn(
            gridCols,
            'group border-b border-border transition-colors last:border-b-0 hover:bg-surface/60',
            !row.enabled && 'opacity-55',
            dropIndex === index && dragIndex !== null && 'shadow-[inset_0_2px_0_var(--color-primary)]',
          )}
        >
          <div className="relative flex justify-center">
            <span
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragEnd={() => {
                setDragIndex(null);
                setDropIndex(null);
              }}
              className="absolute -left-0.5 cursor-grab text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100"
              title="Arrastar para reordenar"
            >
              <GripVertical className="size-3" />
            </span>
            <Checkbox
              checked={row.enabled}
              label="Habilitado"
              onChange={(enabled) => update(index, { enabled } as Partial<T>)}
            />
          </div>
          <Cell>
            <VariableInput
              size="sm"
              value={row.key}
              onChange={(key) => update(index, { key } as Partial<T>)}
              placeholder={keyPlaceholder}
              autoFocus={focusNew?.index === index && focusNew.field === 'key'}
            />
          </Cell>
          {renderExtra && <Cell>{renderExtra(row, (patch) => update(index, patch))}</Cell>}
          <Cell>
            {renderValue ? (
              renderValue(row, (patch) => update(index, patch))
            ) : (
              <VariableInput
                size="sm"
                value={row.value}
                onChange={(value) => update(index, { value } as Partial<T>)}
                placeholder={valuePlaceholder}
                autoFocus={focusNew?.index === index && focusNew.field === 'value'}
              />
            )}
          </Cell>
          {showDescription && (
            <Cell>
              <input
                value={row.description ?? ''}
                onChange={(e) => update(index, { description: e.target.value || undefined } as Partial<T>)}
                placeholder="Descrição"
                className="h-7 w-full bg-transparent px-2 text-xs text-fg-muted outline-none placeholder:text-fg-subtle/70"
              />
            </Cell>
          )}
          <div className="flex justify-center">
            <button
              type="button"
              aria-label="Remover linha"
              onClick={() => remove(index)}
              className="flex size-6 items-center justify-center rounded text-fg-subtle opacity-0 transition-opacity hover:bg-surface-2 hover:text-danger focus:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      ))}

      {/* Linha vazia para adicionar */}
      <div className={cn(gridCols, 'bg-transparent')}>
        <div />
        <Cell>
          <VariableInput
            size="sm"
            value=""
            onChange={(key) => addFromEmpty({ key } as Partial<T>, 'key')}
            placeholder={`Adicionar ${keyPlaceholder.toLowerCase()}`}
          />
        </Cell>
        {renderExtra && <div />}
        <Cell>
          <VariableInput
            size="sm"
            value=""
            onChange={(value) => addFromEmpty({ value } as Partial<T>, 'value')}
            placeholder={valuePlaceholder}
          />
        </Cell>
        {showDescription && <div />}
        <div />
      </div>
    </div>
  );
}

function Cell({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 items-center border-l border-border">{children}</div>;
}
