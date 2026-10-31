import type { Appearance } from './schemas';

/**
 * Catálogo de ícones e cores de coleções, pastas, ambientes e túneis. Fica no
 * core (só dados) para o MCP validar e listar as opções; a tela liga cada id
 * ao desenho. O id é o que fica gravado no arquivo (`appearance.icon`): nunca
 * renomeie um id existente, só acrescente. Marcas usam o prefixo "brand:".
 */

export interface IconCatalogItem {
  id: string;
  label: string;
  /** Palavras extras para a busca do seletor. */
  keywords?: string;
}

export interface IconCatalogGroup {
  label: string;
  items: readonly IconCatalogItem[];
}

export const ICON_CATALOG = [
  {
    label: 'Geral',
    items: [
      { id: 'library', label: 'Coleção' },
      { id: 'globe', label: 'API web', keywords: 'rest http site' },
      { id: 'code', label: 'Código', keywords: 'dev projeto' },
      { id: 'terminal', label: 'Terminal', keywords: 'cli' },
      { id: 'rocket', label: 'Projeto', keywords: 'lançamento deploy' },
      { id: 'puzzle', label: 'Integração', keywords: 'plugin conector' },
      { id: 'webhook', label: 'Webhook', keywords: 'eventos' },
      { id: 'bot', label: 'Bot', keywords: 'ia robô automação' },
      { id: 'sparkles', label: 'IA', keywords: 'llm inteligência' },
      { id: 'flask', label: 'Testes', keywords: 'laboratório experimento' },
      { id: 'bug', label: 'Bug', keywords: 'erro depuração' },
      { id: 'git-branch', label: 'Versão', keywords: 'git branch' },
      { id: 'star', label: 'Favorito' },
      { id: 'zap', label: 'Rápido', keywords: 'energia raio' },
    ],
  },
  {
    label: 'Pagamentos e finanças',
    items: [
      { id: 'credit-card', label: 'Cartão', keywords: 'gateway pagamento' },
      { id: 'wallet', label: 'Carteira', keywords: 'pagamento' },
      { id: 'qr-code', label: 'QR Code', keywords: 'pix' },
      { id: 'banknote', label: 'Dinheiro', keywords: 'boleto cobrança' },
      { id: 'receipt', label: 'Recibo', keywords: 'nota fiscal nfe fatura' },
      { id: 'landmark', label: 'Banco', keywords: 'instituição financeira' },
      { id: 'coins', label: 'Moedas', keywords: 'financeiro' },
      { id: 'piggy-bank', label: 'Poupança', keywords: 'investimento' },
      { id: 'calculator', label: 'Cálculo', keywords: 'fiscal imposto contábil' },
    ],
  },
  {
    label: 'Comércio e empresa',
    items: [
      { id: 'shopping-cart', label: 'Carrinho', keywords: 'ecommerce loja pedido' },
      { id: 'store', label: 'Loja', keywords: 'varejo' },
      { id: 'package', label: 'Produto', keywords: 'estoque item' },
      { id: 'tag', label: 'Preço', keywords: 'promoção' },
      { id: 'truck', label: 'Entrega', keywords: 'frete logística' },
      { id: 'warehouse', label: 'Depósito', keywords: 'estoque logística' },
      { id: 'building', label: 'Empresa', keywords: 'erp corporativo' },
      { id: 'briefcase', label: 'Trabalho', keywords: 'negócio cliente' },
      { id: 'clipboard', label: 'Orçamento', keywords: 'pedido lista' },
      { id: 'spreadsheet', label: 'Planilha', keywords: 'relatório excel' },
      { id: 'file-text', label: 'Documento', keywords: 'contrato' },
      { id: 'chart', label: 'Relatórios', keywords: 'dashboard métricas bi' },
    ],
  },
  {
    label: 'Pessoas e acesso',
    items: [
      { id: 'users', label: 'Clientes', keywords: 'usuários crm' },
      { id: 'user', label: 'Usuário', keywords: 'perfil conta' },
      { id: 'key', label: 'Autenticação', keywords: 'login token oauth' },
      { id: 'lock', label: 'Segurança', keywords: 'privado' },
      { id: 'shield', label: 'Permissões', keywords: 'acesso' },
      { id: 'fingerprint', label: 'Identidade', keywords: 'biometria' },
      { id: 'mail', label: 'E-mail', keywords: 'smtp' },
      { id: 'message', label: 'Mensagens', keywords: 'chat sms' },
      { id: 'send', label: 'Envio', keywords: 'notificação' },
      { id: 'smartphone', label: 'App mobile', keywords: 'celular' },
    ],
  },
  {
    label: 'Infraestrutura',
    items: [
      { id: 'database', label: 'Banco de dados', keywords: 'sql' },
      { id: 'server', label: 'Servidor' },
      { id: 'cloud', label: 'Nuvem', keywords: 'cloud' },
      { id: 'hard-drive', label: 'Armazenamento', keywords: 'arquivos storage' },
      { id: 'network', label: 'Rede', keywords: 'microsserviços' },
      { id: 'boxes', label: 'Serviços', keywords: 'containers módulos' },
      { id: 'layers', label: 'Camadas', keywords: 'arquitetura' },
      { id: 'gauge', label: 'Desempenho', keywords: 'carga monitoramento' },
      { id: 'image', label: 'Mídia', keywords: 'imagens upload' },
    ],
  },
  {
    label: 'Pessoal e outros',
    items: [
      { id: 'house', label: 'Casa', keywords: 'pessoal home' },
      { id: 'heart', label: 'Pessoal', keywords: 'saúde favorito' },
      { id: 'gamepad', label: 'Jogos' },
      { id: 'music', label: 'Música' },
      { id: 'book', label: 'Estudos', keywords: 'curso documentação' },
      { id: 'graduation', label: 'Educação', keywords: 'escola' },
      { id: 'map-pin', label: 'Localização', keywords: 'mapa endereço cep' },
      { id: 'car', label: 'Veículos', keywords: 'frota' },
      { id: 'plane', label: 'Viagens' },
      { id: 'stethoscope', label: 'Saúde', keywords: 'clínica médico' },
      { id: 'pill', label: 'Farmácia', keywords: 'remédio' },
      { id: 'utensils', label: 'Restaurante', keywords: 'comida delivery' },
      { id: 'leaf', label: 'Agro', keywords: 'natureza' },
      { id: 'calendar', label: 'Agenda', keywords: 'eventos reservas' },
    ],
  },
  {
    label: 'Marcas',
    items: [
      { id: 'brand:stripe', label: 'Stripe', keywords: 'pagamento gateway' },
      { id: 'brand:mercadopago', label: 'Mercado Pago', keywords: 'pagamento gateway' },
      { id: 'brand:pagseguro', label: 'PagSeguro', keywords: 'pagamento gateway' },
      { id: 'brand:pix', label: 'Pix', keywords: 'pagamento' },
      { id: 'brand:paypal', label: 'PayPal', keywords: 'pagamento' },
      { id: 'brand:nubank', label: 'Nubank', keywords: 'banco' },
      { id: 'brand:picpay', label: 'PicPay', keywords: 'pagamento' },
      { id: 'brand:shopify', label: 'Shopify', keywords: 'ecommerce loja' },
      { id: 'brand:vtex', label: 'VTEX', keywords: 'ecommerce loja' },
      { id: 'brand:woocommerce', label: 'WooCommerce', keywords: 'ecommerce loja' },
      { id: 'brand:shopee', label: 'Shopee', keywords: 'marketplace' },
      { id: 'brand:ifood', label: 'iFood', keywords: 'delivery' },
      { id: 'brand:sap', label: 'SAP', keywords: 'erp' },
      { id: 'brand:totvs', label: 'TOTVS', keywords: 'erp' },
      { id: 'brand:hubspot', label: 'HubSpot', keywords: 'crm' },
      { id: 'brand:whatsapp', label: 'WhatsApp', keywords: 'mensagens' },
      { id: 'brand:telegram', label: 'Telegram', keywords: 'mensagens bot' },
      { id: 'brand:discord', label: 'Discord', keywords: 'mensagens bot' },
      { id: 'brand:meta', label: 'Meta', keywords: 'facebook' },
      { id: 'brand:instagram', label: 'Instagram' },
      { id: 'brand:mailchimp', label: 'Mailchimp', keywords: 'email marketing' },
      { id: 'brand:resend', label: 'Resend', keywords: 'email' },
      { id: 'brand:github', label: 'GitHub', keywords: 'git' },
      { id: 'brand:gitlab', label: 'GitLab', keywords: 'git' },
      { id: 'brand:jira', label: 'Jira', keywords: 'tarefas' },
      { id: 'brand:notion', label: 'Notion', keywords: 'documentação' },
      { id: 'brand:google', label: 'Google' },
      { id: 'brand:googlecloud', label: 'Google Cloud', keywords: 'nuvem' },
      { id: 'brand:cloudflare', label: 'Cloudflare', keywords: 'nuvem' },
      { id: 'brand:vercel', label: 'Vercel', keywords: 'deploy' },
      { id: 'brand:firebase', label: 'Firebase', keywords: 'nuvem' },
      { id: 'brand:supabase', label: 'Supabase', keywords: 'banco' },
      { id: 'brand:auth0', label: 'Auth0', keywords: 'login autenticação' },
      { id: 'brand:clerk', label: 'Clerk', keywords: 'login autenticação' },
      { id: 'brand:keycloak', label: 'Keycloak', keywords: 'login autenticação' },
      { id: 'brand:anthropic', label: 'Anthropic', keywords: 'ia claude' },
      { id: 'brand:zapier', label: 'Zapier', keywords: 'automação' },
      { id: 'brand:n8n', label: 'n8n', keywords: 'automação' },
      { id: 'brand:docker', label: 'Docker' },
      { id: 'brand:graphql', label: 'GraphQL' },
      { id: 'brand:nodejs', label: 'Node.js', keywords: 'javascript' },
      { id: 'brand:nestjs', label: 'NestJS', keywords: 'javascript' },
      { id: 'brand:python', label: 'Python' },
      { id: 'brand:dotnet', label: '.NET', keywords: 'csharp' },
      { id: 'brand:spring', label: 'Spring', keywords: 'java' },
      { id: 'brand:laravel', label: 'Laravel', keywords: 'php' },
      { id: 'brand:wordpress', label: 'WordPress' },
      { id: 'brand:postgresql', label: 'PostgreSQL', keywords: 'banco' },
      { id: 'brand:mysql', label: 'MySQL', keywords: 'banco' },
      { id: 'brand:mongodb', label: 'MongoDB', keywords: 'banco' },
      { id: 'brand:redis', label: 'Redis', keywords: 'cache' },
    ],
  },
] as const satisfies readonly IconCatalogGroup[];

export type IconId = (typeof ICON_CATALOG)[number]['items'][number]['id'];

const ICON_BY_ID: ReadonlyMap<string, IconCatalogItem> = new Map(
  ICON_CATALOG.flatMap((g) => g.items.map((item) => [item.id, item] as const)),
);

export function findIconCatalogItem(id: string | undefined): IconCatalogItem | undefined {
  return id ? ICON_BY_ID.get(id) : undefined;
}

/** Cores pensadas para o tema escuro (contraste AA com o fundo). */
export const ITEM_COLORS: readonly { value: string; label: string }[] = [
  { value: '#F87171', label: 'Vermelho' },
  { value: '#FB923C', label: 'Laranja' },
  { value: '#FBBF24', label: 'Amarelo' },
  { value: '#A3E635', label: 'Lima' },
  { value: '#34D399', label: 'Verde' },
  { value: '#2DD4BF', label: 'Turquesa' },
  { value: '#38BDF8', label: 'Azul' },
  { value: '#818CF8', label: 'Índigo' },
  { value: '#C084FC', label: 'Roxo' },
  { value: '#F472B6', label: 'Rosa' },
  { value: '#94A3B8', label: 'Cinza' },
];

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Aceita o nome da cor ("verde", "Índigo") ou o hex da lista; fora dela, undefined. */
export function resolveItemColor(input: string): string | undefined {
  const wanted = fold(input);
  return ITEM_COLORS.find((c) => fold(c.label) === wanted || c.value.toLowerCase() === wanted)?.value;
}

export interface AppearanceChange {
  /** Id do catálogo; null tira o ícone; ausente mantém. */
  icon?: string | null | undefined;
  /** Nome ou hex da lista; null tira a cor; ausente mantém. */
  color?: string | null | undefined;
}

/**
 * Aplica uma alteração sobre a aparência atual, validando contra o catálogo.
 * Devolve null quando o resultado é o padrão (sem ícone nem cor).
 */
export function applyAppearanceChange(
  current: Appearance | undefined,
  change: AppearanceChange,
): Appearance | null {
  let icon = current?.icon;
  let color = current?.color;
  if (change.icon !== undefined) {
    if (change.icon === null || change.icon === '') icon = undefined;
    else if (findIconCatalogItem(change.icon)) icon = change.icon;
    else
      throw new Error(
        `Ícone "${change.icon}" não existe no catálogo. Consulte a lista de ícones disponíveis.`,
      );
  }
  if (change.color !== undefined) {
    if (change.color === null || change.color === '') color = undefined;
    else {
      const resolved = resolveItemColor(change.color);
      if (!resolved)
        throw new Error(
          `Cor "${change.color}" fora da paleta. Use uma destas: ${ITEM_COLORS.map((c) => c.label).join(', ')}.`,
        );
      color = resolved;
    }
  }
  if (!icon && !color) return null;
  return { ...(icon ? { icon } : {}), ...(color ? { color } : {}) };
}
