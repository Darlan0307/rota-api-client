import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  connectDatabase,
  DB_ENGINES,
  type DbConnectionConfig,
  type DbCredential,
  type DbEngine,
  type DbHistoryEntry,
  type DbQueryResult,
  type DbSchema,
  type DbServerInfo,
  type DbSession,
  type DbState,
  DEFAULT_ROW_LIMIT,
  engineInfo,
  Mutex,
  newId,
  readJsonIfExists,
  type SecretScope,
  type SecretStore,
  writeJsonAtomic,
} from '@rota/core';

const CHARSETS = ['auto', 'UTF8', 'WIN1252', 'ISO8859_1', 'NONE'] as const;
const ENVIRONMENTS = ['local', 'teste', 'producao'] as const;
const PASSWORD = 'password';
const MAX_ROW_LIMIT = 50_000;
const MAX_HISTORY = 200;
/** Conexão parada há mais que isso é fechada (economiza o servidor e não deixa produção aberta). */
const IDLE_MS = 15 * 60_000;

/**
 * Arquivo de configuração ilegível (ex.: gravação interrompida): guarda uma cópia
 * com outro nome antes de seguir vazio, para a próxima gravação não apagar tudo.
 */
async function readConfig(file: string): Promise<unknown> {
  try {
    return await readJsonIfExists(file);
  } catch {
    await rename(file, `${file}.corrompido-${Date.now()}`).catch(() => undefined);
    return null;
  }
}

/** Entrada da tela para criar ou editar uma conexão. */
export type ConnectionInput = Partial<DbConnectionConfig>;

interface Runtime {
  session: Promise<DbSession> | null;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  info: DbServerInfo | null;
  error: string | null;
  running: number;
  lastUsed: number;
}

interface SavedFile {
  connections?: unknown[];
  credentials?: unknown[];
}

/** Campos que exigem reconectar quando mudam. */
const CONNECTION_FIELDS = [
  'engine',
  'host',
  'port',
  'database',
  'user',
  'credentialId',
  'charset',
  'ssl',
] as const;

function normalizeConnection(value: ConnectionInput, fallback?: DbConnectionConfig): DbConnectionConfig {
  const pick = <T>(v: T | undefined, d: T) => (v === undefined ? d : v);
  const requested = pick(value.engine, fallback?.engine ?? 'firebird');
  const engine: DbEngine = DB_ENGINES.some((e) => e.id === requested) ? requested : 'firebird';
  const defaults = engineInfo(engine);
  const environment = pick(value.environment, fallback?.environment ?? 'local');
  const port = Number(pick(value.port, fallback?.port ?? defaults.defaultPort));
  return {
    id: fallback?.id ?? value.id ?? newId(),
    name: (pick(value.name, fallback?.name ?? '') ?? '').trim(),
    engine,
    host: (pick(value.host, fallback?.host ?? '') ?? '').trim(),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : defaults.defaultPort,
    database: (pick(value.database, fallback?.database ?? '') ?? '').trim(),
    user: (pick(value.user, fallback?.user ?? defaults.defaultUser) ?? '').trim(),
    credentialId: pick(value.credentialId, fallback?.credentialId ?? null),
    charset: CHARSETS.includes(value.charset as (typeof CHARSETS)[number])
      ? (value.charset as DbConnectionConfig['charset'])
      : (fallback?.charset ?? 'auto'),
    ssl: pick(value.ssl, fallback?.ssl ?? false) === true,
    environment: ENVIRONMENTS.includes(environment) ? environment : 'local',
    // Produção nasce somente leitura; depois a pessoa decide.
    readOnly: pick(value.readOnly, fallback?.readOnly ?? environment === 'producao'),
  };
}

function validate(config: DbConnectionConfig): void {
  if (!config.host) throw new Error('Informe o endereço do servidor (IP ou domínio).');
  if (!config.database)
    throw new Error(
      config.engine === 'firebird'
        ? 'Informe o banco: o alias (ex.: LOJA) ou o caminho do arquivo .FDB.'
        : 'Informe o nome do banco.',
    );
}

/**
 * Conexões com bancos de dados (Firebird, PostgreSQL, MySQL/MariaDB e SQL Server). Ficam em %APPDATA%/Rota/databases.json
 * (são desta máquina, não do projeto); senhas cifradas no cofre, nunca no arquivo.
 */
export class DatabaseService {
  private connections: DbConnectionConfig[] = [];
  private credentials: DbCredential[] = [];
  private readonly runtimes = new Map<string, Runtime>();
  private readonly writes = new Mutex();
  private readonly historyWrites = new Mutex();
  private readonly idleTimer: NodeJS.Timeout;

  constructor(
    private readonly dataDir: string,
    private readonly secrets: SecretStore,
    private readonly onChange: (state: DbState) => void,
  ) {
    this.idleTimer = setInterval(() => void this.closeIdle(), 60_000);
    this.idleTimer.unref();
  }

  private get file() {
    return join(this.dataDir, 'databases.json');
  }

  async load(): Promise<void> {
    const saved = ((await readConfig(this.file)) ?? {}) as SavedFile;
    this.credentials = (saved.credentials ?? []).filter(
      (c): c is DbCredential =>
        typeof (c as DbCredential)?.id === 'string' && typeof (c as DbCredential).name === 'string',
    );
    this.connections = (saved.connections ?? [])
      .filter((c): c is ConnectionInput => typeof (c as ConnectionInput)?.id === 'string')
      .map((c) => normalizeConnection(c));
  }

  private persist(): Promise<void> {
    return this.writes.run(async () => {
      await mkdir(this.dataDir, { recursive: true });
      await writeJsonAtomic(this.file, { connections: this.connections, credentials: this.credentials });
    });
  }

  private passwordScope(config: Pick<DbConnectionConfig, 'id' | 'credentialId'>): SecretScope {
    return config.credentialId
      ? { kind: 'database', id: `credencial-${config.credentialId}` }
      : { kind: 'database', id: config.id };
  }

  private runtime(id: string): Runtime {
    let rt = this.runtimes.get(id);
    if (!rt) {
      rt = {
        session: null,
        status: 'disconnected',
        info: null,
        error: null,
        running: 0,
        lastUsed: Date.now(),
      };
      this.runtimes.set(id, rt);
    }
    return rt;
  }

  private connection(id: string): DbConnectionConfig {
    const config = this.connections.find((c) => c.id === id);
    if (!config) throw new Error('Conexão não encontrada.');
    return config;
  }

  state(): DbState {
    return {
      connections: this.connections.map((config) => {
        const rt = this.runtimes.get(config.id);
        return {
          config,
          hasPassword: this.secrets.has(this.passwordScope(config), PASSWORD),
          status: rt?.status ?? 'disconnected',
          info: rt?.info ?? null,
          error: rt?.error ?? null,
          running: (rt?.running ?? 0) > 0,
        };
      }),
      credentials: this.credentials.map((c) => ({
        ...c,
        hasPassword: this.secrets.has({ kind: 'database', id: `credencial-${c.id}` }, PASSWORD),
        usedBy: this.connections.filter((x) => x.credentialId === c.id).length,
      })),
    };
  }

  private notify(): void {
    this.onChange(this.state());
  }

  // -------------------------------------------------------------------------
  // Conexões e credenciais

  /** Cria ou atualiza. password: undefined mantém a salva; null apaga. */
  async saveConnection(input: ConnectionInput, password?: string | null): Promise<string> {
    const current = input.id ? this.connections.find((c) => c.id === input.id) : undefined;
    const next = normalizeConnection(input, current);
    if (!next.name) next.name = next.database ? `${next.database} (${next.host})` : 'Nova conexão';
    validate(next);
    if (next.credentialId && !this.credentials.some((c) => c.id === next.credentialId))
      throw new Error('Credencial não encontrada.');

    const reconnect = current && CONNECTION_FIELDS.some((f) => current[f] !== next[f]);
    this.connections = current
      ? this.connections.map((c) => (c.id === next.id ? next : c))
      : [...this.connections, next];
    if (password !== undefined && !next.credentialId) {
      if (password) this.secrets.set(this.passwordScope(next), PASSWORD, password);
      else this.secrets.delete(this.passwordScope(next), PASSWORD);
    }
    await this.persist();
    if (reconnect || password !== undefined) await this.disconnect(next.id);
    this.notify();
    return next.id;
  }

  async duplicateConnection(id: string): Promise<string> {
    const source = this.connection(id);
    const copy = { ...source, id: newId(), name: `${source.name} (cópia)` };
    this.connections = [...this.connections, copy];
    if (!source.credentialId) {
      const password = this.secrets.get(this.passwordScope(source), PASSWORD);
      if (password) this.secrets.set(this.passwordScope(copy), PASSWORD, password);
    }
    await this.persist();
    this.notify();
    return copy.id;
  }

  async removeConnection(id: string): Promise<void> {
    await this.disconnect(id);
    this.runtimes.delete(id);
    this.secrets.deleteScope({ kind: 'database', id });
    this.connections = this.connections.filter((c) => c.id !== id);
    await this.persist();
    await rm(this.historyFile(id), { force: true });
    this.notify();
  }

  async saveCredential(input: Partial<DbCredential>, password?: string | null): Promise<string> {
    const name = input.name?.trim();
    const user = input.user?.trim();
    if (!name) throw new Error('Dê um nome para a credencial (ex.: SYSDBA padrão).');
    if (!user) throw new Error('Informe o usuário.');
    const current = input.id ? this.credentials.find((c) => c.id === input.id) : undefined;
    const credential: DbCredential = { id: current?.id ?? newId(), name, user };
    this.credentials = current
      ? this.credentials.map((c) => (c.id === credential.id ? credential : c))
      : [...this.credentials, credential];
    const scope: SecretScope = { kind: 'database', id: `credencial-${credential.id}` };
    if (password) this.secrets.set(scope, PASSWORD, password);
    else if (password === null) this.secrets.delete(scope, PASSWORD);
    await this.persist();
    // Quem usa a credencial passa a conectar com os dados novos.
    for (const c of this.connections) if (c.credentialId === credential.id) await this.disconnect(c.id);
    this.notify();
    return credential.id;
  }

  async removeCredential(id: string): Promise<void> {
    for (const c of this.connections) if (c.credentialId === id) await this.disconnect(c.id);
    const credential = this.credentials.find((c) => c.id === id);
    // As conexões continuam com o mesmo usuário, mas pedem a senha de novo.
    this.connections = this.connections.map((c) =>
      c.credentialId === id ? { ...c, credentialId: null, user: credential?.user ?? c.user } : c,
    );
    this.credentials = this.credentials.filter((c) => c.id !== id);
    this.secrets.deleteScope({ kind: 'database', id: `credencial-${id}` });
    await this.persist();
    this.notify();
  }

  // -------------------------------------------------------------------------
  // Sessões

  private credentialsFor(config: DbConnectionConfig, password?: string): { user: string; password: string } {
    const credential = config.credentialId
      ? this.credentials.find((c) => c.id === config.credentialId)
      : undefined;
    const pass = password ?? this.secrets.get(this.passwordScope(config), PASSWORD);
    if (!pass) throw new Error('Informe a senha da conexão.');
    return { user: credential?.user ?? config.user, password: pass };
  }

  /** Testa uma conexão da tela (ainda não salva). password ausente usa a salva. */
  async test(input: ConnectionInput, password?: string): Promise<DbServerInfo> {
    const current = input.id ? this.connections.find((c) => c.id === input.id) : undefined;
    const config = normalizeConnection(input, current);
    validate(config);
    const { user, password: pass } = this.credentialsFor(config, password || undefined);
    const session = await connectDatabase({ ...config, user }, pass);
    await session.close();
    return session.info;
  }

  private session(id: string): Promise<DbSession> {
    const config = this.connection(id);
    const rt = this.runtime(id);
    if (rt.session) return rt.session;
    const { user, password } = this.credentialsFor(config);
    rt.status = 'connecting';
    rt.error = null;
    this.notify();
    const pending = connectDatabase({ ...config, user }, password).then(
      (session) => {
        rt.status = 'connected';
        rt.info = session.info;
        this.notify();
        return session;
      },
      (error: unknown) => {
        rt.session = null;
        rt.status = 'error';
        rt.error = error instanceof Error ? error.message : String(error);
        this.notify();
        throw error;
      },
    );
    rt.session = pending;
    rt.lastUsed = Date.now();
    return pending;
  }

  private async closeIdle(): Promise<void> {
    const now = Date.now();
    for (const [id, rt] of this.runtimes)
      if (rt.session && rt.running === 0 && now - rt.lastUsed > IDLE_MS) await this.disconnect(id);
  }

  async connect(id: string): Promise<DbServerInfo> {
    return (await this.session(id)).info;
  }

  async disconnect(id: string): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt?.session) return;
    const pending = rt.session;
    rt.session = null;
    rt.status = 'disconnected';
    rt.info = null;
    rt.running = 0;
    await pending.then((s) => s.close()).catch(() => undefined);
    this.notify();
  }

  /**
   * Conexão que caiu (rede, servidor reiniciado): reconecta uma vez e repete.
   * Só para leitura: um comando que grava pode ter sido aplicado antes da queda.
   */
  private async withSession<T>(
    id: string,
    work: (session: DbSession) => Promise<T>,
    retry = true,
  ): Promise<T> {
    try {
      return await work(await this.session(id));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!retry || !/conexão com .* caiu|ECONNRESET|EPIPE|closed|fechad/i.test(message)) throw error;
      await this.disconnect(id);
      return work(await this.session(id));
    }
  }

  schema(id: string): Promise<DbSchema> {
    return this.withSession(id, (s) => s.schema());
  }

  async run(id: string, sql: string, limit = DEFAULT_ROW_LIMIT): Promise<DbQueryResult> {
    const config = this.connection(id);
    if (!sql.trim()) throw new Error('Escreva uma consulta.');
    const rt = this.runtime(id);
    rt.running++;
    rt.lastUsed = Date.now();
    this.notify();
    const started = Date.now();
    try {
      const result = await this.withSession(
        id,
        (s) => s.run(sql, { readOnly: config.readOnly, limit: Math.min(Math.max(1, limit), MAX_ROW_LIMIT) }),
        config.readOnly,
      );
      void this.record(id, {
        sql,
        durationMs: result.durationMs,
        ...(result.affected !== undefined ? { affected: result.affected } : { rows: result.rows.length }),
      });
      return result;
    } catch (error) {
      void this.record(id, {
        sql,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      rt.running = Math.max(0, rt.running - 1);
      rt.lastUsed = Date.now();
      this.notify();
    }
  }

  // -------------------------------------------------------------------------
  // Histórico de consultas (só nesta máquina)

  private historyFile(id: string): string {
    return join(this.dataDir, 'database-history', `${id}.json`);
  }

  async history(id: string): Promise<DbHistoryEntry[]> {
    const saved = await readJsonIfExists(this.historyFile(id)).catch(() => null);
    return Array.isArray(saved) ? (saved as DbHistoryEntry[]) : [];
  }

  /** Mais recente primeiro; repetir a mesma consulta só atualiza a entrada. */
  private record(id: string, entry: Omit<DbHistoryEntry, 'id' | 'at'>): Promise<void> {
    return this.historyWrites
      .run(async () => {
        const list = (await this.history(id)).filter((e) => e.sql.trim() !== entry.sql.trim());
        const next = [{ id: newId(), at: new Date().toISOString(), ...entry }, ...list].slice(0, MAX_HISTORY);
        await mkdir(join(this.dataDir, 'database-history'), { recursive: true });
        await writeJsonAtomic(this.historyFile(id), next);
      })
      .catch(() => undefined);
  }

  clearHistory(id: string): Promise<void> {
    return this.historyWrites.run(() => rm(this.historyFile(id), { force: true }));
  }

  async cancel(id: string): Promise<void> {
    const pending = this.runtimes.get(id)?.session;
    if (pending) await (await pending).cancel();
  }

  /** Fechamento do app. */
  async closeAll(): Promise<void> {
    clearInterval(this.idleTimer);
    await Promise.allSettled([...this.runtimes.keys()].map((id) => this.disconnect(id)));
  }
}
