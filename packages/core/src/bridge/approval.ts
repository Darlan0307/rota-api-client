/**
 * Categorias das ações do MCP que pedem confirmação no app. As "critical"
 * (irreversíveis ou que podem vazar segredos) sempre perguntam; as demais
 * podem ser liberadas nas configurações ou até fechar o app.
 */
export const MCP_AUTO_APPROVABLE = ['organize', 'edit', 'delete', 'send'] as const;
export type McpAutoApprovable = (typeof MCP_AUTO_APPROVABLE)[number];
export type McpActionCategory = McpAutoApprovable | 'critical';
export const MCP_ACTION_CATEGORIES = [...MCP_AUTO_APPROVABLE, 'critical'] as const;

export type McpAutoApprove = Record<McpAutoApprovable, boolean>;

export const MCP_CATEGORY_INFO: Record<McpAutoApprovable, { label: string; description: string }> = {
  organize: {
    label: 'Organizar',
    description: 'Renomear e mover coleções, pastas e requisições.',
  },
  edit: {
    label: 'Editar',
    description: 'Alterar requisições, pastas, coleções e o valor de variáveis comuns.',
  },
  delete: {
    label: 'Excluir',
    description:
      'Excluir itens (vão para a lixeira), remover variáveis e trocar o valor de variáveis secretas.',
  },
  send: {
    label: 'Enviar PUT, PATCH e DELETE',
    description: 'Requisições que costumam alterar dados na API.',
  },
};

export function isAutoApprovable(category: McpActionCategory): category is McpAutoApprovable {
  return category !== 'critical';
}

/** Se a ação passa sem perguntar: liberada nas configurações ou até fechar o app. */
export function autoApproves(
  category: McpActionCategory,
  settings: McpAutoApprove,
  session: ReadonlySet<McpAutoApprovable>,
): boolean {
  if (!isAutoApprovable(category)) return false;
  return settings[category] || session.has(category);
}
