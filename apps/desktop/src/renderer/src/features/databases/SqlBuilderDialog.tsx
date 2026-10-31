import {
  buildSqlCommand,
  conditionsForRow,
  type DbColumn,
  type DbTable,
  type DbValue,
  inputFromValue,
  SQL_OPERATORS,
  type SqlCommandKind,
  type SqlCondition,
  type SqlOperator,
  type SqlValueMode,
} from '@rota/core/shared';
import { AlertTriangle, BookOpen, Check, Copy, KeyRound, Lock, Plus, SquarePen, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Checkbox, Select, TextInput } from '../../components/form';
import { IconButton } from '../../components/IconButton';
import { cn } from '../../lib/cn';
import { toast } from '../../state/toasts';
import { openSqlExamples } from './SqlExamplesDialog';
import { appendToSqlEditor } from './sql-editors';
import { useConnection, useDatabases } from './state';

interface BuilderRequest {
  connectionId: string;
  kind: SqlCommandKind;
  tableName?: string | undefined;
  /** Linha do resultado: preenche valores e condições (editar, excluir, duplicar). */
  row?: { columns: readonly string[]; values: readonly DbValue[] } | undefined;
}

const useSqlBuilder = create<{ request: BuilderRequest | null }>()(() => ({ request: null }));

export function openSqlBuilder(request: BuilderRequest): void {
  useSqlBuilder.setState({ request });
}

const close = () => useSqlBuilder.setState({ request: null });

const KINDS: { id: SqlCommandKind; label: string; hint: string }[] = [
  { id: 'select', label: 'Consultar', hint: 'SELECT' },
  { id: 'insert', label: 'Inserir', hint: 'INSERT' },
  { id: 'update', label: 'Alterar', hint: 'UPDATE' },
  { id: 'delete', label: 'Excluir', hint: 'DELETE' },
];

const MODES: { value: SqlValueMode; label: string }[] = [
  { value: 'auto', label: 'Valor' },
  { value: 'null', label: 'NULL' },
  { value: 'sql', label: 'Expressão SQL' },
];

interface ValueState {
  include: boolean;
  mode: SqlValueMode;
  text: string;
}

export function SqlBuilderDialog() {
  const request = useSqlBuilder((s) => s.request);
  if (!request) return null;
  return (
    <SqlBuilderForm
      key={`${request.connectionId}:${request.kind}:${request.tableName ?? ''}`}
      request={request}
    />
  );
}

const requiredColumn = (c: DbColumn) => !c.nullable && c.defaultValue === undefined;

function rowValue(row: BuilderRequest['row'], column: string): { found: boolean; value: DbValue } {
  if (!row) return { found: false, value: null };
  const index = row.columns.findIndex((c) => c.toLowerCase() === column.toLowerCase());
  return index >= 0 ? { found: true, value: row.values[index] ?? null } : { found: false, value: null };
}

function initialValues(table: DbTable | undefined, request: BuilderRequest): Record<string, ValueState> {
  const values: Record<string, ValueState> = {};
  for (const column of table?.columns ?? []) {
    const current = rowValue(request.row, column.name);
    const input = current.found ? inputFromValue(current.value) : { mode: 'auto' as const, text: '' };
    // Duplicar leva tudo menos a chave (a nova linha precisa de outra); editar começa sem nada marcado.
    const include = request.kind === 'insert' && current.found && !column.primaryKey;
    values[column.name] = { include, ...input };
  }
  return values;
}

function initialConditions(table: DbTable | undefined, request: BuilderRequest): SqlCondition[] {
  if (!table) return [];
  if (request.row) return conditionsForRow(table, request.row.columns, request.row.values).conditions;
  if (request.kind === 'update' || request.kind === 'delete')
    return table.columns
      .filter((c) => c.primaryKey)
      .map((c) => ({ column: c.name, operator: 'eq', value: '' }));
  return [];
}

function SqlBuilderForm({ request }: { request: BuilderRequest }) {
  const view = useConnection(request.connectionId);
  const schema = useDatabases((s) => s.schemas[request.connectionId]);
  const engine = view?.config.engine ?? 'firebird';
  const allTables = schema?.tables ?? [];

  const [kind, setKind] = useState<SqlCommandKind>(request.kind);
  const tables = kind === 'select' ? allTables : allTables.filter((t) => t.kind === 'table');
  const [tableName, setTableName] = useState(request.tableName ?? tables[0]?.name ?? '');
  const [tableQuery, setTableQuery] = useState(tableName);
  const table = allTables.find((t) => t.name === tableName);

  const [values, setValues] = useState(() => initialValues(table, request));
  const [conditions, setConditions] = useState(() => initialConditions(table, request));
  const [selectColumns, setSelectColumns] = useState<readonly string[]>([]);
  const [orderBy, setOrderBy] = useState('');
  const [desc, setDesc] = useState(false);
  const [limit, setLimit] = useState('100');
  const [withCheck, setWithCheck] = useState(true);
  const [confirmAll, setConfirmAll] = useState(false);
  const [copied, setCopied] = useState(false);

  const byPrimaryKey = useMemo(
    () =>
      table && request.row
        ? conditionsForRow(table, request.row.columns, request.row.values).byPrimaryKey
        : true,
    [table, request.row],
  );

  function chooseTable(name: string) {
    setTableQuery(name);
    const next = allTables.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
    if (!next || next.name === tableName) return;
    setTableName(next.name);
    const fresh = { ...request, row: undefined, kind };
    setValues(initialValues(next, fresh));
    setConditions(initialConditions(next, fresh));
    setSelectColumns([]);
    setOrderBy('');
    setConfirmAll(false);
  }

  const writing = kind !== 'select';
  const wrongKind = writing && table?.kind === 'view';

  const built = useMemo(() => {
    if (!table || wrongKind) return null;
    return buildSqlCommand(engine, {
      kind,
      table,
      columns: selectColumns,
      values: Object.entries(values)
        .filter(([, v]) => v.include)
        .map(([column, v]) => ({ column, value: { mode: v.mode, text: v.text } })),
      where: conditions,
      orderBy: orderBy ? { column: orderBy, desc } : null,
      limit: Number(limit) || null,
      withCheck,
    });
  }, [engine, kind, table, wrongKind, selectColumns, values, conditions, orderBy, desc, limit, withCheck]);

  const blocked = !built || built.problems.length > 0 || (built.affectsAll && !confirmAll);
  const readOnlyWrite = writing && view?.config.readOnly;

  function insert() {
    if (!built || blocked) return;
    const { sql } = built;
    // Fecha antes: o diálogo aberto seguraria o foco longe do editor.
    close();
    // O Radix devolve o foco ao fechar: espera isso acontecer antes de focar o editor.
    setTimeout(() => appendToSqlEditor(request.connectionId, sql), 60);
    toast.info(
      readOnlyWrite
        ? 'Comando no editor. A conexão é somente leitura: para rodar, libere a escrita em Editar conexão.'
        : 'Comando no editor: confira e rode com Ctrl+Enter.',
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={view ? `Montar comando SQL · ${view.config.name}` : 'Montar comando SQL'}
      className="h-[min(720px,90vh)] w-[min(1080px,95vw)]"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <div className="flex rounded-md bg-surface-2 p-0.5" role="tablist">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="tab"
              aria-selected={kind === k.id}
              onClick={() => {
                setKind(k.id);
                setConfirmAll(false);
              }}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded px-3 text-xs transition-colors',
                kind === k.id ? 'bg-elevated text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
              )}
            >
              {k.label}
              <span className="font-mono text-2xs text-fg-subtle">{k.hint}</span>
            </button>
          ))}
        </div>
        <label htmlFor="sql-builder-table" className="ml-2 text-xs text-fg-muted">
          Tabela
        </label>
        <div className="w-64">
          <TextInput
            id="sql-builder-table"
            list="sql-builder-tables"
            value={tableQuery}
            onChange={(e) => chooseTable(e.target.value)}
            onBlur={() => setTableQuery(tableName)}
            placeholder="Digite para procurar"
            spellCheck={false}
            className="h-7 font-mono text-xs"
          />
        </div>
        <datalist id="sql-builder-tables">
          {tables.map((t) => (
            <option key={t.name} value={t.name} />
          ))}
        </datalist>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            close();
            openSqlExamples(request.connectionId);
          }}
        >
          <BookOpen className="size-3.5" /> Exemplos
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-3">
          {!schema ? (
            <p className="text-xs text-fg-muted">Conecte ao banco para ver as tabelas.</p>
          ) : !table ? (
            <p className="text-xs text-fg-muted">Escolha a tabela no campo acima.</p>
          ) : wrongKind ? (
            <p className="text-xs text-fg-muted">
              {table.name} é uma view: dá para consultar, mas inserir, alterar e excluir é na tabela de
              origem.
            </p>
          ) : (
            <div className="space-y-5">
              {kind === 'select' && (
                <SelectOptions
                  table={table}
                  columns={selectColumns}
                  onColumns={setSelectColumns}
                  orderBy={orderBy}
                  onOrderBy={setOrderBy}
                  desc={desc}
                  onDesc={setDesc}
                  limit={limit}
                  onLimit={setLimit}
                />
              )}
              {(kind === 'insert' || kind === 'update') && (
                <Section
                  title={kind === 'insert' ? 'Valores da nova linha' : 'O que mudar (SET)'}
                  hint={
                    kind === 'insert'
                      ? 'Marque as colunas que vai preencher. As obrigatórias estão destacadas.'
                      : 'Digite o novo valor: a coluna é marcada sozinha. Só as marcadas mudam.'
                  }
                >
                  <ValuesEditor
                    table={table}
                    values={values}
                    onChange={setValues}
                    highlightRequired={kind === 'insert'}
                  />
                </Section>
              )}
              {kind !== 'insert' && (
                <Section
                  title={kind === 'select' ? 'Filtros (WHERE)' : 'Em quais linhas (WHERE)'}
                  hint={
                    kind === 'select'
                      ? 'Sem filtro, traz as linhas da tabela até o limite.'
                      : 'Use a chave (🔑) para atingir uma linha só.'
                  }
                >
                  {!byPrimaryKey && (
                    <p className="mb-2 flex items-start gap-1.5 text-2xs text-warning">
                      <AlertTriangle className="mt-px size-3 shrink-0" />A consulta não trouxe a chave
                      primária: a condição usa as colunas da linha e pode atingir mais de uma linha iguais.
                    </p>
                  )}
                  <ConditionsEditor table={table} conditions={conditions} onChange={setConditions} />
                </Section>
              )}
            </div>
          )}
        </div>

        <div className="flex w-[44%] min-w-0 shrink-0 flex-col border-l border-border bg-surface">
          <p className="shrink-0 px-4 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
            Comando
          </p>
          <pre className="mx-4 min-h-24 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-3 font-mono text-xs text-fg">
            {built?.sql ?? ''}
          </pre>
          <div className="shrink-0 space-y-2 px-4 py-3 text-xs">
            {built && <p className="text-fg">{built.explanation}</p>}
            {built?.problems.map((p) => (
              <p key={p} className="flex items-start gap-1.5 text-danger">
                <X className="mt-0.5 size-3 shrink-0" />
                {p}
              </p>
            ))}
            {built?.warnings.map((w) => (
              <p key={w} className="flex items-start gap-1.5 text-warning">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {w}
              </p>
            ))}
            {built?.affectsAll && (
              <span className="flex items-center gap-2 text-fg">
                <Checkbox checked={confirmAll} onChange={setConfirmAll} label="Confirmo: todas as linhas" />
                Sei que o comando vale para todas as linhas
              </span>
            )}
            {(kind === 'update' || kind === 'delete') && !built?.affectsAll && (
              <span className="flex items-center gap-2 text-fg-muted">
                <Checkbox checked={withCheck} onChange={setWithCheck} label="SELECT de conferência" />
                Incluir antes um SELECT para conferir as linhas atingidas
              </span>
            )}
            {readOnlyWrite && (
              <p className="flex items-start gap-1.5 text-fg-muted">
                <Lock className="mt-0.5 size-3 shrink-0" />
                Esta conexão é somente leitura: o comando vai para o editor, mas só roda depois de liberar a
                escrita em Editar conexão.
              </p>
            )}
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-2.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={blocked}
              onClick={() => {
                if (!built) return;
                void navigator.clipboard.writeText(built.sql);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
            <Button size="sm" variant="primary" disabled={blocked} onClick={insert}>
              <SquarePen className="size-3.5" /> Inserir no editor
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-xs font-semibold text-fg">{title}</p>
      <p className="mb-2 text-2xs text-fg-subtle">{hint}</p>
      {children}
    </section>
  );
}

function ColumnLabel({ column, required }: { column: DbColumn; required: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={`${column.name} ${column.type}`}>
      {column.primaryKey ? (
        <KeyRound className="size-3 shrink-0 text-warning" />
      ) : (
        <span className="size-3 shrink-0" />
      )}
      <span className={cn('min-w-12 truncate font-mono text-xs', required ? 'text-fg' : 'text-fg-muted')}>
        {column.name}
      </span>
      {required && <span className="shrink-0 text-2xs text-warning">obrigatória</span>}
      <span className="ml-auto min-w-0 max-w-[55%] truncate pl-1 text-right font-mono text-2xs text-fg-subtle">
        {column.type}
      </span>
    </span>
  );
}

function ValuesEditor({
  table,
  values,
  onChange,
  highlightRequired,
}: {
  table: DbTable;
  values: Record<string, ValueState>;
  onChange: (values: Record<string, ValueState>) => void;
  highlightRequired: boolean;
}) {
  const set = (name: string, patch: Partial<ValueState>) => {
    const current = values[name] ?? { include: false, mode: 'auto' as const, text: '' };
    onChange({ ...values, [name]: { ...current, ...patch } });
  };
  return (
    <div className="space-y-1">
      {table.columns.map((column) => {
        const value = values[column.name] ?? { include: false, mode: 'auto' as const, text: '' };
        const required = highlightRequired && requiredColumn(column) && !value.include;
        return (
          <div
            key={column.name}
            className={cn(
              'grid grid-cols-[auto_minmax(0,15rem)_7.5rem_minmax(0,1fr)] items-center gap-2 rounded-md px-1.5 py-0.5',
              value.include && 'bg-primary-soft/40',
            )}
          >
            <Checkbox
              checked={value.include}
              onChange={(include) => set(column.name, { include })}
              label={`Incluir ${column.name}`}
            />
            <ColumnLabel column={column} required={required} />
            <Select
              value={value.mode}
              options={MODES}
              onChange={(mode) => set(column.name, { mode, include: true })}
              ariaLabel={`Tipo do valor de ${column.name}`}
              triggerClassName="w-full"
            />
            <TextInput
              value={value.mode === 'null' ? '' : value.text}
              // Digitar num campo NULL volta para "Valor" (o valor atual da linha pode ser NULL).
              onChange={(e) =>
                set(column.name, {
                  text: e.target.value,
                  include: true,
                  ...(value.mode === 'null' ? { mode: 'auto' as const } : {}),
                })
              }
              placeholder={
                value.mode === 'null'
                  ? 'NULL (digite para trocar)'
                  : value.mode === 'sql'
                    ? 'ex.: CURRENT_DATE'
                    : column.defaultValue
                      ? `padrão: ${column.defaultValue}`
                      : ''
              }
              spellCheck={false}
              aria-label={`Valor de ${column.name}`}
              className="h-7 font-mono text-xs"
            />
          </div>
        );
      })}
    </div>
  );
}

function ConditionsEditor({
  table,
  conditions,
  onChange,
}: {
  table: DbTable;
  conditions: SqlCondition[];
  onChange: (conditions: SqlCondition[]) => void;
}) {
  const columns = table.columns.map((c) => ({ value: c.name, label: c.name }));
  const update = (index: number, patch: Partial<SqlCondition>) =>
    onChange(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-1.5">
      {conditions.map((condition, index) => {
        const needsValue = SQL_OPERATORS.find((o) => o.id === condition.operator)?.needsValue ?? true;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a lista só muda por estes botões
          <div key={index} className="flex items-center gap-2">
            <span className="w-6 shrink-0 text-right text-2xs text-fg-subtle">
              {index === 0 ? 'onde' : 'e'}
            </span>
            <Select
              value={condition.column}
              options={columns}
              onChange={(column) => update(index, { column })}
              ariaLabel="Coluna"
              triggerClassName="w-48 font-mono"
            />
            <Select<SqlOperator>
              value={condition.operator}
              options={SQL_OPERATORS.map((o) => ({ value: o.id, label: o.label }))}
              onChange={(operator) => update(index, { operator })}
              ariaLabel="Comparação"
              triggerClassName="w-40"
            />
            {needsValue ? (
              <TextInput
                value={condition.value}
                onChange={(e) => update(index, { value: e.target.value })}
                placeholder="valor"
                spellCheck={false}
                aria-label="Valor da condição"
                className="h-7 min-w-0 flex-1 font-mono text-xs"
              />
            ) : (
              <span className="flex-1" />
            )}
            <IconButton
              icon={X}
              label="Tirar condição"
              size="sm"
              onClick={() => onChange(conditions.filter((_, i) => i !== index))}
            />
          </div>
        );
      })}
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          onChange([...conditions, { column: table.columns[0]?.name ?? '', operator: 'eq', value: '' }])
        }
      >
        <Plus className="size-3.5" /> Condição
      </Button>
    </div>
  );
}

function SelectOptions({
  table,
  columns,
  onColumns,
  orderBy,
  onOrderBy,
  desc,
  onDesc,
  limit,
  onLimit,
}: {
  table: DbTable;
  columns: readonly string[];
  onColumns: (columns: readonly string[]) => void;
  orderBy: string;
  onOrderBy: (column: string) => void;
  desc: boolean;
  onDesc: (desc: boolean) => void;
  limit: string;
  onLimit: (limit: string) => void;
}) {
  const toggle = (name: string) =>
    onColumns(columns.includes(name) ? columns.filter((c) => c !== name) : [...columns, name]);
  return (
    <>
      <Section title="Colunas" hint="Nenhuma marcada = todas (*).">
        <div className="flex flex-wrap gap-1">
          {table.columns.map((column) => {
            const on = columns.includes(column.name);
            return (
              <button
                key={column.name}
                type="button"
                onClick={() => toggle(column.name)}
                className={cn(
                  'h-6 rounded-md border px-2 font-mono text-2xs transition-colors',
                  on
                    ? 'border-primary bg-primary-soft text-fg'
                    : 'border-border text-fg-muted hover:border-border-strong hover:text-fg',
                )}
              >
                {column.name}
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Ordem e limite" hint="Ordem vazia = como o banco devolver.">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={orderBy}
            options={[
              { value: '', label: '(sem ordem)' },
              ...table.columns.map((c) => ({ value: c.name, label: c.name })),
            ]}
            onChange={onOrderBy}
            ariaLabel="Ordenar por"
            triggerClassName="w-48 font-mono"
          />
          <Select
            value={desc ? 'desc' : 'asc'}
            options={[
              { value: 'asc', label: 'Crescente (A→Z, 1→9)' },
              { value: 'desc', label: 'Decrescente (Z→A, 9→1)' },
            ]}
            onChange={(v) => onDesc(v === 'desc')}
            ariaLabel="Direção"
            triggerClassName="w-48"
          />
          <span className="ml-2 text-xs text-fg-muted">Até</span>
          <TextInput
            value={limit}
            onChange={(e) => onLimit(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            aria-label="Limite de linhas"
            className="h-7 w-20 text-xs"
          />
          <span className="text-xs text-fg-muted">linhas (vazio = sem limite)</span>
        </div>
      </Section>
    </>
  );
}
