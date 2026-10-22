import { Check, Copy, Info, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { McpSetupInfo, McpStatus } from '../../../../shared/ipc';
import { Button } from '../../components/Button';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { confirmDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';
import { checkMcp, useMcpStatus } from './mcp-status';

const STATUS_TEXT: Record<McpSetupInfo['claudeDesktop']['status'], { label: string; tone: string }> = {
  missing: { label: 'Claude Desktop sem arquivo de configuração (será criado)', tone: 'text-fg-muted' },
  'not-installed': { label: 'Ainda não configurado no Claude Desktop', tone: 'text-fg-muted' },
  installed: { label: 'Configurado no Claude Desktop', tone: 'text-success' },
  outdated: { label: 'Configurado com outro caminho: atualize', tone: 'text-warning' },
  invalid: { label: 'O arquivo do Claude Desktop não é um JSON válido', tone: 'text-danger' },
};

/** Configurações → Claude (MCP): como conectar o Claude Desktop e o Claude Code ao Rota. */
export function McpSettings() {
  const [info, setInfo] = useState<McpSetupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .invoke('mcp:setup')
      .then(setInfo)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  if (error) return <p className="text-[13px] text-danger">Não foi possível obter a configuração: {error}</p>;
  if (!info) return <p className="text-[13px] text-fg-muted">Carregando…</p>;

  const status = STATUS_TEXT[info.claudeDesktop.status];

  async function install() {
    if (!info) return;
    const result = await confirmDialog({
      title: 'Configurar no Claude Desktop?',
      description: (
        <div className="space-y-2">
          <p>
            O Rota será incluído em <code className="font-mono text-xs">mcpServers</code> do arquivo abaixo. O
            restante do arquivo é mantido e uma cópia de segurança é criada ao lado dele.
          </p>
          <p className="break-all font-mono text-xs text-fg-muted">{info.claudeDesktop.path}</p>
          <p>Depois, feche e abra o Claude Desktop para ele carregar o servidor.</p>
        </div>
      ),
      confirmLabel: info.claudeDesktop.status === 'outdated' ? 'Atualizar' : 'Configurar',
    });
    if (result !== 'confirm') return;
    try {
      const { backupPath } = await api.invoke('mcp:installClaudeDesktop');
      toast.success(
        backupPath
          ? 'Claude Desktop configurado (cópia do arquivo anterior salva). Reinicie o Claude Desktop.'
          : 'Claude Desktop configurado. Reinicie o Claude Desktop.',
      );
      load();
      void checkMcp(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h3 className="text-sm font-semibold">Claude (MCP)</h3>
        <p className="mt-1 text-[13px] text-fg-muted">
          Com o servidor MCP do Rota, o Claude consegue listar, criar e editar coleções, ambientes e
          requisições, enviar requisições e consultar o histórico. Ações que alteram ou apagam dados, e
          requisições DELETE, PUT e PATCH, pedem sua confirmação aqui no app. Os valores de variáveis secretas
          nunca são enviados ao Claude.
        </p>
      </div>

      {info.development && (
        <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-[13px] text-fg">
          <Info className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={1.75} />
          <p>
            O app está rodando pelo código-fonte (modo de desenvolvimento). A configuração aponta para esta
            pasta do projeto e para o Electron de desenvolvimento; no app instalado ela aponta para o
            Rota.exe. Rode <code className="font-mono text-xs">pnpm build</code> antes de usar, para gerar o
            servidor.
          </p>
        </div>
      )}

      <McpCheck />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="text-[13px] font-semibold">Claude Desktop</h4>
            <p className={`mt-1 flex items-center gap-1.5 text-xs ${status.tone}`}>
              {info.claudeDesktop.status === 'installed' && <Check className="size-3.5" strokeWidth={2.5} />}
              {status.label}
            </p>
          </div>
          <Button
            variant="primary"
            disabled={info.claudeDesktop.status === 'installed' || info.claudeDesktop.status === 'invalid'}
            onClick={() => void install()}
          >
            {info.claudeDesktop.status === 'outdated'
              ? 'Atualizar configuração'
              : 'Configurar automaticamente'}
          </Button>
        </div>
        <CodeBlock
          label="Ou cole em claude_desktop_config.json (Configurações → Desenvolvedor → Editar configuração)"
          code={info.desktopSnippet}
        />
      </section>

      <section className="space-y-3">
        <h4 className="text-[13px] font-semibold">Claude Code</h4>
        <CodeBlock
          label="Rode no terminal para registrar o servidor para o seu usuário"
          code={info.claudeCodeCommand}
        />
      </section>
    </div>
  );
}

const CODE_STATUS: Record<McpStatus['claudeCode'][number]['status'], { label: string; tone: string }> = {
  'not-installed': { label: 'não configurado', tone: 'text-fg-muted' },
  installed: { label: 'configurado', tone: 'text-success' },
  outdated: { label: 'configurado com outro caminho: rode o comando de novo', tone: 'text-warning' },
  invalid: { label: 'arquivo não é um JSON válido', tone: 'text-danger' },
};

/** Resultado da verificação feita ao abrir o app (servidor + onde está configurado). */
function McpCheck() {
  const status = useMcpStatus((s) => s.status);
  const checking = useMcpStatus((s) => s.checking);
  const error = useMcpStatus((s) => s.error);
  useEffect(() => {
    void checkMcp();
  }, []);

  return (
    <section className="space-y-2 rounded-lg border border-border bg-surface p-3 text-[13px]">
      <div className="flex items-center justify-between gap-4">
        <h4 className="font-semibold">Verificação</h4>
        <Button size="sm" disabled={checking} onClick={() => void checkMcp(true)}>
          <RefreshCw className={cn('size-3.5', checking && 'animate-spin')} />
          Verificar de novo
        </Button>
      </div>
      {error && <p className="text-danger">Não foi possível verificar: {error}</p>}
      {!status ? (
        <p className="text-fg-muted">Verificando…</p>
      ) : (
        <ul className="space-y-1.5 text-xs">
          <li className={status.server.ok ? 'text-success' : 'text-danger'}>
            {status.server.ok
              ? `Servidor MCP funcionando: ${status.server.tools} ferramentas (${status.server.ms} ms para iniciar)`
              : `Servidor MCP com problema: ${status.server.error}`}
          </li>
          <li className={STATUS_TEXT[status.claudeDesktop.status].tone}>
            {STATUS_TEXT[status.claudeDesktop.status].label}
            <span className="block break-all font-mono text-2xs text-fg-subtle">
              {status.claudeDesktop.path}
            </span>
          </li>
          {status.claudeCode.length === 0 ? (
            <li className="text-fg-muted">Claude Code: nenhuma configuração encontrada</li>
          ) : (
            status.claudeCode.map((c) => (
              <li key={c.path} className={CODE_STATUS[c.status].tone}>
                Claude Code: {CODE_STATUS[c.status].label}
                <span className="block break-all font-mono text-2xs text-fg-subtle">{c.path}</span>
              </li>
            ))
          )}
          <li className="text-fg-subtle">
            Verificado às {new Date(status.checkedAt).toLocaleTimeString('pt-BR')}. A verificação roda só aqui
            no computador, sem usar o Claude.
          </li>
        </ul>
      )}
    </section>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="mb-1.5 text-xs text-fg-muted">{label}</p>
      <div className="relative rounded-lg border border-border bg-surface">
        <pre className="select-text overflow-x-auto whitespace-pre-wrap break-all p-3 pr-12 font-mono text-xs leading-5 text-fg">
          {code}
        </pre>
        <Button
          size="sm"
          className="absolute top-2 right-2"
          aria-label="Copiar"
          title="Copiar"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}
