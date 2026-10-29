import {
  DB_ENGINES,
  DB_ENVIRONMENTS,
  type DbConnectionConfig,
  type DbEngine,
  type DbServerInfo,
  engineInfo,
  type FirebirdCharset,
  type ParsedConnection,
  parseConnectionString,
} from '@rota/core/shared';
import {
  AlertTriangle,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Copy,
  LoaderCircle,
  Plug,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Field, Select, Switch, TextInput } from '../../components/form';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { EngineIcon } from '../../lib/item-icons';
import { confirmDialog } from '../../state/dialogs';
import { openDatabaseGuide } from './DatabaseGuide';
import {
  closeConnectionDialog,
  duplicateConnection,
  openConnection,
  removeConnection,
  saveConnection,
  setCredentialsOpen,
  useConnection,
  useDatabases,
} from './state';

const OWN = 'propria';

const URL_PLACEHOLDER: Record<DbEngine, string> = {
  postgres: 'postgresql://usuario:senha@servidor:5432/banco',
  mysql: 'mysql://usuario:senha@servidor:3306/banco',
  sqlserver: 'Server=servidor,1433;Database=banco;User Id=usuario;Password=…',
  firebird: 'servidor/3050:C:\\Dados\\LOJA.FDB',
};

const CHARSET_OPTIONS: { value: FirebirdCharset; label: string; hint?: string }[] = [
  { value: 'auto', label: 'Automático', hint: 'recomendado' },
  { value: 'WIN1252', label: 'WIN1252', hint: 'Windows / ANSI' },
  { value: 'UTF8', label: 'UTF8' },
  { value: 'ISO8859_1', label: 'ISO8859_1' },
  { value: 'NONE', label: 'NONE', hint: 'bytes sem conversão' },
];

type Form = Pick<
  DbConnectionConfig,
  'engine' | 'name' | 'host' | 'database' | 'user' | 'charset' | 'ssl' | 'environment' | 'readOnly'
> & { port: string; credential: string };

function initialForm(config: DbConnectionConfig | undefined, firstCredential: string | undefined): Form {
  const engine = config?.engine ?? 'firebird';
  return {
    engine,
    name: config?.name ?? '',
    host: config?.host ?? '',
    port: String(config?.port ?? engineInfo(engine).defaultPort),
    database: config?.database ?? '',
    user: config?.user ?? engineInfo(engine).defaultUser,
    credential: config ? (config.credentialId ?? OWN) : (firstCredential ?? OWN),
    charset: config?.charset ?? 'auto',
    ssl: config?.ssl ?? false,
    environment: config?.environment ?? 'producao',
    readOnly: config?.readOnly ?? true,
  };
}

/** Criar ou editar uma conexão, com teste antes de salvar. */
export function ConnectionDialog() {
  const editing = useDatabases((s) => s.editing);
  return (
    <Dialog
      open={editing !== null}
      onOpenChange={(open) => !open && closeConnectionDialog()}
      title={editing?.id ? 'Editar conexão' : 'Nova conexão'}
      className="w-[min(620px,calc(100vw-32px))]"
    >
      {editing && <ConnectionForm key={editing.id ?? 'nova'} id={editing.id} />}
    </Dialog>
  );
}

function ConnectionForm({ id }: { id: string | null }) {
  const view = useConnection(id);
  const credentials = useDatabases((s) => s.credentials);
  const [form, setForm] = useState<Form>(() => initialForm(view?.config, credentials[0]?.id));
  const [password, setPassword] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [pasted, setPasted] = useState<{ filled: string[]; warnings: string[] } | { error: string } | null>(
    null,
  );
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tested, setTested] = useState<
    { ok: true; info: DbServerInfo } | { ok: false; error: string } | null
  >(null);

  const own = form.credential === OWN;
  const credential = credentials.find((c) => c.id === form.credential);
  const engine = engineInfo(form.engine);
  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setTested(null);
  };

  /** Troca o tipo de banco: porta e usuário padrão acompanham, se não foram mudados. */
  function chooseEngine(next: DbEngine) {
    const before = engineInfo(form.engine);
    const after = engineInfo(next);
    set({
      engine: next,
      ...(form.port === String(before.defaultPort) || form.port === ''
        ? { port: String(after.defaultPort) }
        : {}),
      ...(form.user === before.defaultUser || form.user === '' ? { user: after.defaultUser } : {}),
    });
  }

  const input = () => ({
    ...(id ? { id } : {}),
    engine: form.engine,
    name: form.name,
    host: form.host,
    port: Number(form.port) || engine.defaultPort,
    database: form.database,
    user: own ? form.user : (credential?.user ?? form.user),
    credentialId: own ? null : form.credential,
    charset: form.charset,
    ssl: form.ssl,
    environment: form.environment,
    readOnly: form.readOnly,
  });

  async function test() {
    setTesting(true);
    try {
      const info = await api.invoke('db:test', input(), own && password ? password : undefined);
      setTested({ ok: true, info });
    } catch (error) {
      setTested({ ok: false, error: errorMessage(error) });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    const saved = await saveConnection(input(), own && password ? password : undefined);
    setSaving(false);
    if (!saved) return;
    closeConnectionDialog();
    if (!id) openConnection(saved);
  }

  async function remove() {
    if (!view) return;
    const choice = await confirmDialog({
      title: `Excluir a conexão "${view.config.name}"?`,
      description: 'A configuração e a senha salva desta conexão são apagadas. O banco não é alterado.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (choice !== 'confirm') return;
    closeConnectionDialog();
    await removeConnection(view.config.id);
  }

  const passwordSaved = Boolean(id && view?.hasPassword && !view.config.credentialId);

  /** Preenche o formulário a partir de uma URL/connection string. O texto não é guardado. */
  function fillFrom(text: string) {
    let parsed: ParsedConnection;
    try {
      parsed = parseConnectionString(text);
    } catch (error) {
      setPasted({ error: errorMessage(error) });
      return;
    }
    const next = parsed.engine ?? form.engine;
    const filled: string[] = [];
    if (parsed.engine) filled.push(engineInfo(next).label);
    if (parsed.host !== undefined) filled.push('servidor');
    if (parsed.port !== undefined) filled.push('porta');
    if (parsed.database !== undefined) filled.push('banco');
    if (parsed.user !== undefined) filled.push('usuário');
    if (parsed.password !== undefined) filled.push('senha');
    if (parsed.ssl !== undefined && next !== 'firebird') filled.push(parsed.ssl ? 'TLS ligado' : 'sem TLS');
    const ownLogin = parsed.user !== undefined || parsed.password !== undefined;
    set({
      engine: next,
      port: String(parsed.port ?? engineInfo(next).defaultPort),
      ...(parsed.host !== undefined ? { host: parsed.host } : {}),
      ...(parsed.database !== undefined ? { database: parsed.database } : {}),
      ...(parsed.user !== undefined ? { user: parsed.user } : {}),
      ...(ownLogin ? { credential: OWN } : {}),
      ...(parsed.ssl !== undefined && next !== 'firebird' ? { ssl: parsed.ssl } : {}),
      ...(!form.name.trim() && (parsed.database || parsed.host)
        ? { name: (parsed.database?.split(/[\\/]/).pop() ?? '') || (parsed.host ?? '') }
        : {}),
    });
    if (parsed.password !== undefined) setPassword(parsed.password);
    setPastedText('');
    setPasted({ filled, warnings: parsed.warnings });
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
        <Field
          label="Banco de dados"
          hint={
            <button
              type="button"
              className="inline-flex items-center gap-1 text-primary hover:underline"
              onClick={() => openDatabaseGuide(form.engine)}
            >
              <CircleHelp className="size-3" />
              Onde acho servidor, porta, usuário e senha do {engine.label}?
            </button>
          }
        >
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-surface-2 p-1">
            {DB_ENGINES.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => chooseEngine(e.id)}
                className={cn(
                  'flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-1 text-xs transition-colors',
                  form.engine === e.id
                    ? 'bg-elevated font-medium text-fg shadow-sm'
                    : 'text-fg-muted hover:text-fg',
                )}
              >
                <EngineIcon engine={e.id} className="size-4" />
                <span className="truncate">{e.label}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="Colar URL de conexão (opcional)"
          hint="Do .env, do painel do serviço ou do appsettings.json: preenche os campos abaixo."
        >
          <div className="flex gap-2">
            <TextInput
              mono
              className="flex-1"
              autoComplete="off"
              spellCheck={false}
              value={pastedText}
              placeholder={URL_PLACEHOLDER[form.engine]}
              onChange={(e) => setPastedText(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text');
                if (!text.trim()) return;
                e.preventDefault();
                fillFrom(text);
              }}
              onKeyDown={(e) => e.key === 'Enter' && pastedText.trim() && fillFrom(pastedText)}
            />
            <Button disabled={!pastedText.trim()} onClick={() => fillFrom(pastedText)}>
              Preencher
            </Button>
          </div>
          {pasted && (
            <div className="mt-1.5 space-y-1 text-xs">
              {'error' in pasted ? (
                <p className="flex items-start gap-1.5 text-danger">
                  <CircleAlert className="mt-px size-3.5 shrink-0" />
                  {pasted.error}
                </p>
              ) : (
                <>
                  <p className="flex items-start gap-1.5 text-success">
                    <CircleCheck className="mt-px size-3.5 shrink-0" />
                    Preenchido: {pasted.filled.join(', ') || 'nada encontrado'}. Confira e clique em Testar
                    conexão.
                  </p>
                  {pasted.warnings.map((w) => (
                    <p key={w} className="flex items-start gap-1.5 text-warning">
                      <AlertTriangle className="mt-px size-3.5 shrink-0" />
                      {w}
                    </p>
                  ))}
                </>
              )}
            </div>
          )}
        </Field>

        <Field label="Nome">
          <TextInput
            autoFocus
            value={form.name}
            placeholder="Ex.: Mercado do João"
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>

        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
          <Field label="Servidor">
            <TextInput
              mono
              value={form.host}
              placeholder="IP ou domínio (ex.: cliente.ddns.net)"
              onChange={(e) => set({ host: e.target.value })}
            />
          </Field>
          <Field label="Porta">
            <TextInput
              mono
              inputMode="numeric"
              value={form.port}
              onChange={(e) => set({ port: e.target.value.replace(/\D/g, '').slice(0, 5) })}
            />
          </Field>
        </div>

        <Field label={engine.databaseLabel} hint={engine.databaseHint}>
          <TextInput
            mono
            value={form.database}
            placeholder={engine.databasePlaceholder}
            onChange={(e) => set({ database: e.target.value })}
          />
        </Field>

        <Field
          label="Usuário e senha"
          hint={
            <>
              Uma credencial salva pode ser usada em várias conexões.{' '}
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => setCredentialsOpen(true)}
              >
                Gerenciar credenciais
              </button>
            </>
          }
        >
          <Select
            value={form.credential}
            options={[
              ...credentials.map((c) => ({
                value: c.id,
                label: c.name,
                hint: c.hasPassword ? c.user : `${c.user} · sem senha`,
              })),
              { value: OWN, label: 'Só desta conexão' },
            ]}
            onChange={(credential) => set({ credential })}
            ariaLabel="Credencial"
            triggerClassName="h-8 w-full"
          />
        </Field>

        {own && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Usuário">
              <TextInput mono value={form.user} onChange={(e) => set({ user: e.target.value })} />
            </Field>
            <Field label="Senha">
              <TextInput
                mono
                type="password"
                autoComplete="off"
                value={password}
                placeholder={passwordSaved ? '•••••• (salva; deixe vazio para manter)' : ''}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setTested(null);
                }}
              />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {form.engine === 'firebird' ? (
            <Field label="Charset da conexão">
              <Select
                value={form.charset}
                options={CHARSET_OPTIONS}
                onChange={(charset) => set({ charset })}
                ariaLabel="Charset"
                triggerClassName="h-8 w-full"
              />
            </Field>
          ) : (
            <Field label="Criptografia">
              <div className="grid h-8 grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1">
                {(
                  [
                    [false, 'Sem TLS'],
                    [true, 'TLS'],
                  ] as const
                ).map(([ssl, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => set({ ssl })}
                    className={cn(
                      'rounded-md text-xs transition-colors',
                      form.ssl === ssl
                        ? 'bg-elevated font-medium text-fg shadow-sm'
                        : 'text-fg-muted hover:text-fg',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Field label="Ambiente">
            <div className="grid h-8 grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
              {DB_ENVIRONMENTS.map((env) => (
                <button
                  key={env.id}
                  type="button"
                  onClick={() =>
                    // Produção volta a ser somente leitura; liberar escrita é sempre uma escolha consciente.
                    set({ environment: env.id, ...(env.id === 'producao' ? { readOnly: true } : {}) })
                  }
                  className={cn(
                    'rounded-md text-xs transition-colors',
                    form.environment === env.id
                      ? cn(
                          'bg-elevated font-medium shadow-sm',
                          env.id === 'producao'
                            ? 'text-danger'
                            : env.id === 'teste'
                              ? 'text-warning'
                              : 'text-fg',
                        )
                      : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {env.label}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <Switch
          checked={form.readOnly}
          onChange={(readOnly) => set({ readOnly })}
          label="Somente leitura"
          description={
            form.readOnly
              ? engine.serverReadOnly
                ? 'Só consultas. O próprio servidor recusa qualquer alteração (transação somente leitura).'
                : 'Só consultas: o Rota recusa comandos de escrita e desfaz a transação no fim.'
              : form.environment === 'producao'
                ? 'Atenção: escrita liberada num banco de produção. Comandos que alteram dados pedem confirmação.'
                : 'INSERT, UPDATE, DELETE e DDL liberados.'
          }
        />

        {form.readOnly && !engine.serverReadOnly && (
          <div className="flex gap-2.5 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-relaxed text-fg">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>
              O SQL Server não tem transação somente leitura: a proteção é do Rota. Para garantia total em
              produção, conecte com um usuário que só tenha permissão de leitura (papel <b>db_datareader</b>).
            </p>
          </div>
        )}

        {tested && (
          <div
            className={cn(
              'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-fg',
              tested.ok ? 'border-success/40 bg-success/5' : 'border-danger/40 bg-danger/5',
            )}
          >
            {tested.ok ? (
              <CircleCheck className="mt-px size-3.5 shrink-0 text-success" />
            ) : (
              <CircleAlert className="mt-px size-3.5 shrink-0 text-danger" />
            )}
            <span>
              {tested.ok
                ? `Conectou: ${tested.info.version}${tested.info.databaseCharset ? `, banco em ${tested.info.databaseCharset}` : ''}${tested.info.connectionCharset ? ` (conexão em ${tested.info.connectionCharset})` : ''}.`
                : tested.error}
            </span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-5 py-3">
        <Button onClick={() => void test()} disabled={testing}>
          {testing ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
          Testar conexão
        </Button>
        {id && (
          <>
            <Button
              variant="ghost"
              onClick={() => void duplicateConnection(id)}
              title="Cria uma cópia para outro cliente"
            >
              <Copy className="size-3.5" /> Duplicar
            </Button>
            <Button variant="ghost" onClick={() => void remove()}>
              <Trash2 className="size-3.5" /> Excluir
            </Button>
          </>
        )}
        <div className="flex-1" />
        <Button onClick={closeConnectionDialog}>Cancelar</Button>
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          {id ? 'Salvar' : 'Salvar e abrir'}
        </Button>
      </div>
    </div>
  );
}
