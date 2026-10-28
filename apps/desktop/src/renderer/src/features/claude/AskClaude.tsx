import { collectionOf, findNode } from '@rota/core/shared';
import { BookText, FlaskConical, Sparkles, Stethoscope } from 'lucide-react';
import { DropdownActions, type MenuEntry } from '../../components/ActionMenu';
import { Button } from '../../components/Button';
import { ToolbarLabel } from '../../components/ToolbarLabel';
import type { RequestTab } from '../../state/tabs';
import { toast } from '../../state/toasts';
import { useWorkspace } from '../../state/workspace';

/**
 * Pedidos prontos para o Claude. O app não chama a IA diretamente: o texto é
 * copiado para colar no Claude Desktop ou no Claude Code, que usam o MCP do
 * Rota para ler a requisição, o histórico e gravar o resultado (com a sua
 * confirmação no app quando alterar algo).
 */
export const claudePrompts = {
  tests: (name: string, id: string) =>
    `Use o MCP do Rota. Leia a requisição "${name}" (id ${id}) com obter_item e, se houver, os exemplos salvos e o envio mais recente (listar_historico / obter_historico). Escreva testes pm.test para o script de pós-resposta cobrindo: status esperado, tempo de resposta razoável, campos obrigatórios e seus tipos e regras de negócio que dê para inferir. Mantenha o que já existir no script, explique o que cada teste verifica e grave com atualizar_requisicao.`,
  explain: (name: string, id: string | null) =>
    `Use o MCP do Rota. Pegue o envio mais recente da requisição "${name}"${id ? ` (id ${id})` : ''} com listar_historico e obter_historico. Explique em português o que deu errado (status, mensagem, headers, corpo), as causas mais prováveis e como corrigir — na requisição (URL, headers, auth, corpo, variáveis do ambiente) ou no servidor. Não altere nada sem me perguntar.`,
  document: (name: string, id: string) =>
    `Use o MCP do Rota. Leia a coleção "${name}" (id ${id}) com listar_colecoes e obter_item em cada requisição, incluindo os exemplos. Escreva uma documentação em Markdown, em português: visão geral, autenticação, variáveis necessárias e, para cada endpoint, objetivo, parâmetros, corpo, respostas de exemplo e erros comuns. Grave na descrição da coleção com atualizar_pasta_ou_colecao e me mostre um resumo.`,
};

export async function copyPrompt(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.info('Pedido copiado. Cole no Claude (Desktop ou Code) com o MCP do Rota conectado.');
  } catch {
    toast.error('Não foi possível copiar para a área de transferência.');
  }
}

export function AskClaudeButton({ tab }: { tab: RequestTab }) {
  const snapshot = useWorkspace((s) => s.state?.snapshot);
  const saved = Boolean(tab.itemId && snapshot && findNode(snapshot, tab.itemId));
  const anchor = tab.itemId ?? tab.parentId;
  const collection = snapshot && anchor ? collectionOf(snapshot, anchor) : undefined;
  const result = tab.run?.result;
  const failed = Boolean(result && (result.error || (result.response && result.response.status >= 400)));

  const entries: MenuEntry[] = [
    {
      label: saved ? 'Gerar testes para esta requisição' : 'Gerar testes (salve a requisição antes)',
      icon: FlaskConical,
      disabled: !saved,
      onSelect: () => tab.itemId && void copyPrompt(claudePrompts.tests(tab.title, tab.itemId)),
    },
    {
      label: failed
        ? 'Explicar o erro da última resposta'
        : result
          ? 'Analisar a última resposta'
          : 'Explicar a resposta (envie primeiro)',
      icon: Stethoscope,
      disabled: !result,
      onSelect: () => void copyPrompt(claudePrompts.explain(tab.title, tab.itemId)),
    },
    {
      label: collection ? `Documentar a coleção "${collection.name}"` : 'Documentar a coleção',
      icon: BookText,
      disabled: !collection,
      onSelect: () => collection && void copyPrompt(claudePrompts.document(collection.name, collection.id)),
    },
  ];

  return (
    <DropdownActions
      entries={entries}
      align="end"
      trigger={
        <Button
          size="sm"
          variant="ghost"
          title="Pedidos prontos para o Claude (copiados para colar no Claude)"
        >
          <Sparkles className="size-3.5" /> <ToolbarLabel bar="cabecalho">Claude</ToolbarLabel>
        </Button>
      }
    />
  );
}
