import {
  type DbEngine,
  type DbSchema,
  type DbTable,
  type DbValue,
  editableTableFor,
  isReadQuery,
  previewSql,
  quoteIdentifier,
  splitSqlStatements,
  statementAt,
} from '@rota/core/shared';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Braces,
  ChevronRight,
  CopyPlus,
  Database,
  Eye,
  FileText,
  Filter,
  KeyRound,
  Link2,
  ListOrdered,
  LoaderCircle,
  Lock,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PackagePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  SquarePen,
  Table2,
  Trash2,
  Unplug,
  Wand2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, useDefaultLayout } from 'react-resizable-panels';
import { ContextActions, DropdownActions, type MenuEntry } from '../../components/ActionMenu';
import { Button } from '../../components/Button';
import { CodeEditor } from '../../components/CodeEditor';
import { EmptyState } from '../../components/EmptyState';
import { Select } from '../../components/form';
import { IconButton } from '../../components/IconButton';
import { Kbd } from '../../components/Kbd';
import { ResizeHandle } from '../../layout/ResizeHandle';
import { errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { monaco } from '../../lib/monaco';
import { useCollapsiblePanel } from '../../lib/use-collapsible-panel';
import { confirmDialog } from '../../state/dialogs';
import { type DatabaseTab, useTabs } from '../../state/tabs';
import { toast } from '../../state/toasts';
import { addProfileToPack, addTablesToPack } from '../context-pack/state';
import { openTypesForTable } from '../types/TypesDialog';
import { EngineStatusIcon, EnvironmentBadge } from './DatabasesPanel';
import { ProfileView } from './ProfileView';
import { cancelProfile, closeProfile, runProfile, showProfile, useProfiles } from './profile-state';
import { QueryHistory } from './QueryHistory';
import { ResultGrid } from './ResultGrid';
import { openSqlBuilder } from './SqlBuilderDialog';
import { openSqlExamples } from './SqlExamplesDialog';
import { bindSqlEditor } from './sql-completion';
import { registerSqlEditor } from './sql-editors';
import {
  cancelQueries,
  disconnect,
  loadSchema,
  openConnectionDialog,
  type QueryStep,
  queryOf,
  runQueries,
  runQuery,
  sequenceRunning,
  showStep,
  updateQuery,
  useConnection,
  useDatabases,
} from './state';
import { copyTablesMarkdown, sampleTables } from './table-actions';

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
  const schemaPane = useCollapsiblePanel({ collapsedPx: 0, fallbackSize: '24%' });
  const editorPane = useCollapsiblePanel({ collapsedPx: EDITOR_TOOLBAR_PX, fallbackSize: '38%' });
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
            <Panel
              id="schema"
              collapsible
              collapsedSize={0}
              minSize="14%"
              defaultSize="24%"
              {...schemaPane.panelProps}
            >
              <SchemaTree
                connectionId={id}
                engine={view.config.engine}
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
                <Panel
                  id="editor"
                  collapsible
                  collapsedSize={EDITOR_TOOLBAR_PX}
                  minSize="15%"
                  defaultSize="38%"
                  {...editorPane.panelProps}
                >
                  <SqlEditor
                    id={id}
                    editorRef={editorRef}
                    schemaHidden={schemaPane.collapsed}
                    onToggleSchema={schemaPane.toggle}
                    resultMaximized={editorPane.collapsed}
                    onToggleResult={editorPane.toggle}
                  />
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
      <EngineStatusIcon engine={config.engine} status={status} ring="ring-bg" />
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
          {info && ` · ${info.version}${info.connectionCharset ? ` · ${info.connectionCharset}` : ''}`}
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

const matches = (name: string, q: string) => name.toLowerCase().includes(q);

function SchemaTree({
  connectionId,
  engine,
  schema,
  error,
  connecting,
  onInsert,
}: {
  connectionId: string;
  engine: DbEngine;
  schema: DbSchema | undefined;
  error: string | undefined;
  connecting: boolean;
  onInsert: (text: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Ctrl+clique marca várias tabelas para as ações em lote (copiar estrutura...).
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Nomes vêm em maiúsculas (Firebird) ou minúsculas (PostgreSQL): compara sem caixa.
  const q = filter.trim().toLowerCase();
  const tables = useMemo(
    () =>
      (schema?.tables ?? []).filter(
        (t) => !q || matches(t.name, q) || t.columns.some((c) => matches(c.name, q)),
      ),
    [schema, q],
  );

  function query(table: DbTable) {
    const sql = previewSql(engine, table.ref);
    showProfile(connectionId, false);
    updateQuery(connectionId, { sql });
    void runQuery(connectionId, sql, 100);
  }

  /** A tabela clicada, ou todas as marcadas se ela estiver entre elas. */
  function targetsOf(table: DbTable): DbTable[] {
    if (!selected.has(table.name) || selected.size < 2) return [table];
    return (schema?.tables ?? []).filter((t) => selected.has(t.name));
  }

  function builderEntries(table: DbTable): MenuEntry[] {
    const open = (kind: 'select' | 'insert' | 'update' | 'delete') => () =>
      openSqlBuilder({ connectionId, kind, tableName: table.name });
    return [
      { label: 'Consultar com filtros…', icon: Filter, onSelect: open('select') },
      ...(table.kind === 'table'
        ? [
            { label: 'Inserir linha (INSERT)…', icon: Plus, onSelect: open('insert') },
            { label: 'Alterar linhas (UPDATE)…', icon: SquarePen, onSelect: open('update') },
            { label: 'Excluir linhas (DELETE)…', icon: Trash2, onSelect: open('delete') },
          ]
        : []),
      'separator' as const,
    ];
  }

  function entriesFor(table: DbTable): MenuEntry[] {
    const targets = targetsOf(table);
    const many = targets.length > 1;
    const suffix = many ? ` (${targets.length} tabelas)` : '';
    return [
      ...(many
        ? []
        : [
            { label: 'Consultar (100 linhas)', icon: Play, onSelect: () => query(table) },
            'separator' as const,
            ...builderEntries(table),
          ]),
      {
        label: `Copiar estrutura em Markdown${suffix}`,
        icon: FileText,
        onSelect: () => void copyTablesMarkdown(connectionId, engine, targets),
      },
      {
        label: `Copiar estrutura + 10 linhas${suffix}`,
        icon: FileText,
        onSelect: () => void copyTablesMarkdown(connectionId, engine, targets, 10),
      },
      'separator' as const,
      {
        label: `Adicionar ao pacote${suffix}`,
        icon: PackagePlus,
        onSelect: () => addTablesToPack(engine, targets),
      },
      {
        label: `Adicionar ao pacote + 10 linhas${suffix}`,
        icon: PackagePlus,
        onSelect: () =>
          void sampleTables(connectionId, engine, targets, 10).then(
            (samples) => addTablesToPack(engine, targets, samples),
            (error: unknown) => toast.error(errorMessage(error)),
          ),
      },
      ...(many
        ? []
        : [
            {
              label: 'Analisar tabela (perfil das colunas)',
              icon: Activity,
              onSelect: () => void runProfile(connectionId, engine, table),
            },
            { label: 'Gerar tipo TypeScript', icon: Braces, onSelect: () => openTypesForTable(table) },
          ]),
    ];
  }

  function toggleSelected(name: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
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
                const expanded = open[table.name] ?? (q !== '' && !matches(table.name, q));
                const Icon = table.kind === 'view' ? Eye : Table2;
                return (
                  <li key={table.name}>
                    <ContextActions entries={entriesFor(table)}>
                      <div
                        className={cn(
                          'group flex items-center gap-1 pr-1 hover:bg-surface-2/60',
                          selected.has(table.name) && 'bg-primary-soft hover:bg-primary-soft',
                        )}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            if (e.ctrlKey || e.metaKey) toggleSelected(table.name);
                            else {
                              if (selected.size > 0) setSelected(new Set());
                              setOpen((o) => ({ ...o, [table.name]: !expanded }));
                            }
                          }}
                          onDoubleClick={() => onInsert(table.ref)}
                          title="Clique para ver as colunas; duplo clique insere o nome no editor; Ctrl+clique marca várias; botão direito mostra as ações"
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
                        <DropdownActions
                          align="end"
                          entries={entriesFor(table)}
                          trigger={
                            <button
                              type="button"
                              aria-label={`Ações de ${table.name}`}
                              className="flex size-6 shrink-0 items-center justify-center rounded text-fg-subtle opacity-0 transition-opacity hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                            >
                              <MoreHorizontal className="size-3.5" />
                            </button>
                          }
                        />
                      </div>
                    </ContextActions>
                    {expanded && (
                      <ul className="pb-1">
                        {table.columns.map((column) => (
                          <li key={column.name}>
                            <button
                              type="button"
                              onClick={() => onInsert(quoteIdentifier(engine, column.name))}
                              title={`${column.name} ${column.type}${column.nullable ? '' : ' NOT NULL'}${
                                column.defaultValue ? ` DEFAULT ${column.defaultValue}` : ''
                              }${column.references ? ` → ${column.references}` : ''}\nClique para inserir no editor`}
                              className={cn(
                                'flex w-full items-center gap-1.5 py-0.5 pl-9 pr-2 text-left hover:bg-surface-2/60',
                                q && matches(column.name, q) && 'bg-primary-soft/40',
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

/** Altura da barra do editor SQL: é o que sobra dele com o resultado maximizado. */
const EDITOR_TOOLBAR_PX = 40;

function SqlEditor({
  id,
  editorRef,
  schemaHidden,
  onToggleSchema,
  resultMaximized,
  onToggleResult,
}: {
  id: string;
  editorRef: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>;
  schemaHidden: boolean;
  onToggleSchema: () => void;
  resultMaximized: boolean;
  onToggleResult: () => void;
}) {
  const view = useConnection(id);
  const sql = useDatabases((s) => s.queries[id]?.sql) ?? queryOf(id).sql;
  const [limit, setLimit] = useState(savedLimit);
  const inSequence = useDatabases((s) => sequenceRunning(s.queries[id]));
  // Entre dois comandos da sequência a conexão fica livre por um instante: o botão não pode voltar a "Executar".
  const running = (view?.running ?? false) || inSequence;

  const engine = view?.config.engine ?? 'firebird';

  /** Ctrl+Enter: a seleção (vários comandos rodam em sequência) ou o comando sob o cursor. */
  async function execute() {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return runStatements(splitSqlStatements(sql, engine).map((s) => s.text));
    const selection = editor.getSelection();
    const position = editor.getPosition();
    if (selection && !selection.isEmpty())
      return runStatements(splitSqlStatements(model.getValueInRange(selection), engine).map((s) => s.text));
    const text = model.getValue();
    const current = position ? statementAt(text, model.getOffsetAt(position), engine) : undefined;
    await runStatements(current ? [current.text] : []);
  }

  /** Ctrl+Shift+Enter: todos os comandos do editor, um depois do outro. */
  async function executeAll() {
    await runStatements(splitSqlStatements(sql, engine).map((s) => s.text));
  }
  const executeAllRef = useRef(executeAll);
  executeAllRef.current = executeAll;

  /** Confirma comandos de escrita em produção antes de executar (editor ou histórico). */
  async function runStatements(statements: string[]) {
    if (!view || running) return;
    if (statements.length === 0) {
      toast.info('Nada para executar: o trecho está vazio ou só tem comentários.');
      return;
    }
    const writes = statements.filter((s) => !isReadQuery(s, engine));
    if (!view.config.readOnly && view.config.environment === 'producao' && writes.length > 0) {
      const preview = writes
        .slice(0, 3)
        .map((s) => s.slice(0, 300))
        .join('\n\n');
      const choice = await confirmDialog({
        title: 'Executar em produção?',
        description:
          writes.length === 1
            ? `Este comando pode alterar o banco "${view.config.name}" (produção):\n\n${preview}`
            : `${writes.length} comandos podem alterar o banco "${view.config.name}" (produção). Eles rodam um por vez e param no primeiro erro (os anteriores continuam aplicados):\n\n${preview}${writes.length > 3 ? '\n\n…' : ''}`,
        confirmLabel: 'Executar',
        danger: true,
      });
      if (choice !== 'confirm') return;
    }
    showProfile(id, false);
    if (statements.length === 1) await runQuery(id, statements[0] as string, Number(limit));
    else await runQueries(id, statements, Number(limit));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <IconButton
          icon={schemaHidden ? PanelLeftOpen : PanelLeftClose}
          label={schemaHidden ? 'Mostrar a estrutura do banco' : 'Esconder a estrutura do banco'}
          size="sm"
          onClick={onToggleSchema}
        />
        {running ? (
          <Button
            size="sm"
            onClick={() => {
              // Com o perfil rodando, cancela a análise inteira (não só a consulta da vez).
              if (useProfiles.getState().byConnection[id]?.status === 'running') cancelProfile(id);
              else void cancelQueries(id);
            }}
          >
            <Square className="size-3.5" /> Cancelar
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              title="Executa a seleção ou o comando onde está o cursor (Ctrl+Enter)"
              onClick={() => void execute()}
            >
              <Play className="size-3.5" /> Executar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title="Executa todos os comandos do editor, um depois do outro, parando no primeiro erro (Ctrl+Shift+Enter)"
              onClick={() => void executeAll()}
            >
              <ListOrdered className="size-3.5" /> Executar tudo
            </Button>
          </>
        )}
        <QueryHistory
          connectionId={id}
          onPick={(text) => updateQuery(id, { sql: text })}
          onRun={(text) => {
            updateQuery(id, { sql: text });
            // Cada entrada do histórico é um comando só; o separador só tira o ";" do fim
            // (e entende corpo de procedure). Se ainda assim achar vários, vai inteiro como antes.
            const parts = splitSqlStatements(text, engine);
            void runStatements(
              parts.length === 1 ? [(parts[0] as { text: string }).text] : parts.length ? [text.trim()] : [],
            );
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          title="Monta SELECT, INSERT, UPDATE ou DELETE preenchendo um formulário"
          onClick={() => openSqlBuilder({ connectionId: id, kind: 'select' })}
        >
          <Wand2 className="size-3.5" /> Montar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title="Colinha de comandos SQL deste banco, prontos para preencher"
          onClick={() => openSqlExamples(id)}
        >
          <BookOpen className="size-3.5" /> Exemplos
        </Button>
        <span className="hidden text-2xs text-fg-subtle 2xl:inline">
          <Kbd keys="Ctrl+Enter" /> roda a seleção ou o comando onde está o cursor ·{' '}
          <Kbd keys="Ctrl+Shift+Enter" /> roda tudo
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
        <IconButton
          icon={resultMaximized ? Minimize2 : Maximize2}
          label={resultMaximized ? 'Mostrar o editor' : 'Maximizar o resultado (recolhe o editor)'}
          active={resultMaximized}
          size="sm"
          onClick={onToggleResult}
        />
      </div>
      {/* Recolhido, o editor continua montado: Executar e o histórico seguem funcionando. */}
      <div className={cn('min-h-0 flex-1', resultMaximized && 'hidden')}>
        <CodeEditor
          value={sql}
          onChange={(value) => updateQuery(id, { sql: value })}
          language="sql"
          placeholder={`${previewSql(view?.config.engine ?? 'firebird', '...')} (Ctrl+Espaço sugere tabelas e colunas)`}
          onEditor={(editor) => {
            editorRef.current = editor;
            bindSqlEditor(editor, id);
            registerSqlEditor(id, editor);
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
              void executeAllRef.current();
            });
          }}
          onShortcut={(shortcut) => shortcut === 'send' && void execute()}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resultado

/** Resultado da consulta e, se houver, o perfil de uma tabela (alternáveis). */
function ResultArea({ id, name }: { id: string; name: string }) {
  const profile = useProfiles((s) => s.byConnection[id]);
  const view = useConnection(id);
  const schema = useDatabases((s) => s.schemas[id]);
  if (!profile) return <QueryResultArea id={id} name={name} />;

  const retry = () => {
    const table = schema?.tables.find((t) => t.name === profile.table);
    if (table && view) void runProfile(id, view.config.engine, table);
  };
  const tab = (active: boolean, onClick: () => void, label: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'relative flex h-full items-center gap-1 text-xs transition-colors',
        active ? 'text-fg' : 'text-fg-muted hover:text-fg',
      )}
    >
      {label}
      {active && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-stretch gap-4 border-b border-border px-3" role="tablist">
        {tab(!profile.visible, () => showProfile(id, false), 'Resultado')}
        {tab(
          profile.visible,
          () => showProfile(id, true),
          <>
            Perfil: <span className="font-mono">{profile.table}</span>
          </>,
        )}
        <IconButton
          icon={X}
          label="Fechar o perfil"
          size="sm"
          className="self-center"
          onClick={() => closeProfile(id)}
        />
      </div>
      <div className="min-h-0 flex-1">
        {profile.visible ? (
          <ProfileView
            connectionId={id}
            state={profile}
            onRetry={retry}
            extraActions={(result) => (
              <Button size="sm" variant="ghost" onClick={() => addProfileToPack(result)}>
                <PackagePlus className="size-3.5" /> Adicionar ao pacote
              </Button>
            )}
          />
        ) : (
          <QueryResultArea id={id} name={name} />
        )}
      </div>
    </div>
  );
}

function stepSummary(step: QueryStep): string {
  switch (step.status) {
    case 'pending':
      return 'na fila';
    case 'running':
      return 'executando…';
    case 'skipped':
      return 'não executado';
    case 'error':
      return 'erro';
    case 'ok': {
      const r = step.result;
      if (!r) return 'ok';
      if (r.affected !== undefined)
        return `${r.affected} ${r.affected === 1 ? 'linha afetada' : 'linhas afetadas'}`;
      return `${r.rows.length}${r.truncated ? '+' : ''} ${r.rows.length === 1 ? 'linha' : 'linhas'}`;
    }
  }
}

/** O comando em uma linha, sem os comentários que vêm antes dele. */
function commandLabel(sql: string): string {
  const text = sql.replace(/^(?:\s*(?:--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/))+/, '');
  return (text || sql).replace(/\s+/g, ' ').trim().slice(0, 40);
}

/** Comandos de uma execução em sequência: clique para ver o resultado de cada um. */
function StepsBar({ id, steps, active }: { id: string; steps: QueryStep[]; active: number }) {
  const done = steps.filter((s) => s.status === 'ok').length;
  const failed = steps.some((s) => s.status === 'error');
  return (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-3 py-1.5">
      <span className="shrink-0 text-2xs text-fg-subtle">
        {done} de {steps.length} {failed ? '(parou no erro)' : ''}
      </span>
      {steps.map((step, i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: a lista é fixa durante a execução e o mesmo comando pode se repetir
          key={i}
          type="button"
          onClick={() => showStep(id, i)}
          title={step.sql}
          className={cn(
            'flex max-w-64 shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-2xs transition-colors',
            i === active
              ? 'border-primary bg-primary/10 text-fg'
              : 'border-border text-fg-muted hover:text-fg',
            step.status === 'error' && 'border-danger/60 text-danger',
            (step.status === 'skipped' || step.status === 'pending') && 'opacity-60',
          )}
        >
          {step.status === 'running' && <LoaderCircle className="size-3 animate-spin text-primary" />}
          {step.status === 'error' && <AlertTriangle className="size-3" />}
          <span className="font-mono">{i + 1}</span>
          <span className="truncate font-mono">{commandLabel(step.sql)}</span>
          <span className="shrink-0 text-fg-subtle">· {stepSummary(step)}</span>
        </button>
      ))}
    </div>
  );
}

function QueryResultArea({ id, name }: { id: string; name: string }) {
  const query = useDatabases((s) => s.queries[id]);
  const steps = query?.steps && query.steps.length > 1 ? query.steps : null;
  if (!steps) return <QueryResultBody id={id} name={name} />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <StepsBar id={id} steps={steps} active={query?.stepIndex ?? 0} />
      <div className="min-h-0 flex-1">
        <QueryResultBody id={id} name={name} />
      </div>
    </div>
  );
}

function QueryResultBody({ id, name }: { id: string; name: string }) {
  const query = useDatabases((s) => s.queries[id]);
  const schema = useDatabases((s) => s.schemas[id]);
  const view = useConnection(id);
  const running = view?.running ?? false;
  const ranSql = query?.ranSql ?? '';
  const table = useMemo(
    () => (schema && ranSql ? editableTableFor(ranSql, schema.tables) : undefined),
    [schema, ranSql],
  );

  const step = query?.steps?.[query.stepIndex];
  // Numa sequência, o que já rodou antes do erro continua aplicado (cada comando é uma transação).
  const appliedBefore = query?.steps
    ?.slice(0, query.stepIndex)
    .filter((s) => s.result?.affected !== undefined).length;
  if (step?.status === 'skipped')
    return (
      <div className="p-4 text-xs text-fg-muted">
        Este comando não foi executado: a sequência parou no erro de um comando anterior.
      </div>
    );
  if (query?.error)
    return (
      <div className="space-y-2 p-4 text-xs">
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-fg">
          <p className="whitespace-pre-wrap">{query.error}</p>
          {step && appliedBefore ? (
            <p className="mt-2 text-fg-muted">
              {appliedBefore === 1
                ? 'O comando de escrita anterior já foi aplicado e continua valendo.'
                : `Os ${appliedBefore} comandos de escrita anteriores já foram aplicados e continuam valendo.`}
            </p>
          ) : null}
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
  const columns = query.result.columns.map((c) => c.name);
  const rowActions = table
    ? (values: readonly DbValue[]): MenuEntry[] => {
        const open = (kind: 'insert' | 'update' | 'delete') => () =>
          openSqlBuilder({ connectionId: id, kind, tableName: table.name, row: { columns, values } });
        return [
          { label: 'Editar esta linha (UPDATE)…', icon: SquarePen, onSelect: open('update') },
          { label: 'Duplicar como nova linha (INSERT)…', icon: CopyPlus, onSelect: open('insert') },
          { label: 'Excluir esta linha (DELETE)…', icon: Trash2, danger: true, onSelect: open('delete') },
        ];
      }
    : undefined;
  return (
    <div className={cn('h-full', running && 'opacity-60')}>
      <ResultGrid
        key={ranSql}
        result={query.result}
        name={name}
        engine={view?.config.engine ?? 'firebird'}
        sql={ranSql}
        {...(rowActions ? { rowActions } : {})}
      />
    </div>
  );
}
