import type { ConnectOptions, DbSession } from './common';
import { FirebirdSession } from './firebird';
import { MysqlSession } from './mysql';
import { PostgresSession } from './postgres';
import { SqlServerSession } from './sqlserver';
import type { DbConnectionConfig } from './types';

/** Abre uma sessão com o motor da conexão (`config.user` já resolvido). */
export function connectDatabase(
  config: DbConnectionConfig,
  password: string,
  options: ConnectOptions = {},
): Promise<DbSession> {
  switch (config.engine) {
    case 'firebird':
      return FirebirdSession.connect(config, password, options);
    case 'postgres':
      return PostgresSession.connect(config, password, options);
    case 'mysql':
      return MysqlSession.connect(config, password, options);
    case 'sqlserver':
      return SqlServerSession.connect(config, password, options);
  }
}
