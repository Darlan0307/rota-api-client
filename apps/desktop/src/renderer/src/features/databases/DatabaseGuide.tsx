import { DB_ENGINES, type DbEngine } from '@rota/core/shared';
import {
  Check,
  Cloud,
  Container,
  Copy,
  FileCode,
  Laptop,
  type LucideIcon,
  TriangleAlert,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { cn } from '../../lib/cn';
import { useDatabases } from './state';

/** Janela "Como achar os dados de conexão", com um guia por tipo de banco. */
export function DatabaseGuideDialog() {
  const engine = useDatabases((s) => s.guideEngine);
  return (
    <Dialog
      open={engine !== null}
      onOpenChange={(open) => !open && useDatabases.setState({ guideEngine: null })}
      title="Como achar os dados de conexão"
      className="w-[min(720px,calc(100vw-32px))]"
    >
      <div className="border-b border-border px-5 pt-3 pb-3">
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-surface-2 p-1">
          {DB_ENGINES.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => useDatabases.setState({ guideEngine: e.id })}
              className={cn(
                'h-7 truncate rounded-md px-1 text-xs transition-colors',
                engine === e.id ? 'bg-elevated font-medium text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[68vh] space-y-5 overflow-y-auto px-5 py-4 text-[13px] leading-relaxed text-fg-muted">
        <p>
          O Rota precisa de cinco dados: <b className="text-fg">servidor</b>, <b className="text-fg">porta</b>
          , <b className="text-fg">banco</b>, <b className="text-fg">usuário</b> e{' '}
          <b className="text-fg">senha</b>. Veja abaixo onde encontrar cada um, conforme o banco esteja na sua
          máquina, num container Docker ou num servidor online.
        </p>
        {engine && GUIDES[engine]}
      </div>
    </Dialog>
  );
}

export function openDatabaseGuide(engine: DbEngine = 'postgres'): void {
  useDatabases.setState({ guideEngine: engine });
}

// ---------------------------------------------------------------------------
// Peças do guia

function Section({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-fg">
        <Icon className="size-4 text-primary" strokeWidth={1.75} />
        {title}
      </h3>
      <div className="space-y-2 pl-6">{children}</div>
    </section>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-surface-2 px-1 font-mono text-[0.92em] text-fg">{children}</code>;
}

/** Comando para copiar e rodar no terminal. */
function Cmd({ children, note }: { children: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      {note && <p className="mb-1 text-xs">{note}</p>}
      <div className="group relative rounded-md border border-border bg-bg">
        <pre className="select-text overflow-x-auto whitespace-pre-wrap break-all py-2 pr-10 pl-3 font-mono text-xs leading-5 text-fg">
          {children}
        </pre>
        <button
          type="button"
          aria-label="Copiar"
          title="Copiar"
          onClick={() =>
            void navigator.clipboard.writeText(children).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
          className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded text-fg-subtle opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg group-hover:opacity-100"
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

/** Uma URL de conexão desmontada nos campos do Rota. */
function UrlMap({ url, parts }: { url: string; parts: [field: string, value: string][] }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="mb-2 break-all font-mono text-xs text-fg">{url}</p>
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        {parts.map(([field, value]) => (
          <div key={field} className="contents">
            <dt className="text-fg-subtle">{field}</dt>
            <dd className="break-all font-mono text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Errors({ items }: { items: [error: string, fix: ReactNode][] }) {
  return (
    <Section icon={TriangleAlert} title="Erros comuns">
      <ul className="space-y-1.5">
        {items.map(([error, fix]) => (
          <li key={error}>
            <span className="font-mono text-xs text-fg">{error}</span>: {fix}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function DockerEnv({ vars }: { vars: ReactNode }) {
  return (
    <Section icon={Container} title="Banco num container Docker">
      <Cmd note="Liste os containers. Na coluna PORTS, use a porta da esquerda (a da sua máquina):">
        docker ps
      </Cmd>
      <p className="text-xs">
        Ex.: <Code>0.0.0.0:5433-&gt;5432/tcp</Code> → servidor <Code>localhost</Code>, porta <Code>5433</Code>
        .
      </p>
      <Cmd note="Usuário, senha e banco ficam nas variáveis do container (troque meu-banco pelo nome da coluna NAMES):">
        {'docker inspect meu-banco --format "{{json .Config.Env}}"'}
      </Cmd>
      <p className="text-xs">
        {vars} Se o container foi criado por um projeto, as mesmas variáveis estão no{' '}
        <Code>docker-compose.yml</Code> ou no <Code>.env</Code> dele.
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Guias

const GUIDES: Record<DbEngine, ReactNode> = {
  postgres: (
    <>
      <Section icon={Laptop} title="Banco instalado na sua máquina">
        <p>
          Servidor <Code>localhost</Code>, porta <Code>5432</Code>, usuário <Code>postgres</Code> e a senha
          escolhida na instalação.
        </p>
        <Cmd note="Confira se o serviço está rodando (PowerShell):">Get-Service postgresql*</Cmd>
        <Cmd note="Entre no psql para ver porta, usuário e bancos:">psql -U postgres -h localhost</Cmd>
        <p className="text-xs">
          Se o terminal não achar o <Code>psql</Code>, ele fica em{' '}
          <Code>C:\Program Files\PostgreSQL\&lt;versão&gt;\bin</Code>. Dentro dele:
        </p>
        <Cmd>
          {
            '\\conninfo     -- servidor, porta e usuário da sessão\n\\l            -- lista os bancos\nSHOW port;   -- porta em que o servidor escuta'
          }
        </Cmd>
        <p className="text-xs">
          Sem o psql: a porta está na linha <Code>port =</Code> do <Code>postgresql.conf</Code> (pasta{' '}
          <Code>data</Code> da instalação). No pgAdmin ou no DBeaver, clique com o botão direito no servidor →
          Propriedades → Conexão.
        </p>
      </Section>

      <DockerEnv
        vars={
          <>
            Procure <Code>POSTGRES_USER</Code> (padrão <Code>postgres</Code>), <Code>POSTGRES_PASSWORD</Code>{' '}
            e <Code>POSTGRES_DB</Code> (padrão: igual ao usuário).
          </>
        }
      />

      <Section icon={FileCode} title="Banco usado por um projeto seu">
        <p>
          Abra o <Code>.env</Code> (ou <Code>appsettings.json</Code>, <Code>application.properties</Code>) e
          procure <Code>DATABASE_URL</Code> ou uma connection string. Ela tem todos os dados, como no exemplo
          abaixo.
        </p>
      </Section>

      <Section icon={Cloud} title="Banco online (Supabase, Neon, Railway, Render, AWS, Azure…)">
        <p>
          O painel do serviço mostra uma URL de conexão (procure “Connect” ou “Connection string”). Ela se
          divide assim:
        </p>
        <UrlMap
          url="postgresql://joao:s3nh%40forte@db.exemplo.com:5432/loja?sslmode=require"
          parts={[
            ['Usuário', 'joao'],
            ['Senha', 's3nh@forte  (%40 na URL = @)'],
            ['Servidor', 'db.exemplo.com'],
            ['Porta', '5432 (sem porta na URL = 5432)'],
            ['Banco', 'loja'],
            ['Criptografia', 'TLS (por causa do sslmode=require)'],
          ]}
        />
        <ul className="list-disc space-y-1 pl-4 text-xs">
          <li>
            Banco online quase sempre exige <b>TLS</b>: ligue no formulário.
          </li>
          <li>
            Caracteres especiais da senha vêm codificados na URL: <Code>%40</Code> é <Code>@</Code>,{' '}
            <Code>%23</Code> é <Code>#</Code>, <Code>%25</Code> é <Code>%</Code>.
          </li>
          <li>
            Alguns serviços oferecem duas portas (conexão direta e “pooler”). Para consultas, prefira a direta
            ou o modo <i>session</i>.
          </li>
          <li>AWS RDS, Azure e Google Cloud podem exigir liberar o seu IP no firewall do banco.</li>
        </ul>
      </Section>

      <Errors
        items={[
          ['Connection refused', 'o servidor não está rodando ou a porta está errada.'],
          ['password authentication failed', 'usuário ou senha incorretos.'],
          [
            'database "x" does not exist',
            <>
              confira o nome com <Code>\l</Code> no psql.
            </>,
          ],
          ['no pg_hba.conf entry / SSL required', 'o servidor exige TLS: ligue a criptografia.'],
          ['Tempo esgotado', 'firewall bloqueando a porta, ou o seu IP não foi liberado no serviço.'],
        ]}
      />
    </>
  ),

  mysql: (
    <>
      <Section icon={Laptop} title="Banco instalado na sua máquina">
        <p>
          Servidor <Code>localhost</Code>, porta <Code>3306</Code>, usuário <Code>root</Code>. No XAMPP e no
          Laragon o <Code>root</Code> costuma vir <b>sem senha</b>.
        </p>
        <Cmd note="Confira se o serviço está rodando (PowerShell):">Get-Service MySQL*, MariaDB*</Cmd>
        <Cmd note="Entre no cliente de linha de comando (pede a senha):">mysql -u root -p -h 127.0.0.1</Cmd>
        <Cmd>
          {
            'SHOW DATABASES;          -- lista os bancos\nSELECT @@port;           -- porta do servidor\nSELECT CURRENT_USER();   -- usuário em uso'
          }
        </Cmd>
        <p className="text-xs">
          Sem o cliente: a porta está na linha <Code>port=</Code> do <Code>my.ini</Code>. No MySQL Workbench,
          ela aparece em cada conexão salva.
        </p>
      </Section>

      <DockerEnv
        vars={
          <>
            Procure <Code>MYSQL_ROOT_PASSWORD</Code> (usuário <Code>root</Code>), ou <Code>MYSQL_USER</Code> e{' '}
            <Code>MYSQL_PASSWORD</Code>, e <Code>MYSQL_DATABASE</Code>. No MariaDB os nomes começam com{' '}
            <Code>MARIADB_</Code>.
          </>
        }
      />

      <Section icon={Cloud} title="Banco online ou de um projeto">
        <p>
          Procure <Code>DATABASE_URL</Code> no <Code>.env</Code> do projeto ou a URL de conexão no painel do
          serviço:
        </p>
        <UrlMap
          url="mysql://joao:s3nh%40forte@db.exemplo.com:3306/loja"
          parts={[
            ['Usuário', 'joao'],
            ['Senha', 's3nh@forte  (%40 na URL = @)'],
            ['Servidor', 'db.exemplo.com'],
            ['Porta', '3306'],
            ['Banco', 'loja'],
          ]}
        />
        <p className="text-xs">Serviços na nuvem costumam exigir TLS: ligue a criptografia no formulário.</p>
      </Section>

      <Errors
        items={[
          ['Access denied for user', 'usuário ou senha incorretos.'],
          [
            "Host 'x' is not allowed to connect",
            <>
              o usuário só pode entrar a partir do próprio servidor (<Code>'joao'@'localhost'</Code>). É
              preciso um usuário criado para <Code>'%'</Code> ou para o seu IP.
            </>,
          ],
          [
            'Unknown database',
            <>
              confira o nome com <Code>SHOW DATABASES;</Code>.
            </>,
          ],
          ['Connection refused / ECONNREFUSED', 'o serviço está parado ou a porta está errada.'],
        ]}
      />
    </>
  ),

  sqlserver: (
    <>
      <Section icon={Laptop} title="Banco instalado na sua máquina">
        <p>
          Servidor <Code>localhost</Code>, porta <Code>1433</Code>. O Rota entra com{' '}
          <b>login do SQL Server</b> (usuário e senha, como o <Code>sa</Code>), não com a autenticação do
          Windows.
        </p>
        <p>O SQL Server Express vem com duas coisas desligadas que impedem a conexão:</p>
        <ol className="list-decimal space-y-1 pl-4 text-xs">
          <li>
            <b>TCP/IP com porta fixa:</b> abra o <i>SQL Server Configuration Manager</i> → Configuração de
            Rede do SQL Server → Protocolos de SQLEXPRESS → TCP/IP → Habilitado. Na aba Endereços IP, em{' '}
            <b>IPAll</b>, apague “Portas TCP Dinâmicas” e coloque <Code>1433</Code> em “Porta TCP”. Reinicie o
            serviço.
          </li>
          <li>
            <b>Login com senha:</b> no SSMS, botão direito no servidor → Propriedades → Segurança → “Modo de
            Autenticação do SQL Server e do Windows”. Depois habilite o login <Code>sa</Code> (Segurança →
            Logons) e defina a senha. Reinicie o serviço.
          </li>
        </ol>
        <Cmd note="Confira se o serviço está rodando (PowerShell):">Get-Service MSSQL*</Cmd>
        <Cmd note="Liste os bancos usando o seu login do Windows:">
          {'sqlcmd -S localhost\\SQLEXPRESS -E -Q "SELECT name FROM sys.databases"'}
        </Cmd>
      </Section>

      <DockerEnv
        vars={
          <>
            O usuário é <Code>sa</Code> e a senha está em <Code>MSSQL_SA_PASSWORD</Code> (ou{' '}
            <Code>SA_PASSWORD</Code>). Sem banco criado, use <Code>master</Code>.
          </>
        }
      />

      <Section icon={Cloud} title="Banco online (Azure SQL) ou de um projeto">
        <p>A connection string do .NET tem os campos separados por ponto e vírgula:</p>
        <UrlMap
          url="Server=tcp:db.exemplo.com,1433;Database=loja;User Id=joao;Password=s3nh@forte;Encrypt=True"
          parts={[
            ['Servidor', 'db.exemplo.com'],
            ['Porta', '1433 (depois da vírgula)'],
            ['Banco', 'loja'],
            ['Usuário', 'joao'],
            ['Senha', 's3nh@forte'],
            ['Criptografia', 'TLS (Encrypt=True)'],
          ]}
        />
        <p className="text-xs">
          No Azure SQL, ligue o TLS e libere o seu IP em “Rede” no portal.{' '}
          <Code>Integrated Security=True</Code> significa login do Windows, que o Rota não usa: peça um
          usuário e senha.
        </p>
      </Section>

      <Errors
        items={[
          [
            'Login failed for user',
            'usuário ou senha errados, login desabilitado, modo de autenticação só Windows, ou o banco informado não existe (o SQL Server dá a mesma mensagem).',
          ],
          ['Failed to connect / ECONNREFUSED', 'TCP/IP desligado ou porta dinâmica: veja o passo 1 acima.'],
          ['Tempo esgotado', 'firewall do Windows ou da rede bloqueando a porta 1433.'],
        ]}
      />
    </>
  ),

  firebird: (
    <>
      <Section icon={Laptop} title="Banco instalado na sua máquina">
        <p>
          Servidor <Code>localhost</Code>, porta <Code>3050</Code>, usuário <Code>SYSDBA</Code>. A senha
          padrão da instalação é <Code>masterkey</Code>, a não ser que tenha sido trocada.
        </p>
        <p>
          No campo <b>Banco</b>, informe o <b>caminho do arquivo .FDB no servidor</b> (ex.:{' '}
          <Code>C:\Dados\LOJA.FDB</Code>) ou um <b>alias</b> cadastrado nele.
        </p>
        <Cmd note="Confira se o serviço está rodando (PowerShell):">Get-Service Firebird*</Cmd>
        <p className="text-xs">
          Os aliases ficam na pasta de instalação (ex.: <Code>C:\Program Files\Firebird\Firebird_2_5</Code>):
          no <Code>aliases.conf</Code> (Firebird 2.5) ou no <Code>databases.conf</Code> (3.0 em diante), uma
          linha por banco, como <Code>LOJA = C:\Dados\LOJA.FDB</Code>. A porta fica em{' '}
          <Code>RemoteServicePort</Code> no <Code>firebird.conf</Code>.
        </p>
        <Cmd note="Teste com o isql, que vem na pasta de instalação:">
          {'isql -user SYSDBA -password masterkey localhost:C:\\Dados\\LOJA.FDB'}
        </Cmd>
        <Cmd>{'SHOW TABLES;'}</Cmd>
      </Section>

      <Section icon={Cloud} title="Banco em outro servidor">
        <p>
          Use o endereço do servidor e o caminho do .FDB <b>como ele é no servidor</b>, não na sua máquina. A
          porta do Firebird precisa estar acessível a partir do seu computador.
        </p>
        <p className="text-xs">
          Charset: deixe em <b>Automático</b>. O Rota lê o charset do banco e acerta os acentos sozinho.
        </p>
      </Section>

      <Errors
        items={[
          ['Your user name and password are not defined', 'usuário ou senha incorretos.'],
          [
            'I/O error / unavailable database',
            'caminho do arquivo ou alias errado. O caminho é o do servidor.',
          ],
          [
            'Incompatible wire encryption / authentication',
            <>
              Firebird 3 ou superior com a configuração mais restrita. Se for o seu servidor, permitir o modo
              compatível costuma resolver: no <Code>firebird.conf</Code>,{' '}
              <Code>AuthServer = Srp, Legacy_Auth</Code> e <Code>WireCrypt = Enabled</Code> (reinicie o
              serviço).
            </>,
          ],
          ['Connection refused / tempo esgotado', 'serviço parado, porta errada ou bloqueada no firewall.'],
        ]}
      />
    </>
  ),
};
