import {
  type AppSettings,
  MCP_AUTO_APPROVABLE,
  MCP_CATEGORY_INFO,
  type McpAutoApprovable,
} from '@rota/core/shared';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Switch } from '../../components/form';
import { api, errorMessage } from '../../lib/api';
import { toast } from '../../state/toasts';

/** Quais ações do Claude passam direto e quais pedem confirmação no app. */
export function McpApprovalSettings() {
  const [auto, setAutoState] = useState<AppSettings['mcpAutoApprove'] | null>(null);
  // Valor mais recente fora do ciclo de render: cliques seguidos partem dele, não de um valor antigo.
  const latest = useRef<AppSettings['mcpAutoApprove'] | null>(null);
  const setAuto = (value: AppSettings['mcpAutoApprove']) => {
    latest.current = value;
    setAutoState(value);
  };
  const [session, setSession] = useState<McpAutoApprovable[]>([]);

  useEffect(() => {
    void api.invoke('settings:get').then((s) => {
      latest.current = s.mcpAutoApprove;
      setAutoState(s.mcpAutoApprove);
    });
    void api.invoke('mcp:sessionApprovals').then(setSession);
  }, []);

  if (!auto) return null;

  async function toggle(category: McpAutoApprovable, value: boolean) {
    if (!latest.current) return;
    const next = { ...latest.current, [category]: value };
    setAuto(next);
    // Não aplica a resposta: com cliques seguidos, ela chegaria depois do
    // próximo clique e desfaria ele na tela. No erro, relê o que está salvo.
    try {
      await api.invoke('settings:update', { mcpAutoApprove: next });
    } catch (e) {
      toast.error(errorMessage(e));
      const saved = await api.invoke('settings:get').catch(() => null);
      if (saved) setAuto(saved.mcpAutoApprove);
    }
  }

  async function clearSession() {
    await api.invoke('mcp:clearSessionApprovals');
    setSession([]);
  }

  // Liberadas só até fechar o app, e que as configurações ainda não liberam.
  const temporary = session.filter((c) => !auto[c]);

  return (
    <section className="space-y-4">
      <div>
        <h4 className="text-[13px] font-semibold">Confirmações</h4>
        <p className="mt-1 text-xs text-fg-muted">
          Ligado: o Claude faz sem perguntar (você vê um aviso). Desligado: pede confirmação aqui no app.
          Criar itens e enviar GET/POST nunca pedem.
        </p>
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
        {MCP_AUTO_APPROVABLE.map((c) => (
          <Switch
            key={c}
            label={MCP_CATEGORY_INFO[c].label}
            description={MCP_CATEGORY_INFO[c].description}
            checked={auto[c]}
            onChange={(value) => void toggle(c, value)}
          />
        ))}
        <p className="border-t border-border pt-3 text-xs text-fg-subtle">
          Sempre pedem confirmação: esvaziar a lixeira, teste de carga e enviar valores secretos para um
          endereço que você ainda não usou no Rota.
        </p>
      </div>
      {temporary.length > 0 && (
        <div className="flex items-center justify-between gap-4 text-xs text-fg-muted">
          <p>
            Liberado até fechar o Rota:{' '}
            <span className="text-fg">{temporary.map((c) => MCP_CATEGORY_INFO[c].label).join(', ')}</span>
          </p>
          <Button size="sm" onClick={() => void clearSession()}>
            Voltar a perguntar
          </Button>
        </div>
      )}
    </section>
  );
}
