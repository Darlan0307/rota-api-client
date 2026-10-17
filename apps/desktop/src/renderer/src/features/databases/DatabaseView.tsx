import { type DbSchema, type DbTable, isReadQuery, statementAt } from '@rota/core/shared';
import {
  AlertTriangle,
  ChevronRight,
  Database,
  Eye,
  KeyRound,
  Link2,
  LoaderCircle,
  Lock,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Square,
  Table2,
  Unplug,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, useDefaultLayout } from 'react-resizable-panels';
import { Button } from '../../components/Button';
import { CodeEditor } from '../../components/CodeEditor';
import { EmptyState } from '../../components/EmptyState';
import { Select } from '../../components/form';
import { IconButton } from '../../components/IconButton';
import { Kbd } from '../../components/Kbd';
import { ResizeHandle } from '../../layout/ResizeHandle';
import { cn } from '../../lib/cn';
import type { monaco } from '../../lib/monaco';
import { confirmDialog } from '../../state/dialogs';
import { type DatabaseTab, useTabs } from '../../state/tabs';
import { ConnectionDot, EnvironmentBadge } from './DatabasesPanel';
import { ResultGrid } from './ResultGrid';
import { bindSqlEditor } from './sql-completion';
import {
  cancelQuery,
  disconnect,
  loadSchema,
  openConnectionDialog,
  queryOf,
  runQuery,
  updateQuery,
  useConnection,
  useDatabases,
} from './state';

const LIMITS = ['100', '500', '1000', '5000'] as const;
const LIMIT_KEY = 'rota:db-limit';

function savedLimit(): (typeof LIMITS)[number] {
  try {
    const value = localStorage.getItem(LIMIT_KEY);
    return LIMITS.find((l) => l === value) ?? '500';
  } catch {
    return '500';
  }
}

/** Página de uma conexão: estrutura do banco, editor SQL e resultado. */
export function DatabaseTabView({ tab }: { tab: DatabaseTab }) {
  const id = tab.itemId ?? '';
  const view = useConnection(id);
  const loaded = useDatabases((s) => s.loaded);
  const schema = useDatabases((s) => s.schemas[id]);
  const schemaError = useDatabases((s) => s.schemaErrors[id]);
  const update = useTabs((s) => s.update);
  const layout = useDefaultLayout({ id: 'database-schema', storage: localStorage });
  const editorLayout = useDefaultLayout({ id: 'database-editor', storage: localStorage });
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const name = view?.config.name;
  useEffect(() => {
    if (name && name !== tab.title) update<DatabaseTab>(tab.id, (t) => ({ ...t, title: name }));
  }, [name, tab.id, tab.title, update]);

  // Abre a aba já conectando, se houver senha.
  const canConnect = Boolean(view?.hasPassword);
  useEffect(() => {
    if (canConnect && !schema && !schemaError) void loadSchema(id);
  }, [canConnect, schema, schemaError, id]);

  if (!view && !loaded) return null;
  if (!view)
    return (
      <EmptyState icon={Unplug} title="Conexão não encontrada" description="Ela pode ter sido excluída." />
    );

  function insert(text: string) {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = editor.getSelection();
    if (selection) editor.executeEdits('rota', [{ range: selection, text, forceMoveMarkers: true }]);
    editor.focus();
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <Header id={id} />
      {!view.config.readOnly && view.config.environment === 'producao' && (
        <div className="flex shrink-0 items-center gap-2 border-y border-danger/40 bg-danger/5 px-5 py-1.5 text-xs text-fg">
          <AlertTriangle className="size-3.5 shrink-0 text-danger" />
          Banco de produção com escrita liberada. Comandos que alteram dados pedem confirmação.
        </div>
      )}
      {!view.hasPassword ? (
        <EmptyState
          icon={KeyRound}
          title="Falta a senha"
          description="Informe a senha desta conexão (ou escolha uma credencial salva) para conectar."
          action={
            <Button variant="primary" size="sm" onClick={() => openConnectionDialog(id)}>
              <Pencil className="size-3.5" /> Editar conexão
            </Button>
          }
        />
      ) : (
        <div className="min-h-0 flex-1 border-t border-border">
          <Group
            orientation="horizontal"
            defaultLayout={layout.defaultLayout}
            onLayoutChanged={layout.onLayoutChanged}
            className="h-full"
          >
            <Panel id="schema" minSize="14%" defaultSize="24%">
              <SchemaTree
                connectionId={id}
                schema={schema}
                error={schemaError}
                connecting={view.status === 'connecting'}
                onInsert={insert}
              />
            </Panel>
            <ResizeHandle />
            <Panel id="main" minSize="40%" defaultSize="76%">
              <Group
                orientation="vertical"
                defaultLayout={editorLayout.defaultLayout}
                onLayoutChanged={editorLayout.onLayoutChanged}
                className="h-full"
              >
                <Panel id="editor" minSize="15%" defaultSize="38%">
                  <SqlEditor id={id} editorRef={editorRef} />
                </Panel>
                <ResizeHandle vertical />
                <Panel id="result" minSize="20%" defaultSize="62%">
                  <ResultArea id={id} name={view.config.name} />
                </Panel>
              </Group>
            </Panel>
          </Group>
        </div>
      )}
    </div>
  );
}

function Header({ id }: { id: string }) {
  const view = useConnection(id);
  if (!view) return null;
  const { config, status, info } = view;
  const connected = status === 'connected';
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 px-5">
      <ConnectionDot status={status} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[15px] font-semibold text-fg">
          <span className="truncate">{config.name}</span>
          <EnvironmentBadge environment={config.environment} />
          {config.readOnly && (
            <span className="flex shrink-0 items-center gap-1 text-2xs font-normal text-fg-muted">
              <Lock className="size-3" /> somente leitura
            </span>
          )}
        </p>
        <p className="truncate font-mono text-2xs text-fg-subtle">
          {config.host}:{config.port} · {config.database}
          {info && ` · Firebird ${info.version} · ${info.connectionCharset}`}
        </p>
      </div>
      <Button size="sm" variant="ghost" onClick={() => openConnectionDialog(id)}>
        <Pencil className="size-3.5" /> Editar
      </Button>
      {connected ? (
        <Button size="sm" onClick={() => void disconnect(id)}>
          <Unplug className="size-3.5" /> Desconectar
        </Button>
      ) : (
        <Button
          size="sm"
          variant="primary"
          disabled={status === 'connecting' || !view.hasPassword}
          onClick={() => void loadSchema(id)}
        >
          {status === 'connecting' ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Database className="size-3.5" />
          )}
          Conectar
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estrutura do banco

function SchemaTree({
  connectionId,
  schema,
  error,
  connecting,
  onInsert,
}: {
  connectionId: string;
  schema: DbSchema | undefined;
  error: string | undefined;
  connecting: boolean;
  onInsert: (text: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const q = filter.trim().toUpperCase();
  const tables = useMemo(
    () =>
      (schema?.tables ?? []).filter(
        (t) => !q || t.name.includes(q) || t.columns.some((c) => c.name.includes(q)),
      ),
    [schema, q],
  );

  function query(table: DbTable) {
    const sql = `SELECT FIRST 100 * FROM ${table.name}`;
    updateQuery(connectionId, { sql });
    void runQuery(connectionId, sql, 100);
  }

  let body: React.ReactNode;
  if (error && !schema) {
    body = (
      <div className="space-y-3 p-3 text-xs">
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-fg">{error}</div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void loadSchema(connectionId)}>
            <RefreshCw className="size-3.5" /> Tentar de novo
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openConnectionDialog(connectionId)}>
            Editar conexão
          </Button>
        </div>
      </div>
    );
  } else if (!schema) {
    body = (
      <div className="flex items-center gap-2 p-4 text-xs text-fg-muted">
        <LoaderCircle className="size-4 animate-spin text-primary" />
        {connecting ? 'Conectando…' : 'Lendo a estrutura do banco…'}
      </div>
    );
  } else {
    const groups: [string, DbTable[]][] = [
      ['Tabelas', tables.filter((t) => t.kind === 'table')],
      ['Views', tables.filter((t) => t.kind === 'view')],
    ];
    body = (
      <div className="pb-4">
        {groups.map(([label, list]) => (
          <div key={label}>
            <p className="px-3 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
              {label} <span className="font-mono font-normal">{list.length}</span>
            </p>
            <ul>
              {list.map((table) => {
                const expanded = open[table.name] ?? (q !== '' && !table.name.includes(q));
                const Icon = table.kind === 'view' ? Eye : Table2;
                return (
                  <li key={table.name}>
                    <div className="group flex items-center gap-1 pr-1 hover:bg-surface-2/60">
                      <button
                        type="button"
                        onClick={() => setOpen((o) => ({ ...o, [table.name]: !expanded }))}
                        onDoubleClick={() => onInsert(table.name)}
                        title="Clique para ver as colunas; duplo clique insere o nome no editor"
                        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-2 text-left"
                      >
                        <ChevronRight
                          className={cn(
                            'size-3 shrink-0 text-fg-subtle transition-transform',
                            expanded && 'rotate-90',
                          )}
                        />
                        <Icon className="size-3.5 shrink-0 text-fg-subtle" />
                        <span className="truncate font-mono text-xs text-fg">{table.name}</span>
                      </button>
                      <IconButton
                        icon={Play}
                        label={`Consultar ${table.name} (100 linhas)`}
                        size="sm"
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => query(table)}
                      />
                    </div>
                    {expanded && (
                      <ul className="pb-1">
                        {table.columns.map((column) => (
                          <li key={column.name}>
                            <button
                              type="button"
                              onClick={() => onInsert(column.name)}
                              title={`${column.name} ${column.type}${column.nullable ? '' : ' NOT NULL'}${
                                column.defaultValue ? ` DEFAULT ${column.defaultValue}` : ''
                              }${column.references ? ` → ${column.references}` : ''}\nClique para inserir no editor`}
                              className={cn(
                                'flex w-full items-center gap-1.5 py-0.5 pl-9 pr-2 text-left hover:bg-surface-2/60',
                                q && column.name.includes(q) && 'bg-primary-soft/40',
                              )}
                            >
                              {column.primaryKey ? (
                                <KeyRound className="size-3 shrink-0 text-warning" />
                              ) : column.references ? (
                                <Link2 className="size-3 shrink-0 text-primary" />
                              ) : (
                                <span className="size-3 shrink-0" />
                              )}
                              <span className="truncate font-mono text-xs text-fg">{column.name}</span>
                              <span className="ml-auto shrink-0 font-mono text-2xs text-fg-subtle">
                                {column.type}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
              {list.length === 0 && <li className="px-3 py-1 text-2xs text-fg-subtle">Nenhuma.</li>}
            </ul>
          </div>
        ))}
        {(schema.procedures.length > 0 || schema.generators.length > 0) && (
          <details className="px-3 pt-3 text-xs">
            <summary className="cursor-pointer select-none text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
              Procedures e generators
            </summary>
            <ul className="mt-1 space-y-0.5 font-mono text-fg-muted">
              {schema.procedures.map((p) => (
                <li key={`p-${p}`} className="truncate">
                  {p}()
                </li>
              ))}
              {schema.generators.map((g) => (
                <li key={`g-${g}`} className="truncate text-fg-subtle">
                  {g}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-1 p-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
            placeholder="Tabela ou coluna"
            spellCheck={false}
            className="h-7 w-full rounded-md border border-transparent bg-surface-2 pl-7 pr-2 text-xs text-fg outline-none placeholder:text-fg-subtle focus:border-border-strong"
          />
        </div>
        <IconButton
          icon={RefreshCw}
          label="Recarregar estrutura"
          size="sm"
          onClick={() => void loadSchema(connectionId)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor

function SqlEditor({
  id,
  editorRef,
}: {
  id: string;
  editorRef: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>;
}) {
  const view = useConnection(id);
  const sql = useDatabases((s) => s.queries[id]?.sql) ?? queryOf(id).sql;
  const [limit, setLimit] = useState(savedLimit);
  const running = view?.running ?? false;

  async function execute() {
    if (!view) return;
    const editor = editorRef.current;
    const model = editor?.getModel();
    let text = sql;
    if (editor && model) {
      const selection = editor.getSelection();
      const position = editor.getPosition();
      if (selection && !selection.isEmpty()) text = model.getValueInRange(selection);
      else if (position) text = statementAt(model.getValue(), model.getOffsetAt(position))?.text ?? sql;
    }
    text = text.trim().replace(/;+$/, '');
    if (!text) return;
    if (!view.config.readOnly && view.config.environment === 'producao' && !isReadQuery(text)) {
      const choice = await confirmDialog({
        title: 'Executar em produção?',
        description: `Este comando pode alterar o banco "${view.config.name}" (produção):\n\n${text.slice(0, 400)}`,
        confirmLabel: 'Executar',
        danger: true,
      });
      if (choice !== 'confirm') return;
    }
    await runQuery(id, text, Number(limit));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        {running ? (
          <Button size="sm" onClick={() => void cancelQuery(id)}>
            <Square className="size-3.5" /> Cancelar
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => void execute()}>
            <Play className="size-3.5" /> Executar
          </Button>
        )}
        <span className="hidden text-2xs text-fg-subtle xl:inline">
          <Kbd keys="Ctrl+Enter" /> roda a seleção ou o comando onde está o cursor
        </span>
        <div className="flex-1" />
        <span className="text-2xs text-fg-subtle">Até</span>
        <Select
          value={limit}
          options={LIMITS.map((l) => ({ value: l, label: `${l} linhas` }))}
          onChange={(value) => {
            setLimit(value);
            try {
              localStorage.setItem(LIMIT_KEY, value);
            } catch {
              // Sem localStorage: vale só nesta sessão.
            }
          }}
          ariaLabel="Limite de linhas"
          align="end"
        />
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor
          value={sql}
          onChange={(value) => updateQuery(id, { sql: value })}
          language="sql"
          placeholder="SELECT FIRST 100 * FROM ... (Ctrl+Espaço sugere tabelas e colunas)"
          onEditor={(editor) => {
            editorRef.current = editor;
            bindSqlEditor(editor, id);
          }}
          onShortcut={(shortcut) => shortcut === 'send' && void execute()}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resultado

function ResultArea({ id, name }: { id: string; name: string }) {
  const query = useDatabases((s) => s.queries[id]);
  const running = useConnection(id)?.running ?? false;

  if (query?.error)
    return (
      <div className="space-y-2 p-4 text-xs">
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-fg">
          <p className="whitespace-pre-wrap">{query.error}</p>
        </div>
        {query.ranSql && (
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-surface p-2 font-mono text-2xs text-fg-subtle">
            {query.ranSql}
          </pre>
        )}
      </div>
    );
  if (running && !query?.result)
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-fg-muted">
        <LoaderCircle className="size-4 animate-spin text-primary" /> Executando…
      </div>
    );
  if (!query?.result)
    return (
      <EmptyState
        icon={Table2}
        title="Nenhum resultado ainda"
        description="Escreva uma consulta e execute, ou passe o mouse numa tabela à esquerda e clique em ▶."
      />
    );
  if (query.result.affected !== undefined)
    return (
      <div className="p-4 text-xs text-fg">
        Comando executado: {query.result.affected}{' '}
        {query.result.affected === 1 ? 'linha afetada' : 'linhas afetadas'} ({query.result.durationMs} ms).
      </div>
    );
  return (
    <div className={cn('h-full', running && 'opacity-60')}>
      <ResultGrid key={query.ranSql ?? ''} result={query.result} name={name} />
    </div>
  );
}
