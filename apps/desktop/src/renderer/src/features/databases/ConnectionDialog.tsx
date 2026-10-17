import {
  DB_ENVIRONMENTS,
  type DbConnectionConfig,
  type DbServerInfo,
  DEFAULT_FIREBIRD_PORT,
  type FirebirdCharset,
} from '@rota/core/shared';
import { CircleAlert, CircleCheck, Copy, LoaderCircle, Plug, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Field, Select, Switch, TextInput } from '../../components/form';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { confirmDialog } from '../../state/dialogs';
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

const CHARSET_OPTIONS: { value: FirebirdCharset; label: string; hint?: string }[] = [
  { value: 'auto', label: 'Automático', hint: 'recomendado' },
  { value: 'WIN1252', label: 'WIN1252', hint: 'Windows / ANSI' },
  { value: 'UTF8', label: 'UTF8' },
  { value: 'ISO8859_1', label: 'ISO8859_1' },
  { value: 'NONE', label: 'NONE', hint: 'bytes sem conversão' },
];

type Form = Pick<
  DbConnectionConfig,
  'name' | 'host' | 'database' | 'user' | 'charset' | 'environment' | 'readOnly'
> & { port: string; credential: string };

function initialForm(config: DbConnectionConfig | undefined, firstCredential: string | undefined): Form {
  return {
    name: config?.name ?? '',
    host: config?.host ?? '',
    port: String(config?.port ?? DEFAULT_FIREBIRD_PORT),
    database: config?.database ?? '',
    user: config?.user ?? 'SYSDBA',
    credential: config ? (config.credentialId ?? OWN) : (firstCredential ?? OWN),
    charset: config?.charset ?? 'auto',
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
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tested, setTested] = useState<
    { ok: true; info: DbServerInfo } | { ok: false; error: string } | null
  >(null);

  const own = form.credential === OWN;
  const credential = credentials.find((c) => c.id === form.credential);
  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setTested(null);
  };

  const input = () => ({
    ...(id ? { id } : {}),
    name: form.name,
    host: form.host,
    port: Number(form.port) || DEFAULT_FIREBIRD_PORT,
    database: form.database,
    user: own ? form.user : (credential?.user ?? form.user),
    credentialId: own ? null : form.credential,
    charset: form.charset,
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

  return (
    <div className="flex min-h-0 flex-col">
      <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
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

        <Field
          label="Banco"
          hint="O alias configurado no servidor (aliases.conf) ou o caminho do arquivo .FDB no servidor."
        >
          <TextInput
            mono
            value={form.database}
            placeholder="Ex.: LOJA ou C:\Dados\LOJA.FDB"
            onChange={(e) => set({ database: e.target.value })}
          />
        </Field>

        <Field
          label="Usuário e senha"
          hint={
            <>
              Credenciais salvas servem para vários clientes com a mesma senha.{' '}
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
          <Field label="Charset da conexão">
            <Select
              value={form.charset}
              options={CHARSET_OPTIONS}
              onChange={(charset) => set({ charset })}
              ariaLabel="Charset"
              triggerClassName="h-8 w-full"
            />
          </Field>
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
              ? 'Só SELECT. O próprio servidor recusa qualquer alteração (transação somente leitura).'
              : form.environment === 'producao'
                ? 'Atenção: escrita liberada num banco de produção. Comandos que alteram dados pedem confirmação.'
                : 'INSERT, UPDATE, DELETE e DDL liberados.'
          }
        />

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
                ? `Conectou: Firebird ${tested.info.version}, banco em ${tested.info.databaseCharset} (conexão em ${tested.info.connectionCharset}).`
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
