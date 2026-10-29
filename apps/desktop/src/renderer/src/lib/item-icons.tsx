import { type Appearance, contrastRatio, type DbEngine } from '@rota/core/shared';
import {
  Banknote,
  BookOpen,
  Bot,
  Boxes,
  Briefcase,
  Bug,
  Building2,
  Calculator,
  Calendar,
  Car,
  ChartColumn,
  ClipboardList,
  Cloud,
  Code,
  Coins,
  CreditCard,
  Database,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  Flame,
  FlaskConical,
  Folder,
  FolderOpen,
  Gamepad2,
  Gauge,
  GitBranch,
  Globe,
  GraduationCap,
  HardDrive,
  Heart,
  House,
  Image,
  KeyRound,
  Landmark,
  Layers,
  Leaf,
  Library,
  Lock,
  type LucideIcon,
  Mail,
  MapPin,
  MessageSquare,
  Music,
  Network,
  Package,
  PiggyBank,
  Pill,
  Plane,
  Puzzle,
  QrCode,
  Receipt,
  Rocket,
  Send,
  Server,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Star,
  Stethoscope,
  Store,
  Tag,
  Terminal,
  Truck,
  User,
  Users,
  Utensils,
  Wallet,
  Warehouse,
  Webhook,
  Zap,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import {
  type SimpleIcon,
  siAnthropic,
  siAuth0,
  siClerk,
  siCloudflare,
  siDiscord,
  siDocker,
  siDotnet,
  siFirebase,
  siGithub,
  siGitlab,
  siGoogle,
  siGooglecloud,
  siGraphql,
  siHubspot,
  siIfood,
  siInstagram,
  siJira,
  siKeycloak,
  siLaravel,
  siMailchimp,
  siMercadopago,
  siMeta,
  siMongodb,
  siMysql,
  siN8n,
  siNestjs,
  siNodedotjs,
  siNotion,
  siNubank,
  siPagseguro,
  siPaypal,
  siPicpay,
  siPix,
  siPostgresql,
  siPython,
  siRedis,
  siResend,
  siSap,
  siShopee,
  siShopify,
  siSpring,
  siStripe,
  siSupabase,
  siTelegram,
  siTotvs,
  siVercel,
  siVtex,
  siWhatsapp,
  siWoocommerce,
  siWordpress,
  siZapier,
} from 'simple-icons';
import { cn } from './cn';

/**
 * Catálogo de ícones para coleções e pastas. O id é o que fica gravado no
 * arquivo (`appearance.icon`): nunca renomeie um id existente, só acrescente.
 * Marcas vêm do simple-icons (CC0) com prefixo "brand:".
 */

export interface IconChoice {
  id: string;
  label: string;
  /** Palavras extras para a busca do seletor. */
  keywords?: string;
  icon?: LucideIcon;
  brand?: SimpleIcon;
}

export interface IconGroup {
  label: string;
  items: IconChoice[];
}

const brand = (id: string, si: SimpleIcon, keywords?: string): IconChoice => ({
  id: `brand:${id}`,
  label: si.title,
  brand: si,
  ...(keywords ? { keywords } : {}),
});

export const ICON_GROUPS: IconGroup[] = [
  {
    label: 'Geral',
    items: [
      { id: 'library', label: 'Coleção', icon: Library },
      { id: 'globe', label: 'API web', icon: Globe, keywords: 'rest http site' },
      { id: 'code', label: 'Código', icon: Code, keywords: 'dev projeto' },
      { id: 'terminal', label: 'Terminal', icon: Terminal, keywords: 'cli' },
      { id: 'rocket', label: 'Projeto', icon: Rocket, keywords: 'lançamento deploy' },
      { id: 'puzzle', label: 'Integração', icon: Puzzle, keywords: 'plugin conector' },
      { id: 'webhook', label: 'Webhook', icon: Webhook, keywords: 'eventos' },
      { id: 'bot', label: 'Bot', icon: Bot, keywords: 'ia robô automação' },
      { id: 'sparkles', label: 'IA', icon: Sparkles, keywords: 'llm inteligência' },
      { id: 'flask', label: 'Testes', icon: FlaskConical, keywords: 'laboratório experimento' },
      { id: 'bug', label: 'Bug', icon: Bug, keywords: 'erro depuração' },
      { id: 'git-branch', label: 'Versão', icon: GitBranch, keywords: 'git branch' },
      { id: 'star', label: 'Favorito', icon: Star },
      { id: 'zap', label: 'Rápido', icon: Zap, keywords: 'energia raio' },
    ],
  },
  {
    label: 'Pagamentos e finanças',
    items: [
      { id: 'credit-card', label: 'Cartão', icon: CreditCard, keywords: 'gateway pagamento' },
      { id: 'wallet', label: 'Carteira', icon: Wallet, keywords: 'pagamento' },
      { id: 'qr-code', label: 'QR Code', icon: QrCode, keywords: 'pix' },
      { id: 'banknote', label: 'Dinheiro', icon: Banknote, keywords: 'boleto cobrança' },
      { id: 'receipt', label: 'Recibo', icon: Receipt, keywords: 'nota fiscal nfe fatura' },
      { id: 'landmark', label: 'Banco', icon: Landmark, keywords: 'instituição financeira' },
      { id: 'coins', label: 'Moedas', icon: Coins, keywords: 'financeiro' },
      { id: 'piggy-bank', label: 'Poupança', icon: PiggyBank, keywords: 'investimento' },
      { id: 'calculator', label: 'Cálculo', icon: Calculator, keywords: 'fiscal imposto contábil' },
    ],
  },
  {
    label: 'Comércio e empresa',
    items: [
      { id: 'shopping-cart', label: 'Carrinho', icon: ShoppingCart, keywords: 'ecommerce loja pedido' },
      { id: 'store', label: 'Loja', icon: Store, keywords: 'varejo' },
      { id: 'package', label: 'Produto', icon: Package, keywords: 'estoque item' },
      { id: 'tag', label: 'Preço', icon: Tag, keywords: 'promoção' },
      { id: 'truck', label: 'Entrega', icon: Truck, keywords: 'frete logística' },
      { id: 'warehouse', label: 'Depósito', icon: Warehouse, keywords: 'estoque logística' },
      { id: 'building', label: 'Empresa', icon: Building2, keywords: 'erp corporativo' },
      { id: 'briefcase', label: 'Trabalho', icon: Briefcase, keywords: 'negócio cliente' },
      { id: 'clipboard', label: 'Orçamento', icon: ClipboardList, keywords: 'pedido lista' },
      { id: 'spreadsheet', label: 'Planilha', icon: FileSpreadsheet, keywords: 'relatório excel' },
      { id: 'file-text', label: 'Documento', icon: FileText, keywords: 'contrato' },
      { id: 'chart', label: 'Relatórios', icon: ChartColumn, keywords: 'dashboard métricas bi' },
    ],
  },
  {
    label: 'Pessoas e acesso',
    items: [
      { id: 'users', label: 'Clientes', icon: Users, keywords: 'usuários crm' },
      { id: 'user', label: 'Usuário', icon: User, keywords: 'perfil conta' },
      { id: 'key', label: 'Autenticação', icon: KeyRound, keywords: 'login token oauth' },
      { id: 'lock', label: 'Segurança', icon: Lock, keywords: 'privado' },
      { id: 'shield', label: 'Permissões', icon: ShieldCheck, keywords: 'acesso' },
      { id: 'fingerprint', label: 'Identidade', icon: Fingerprint, keywords: 'biometria' },
      { id: 'mail', label: 'E-mail', icon: Mail, keywords: 'smtp' },
      { id: 'message', label: 'Mensagens', icon: MessageSquare, keywords: 'chat sms' },
      { id: 'send', label: 'Envio', icon: Send, keywords: 'notificação' },
      { id: 'smartphone', label: 'App mobile', icon: Smartphone, keywords: 'celular' },
    ],
  },
  {
    label: 'Infraestrutura',
    items: [
      { id: 'database', label: 'Banco de dados', icon: Database, keywords: 'sql' },
      { id: 'server', label: 'Servidor', icon: Server },
      { id: 'cloud', label: 'Nuvem', icon: Cloud, keywords: 'cloud' },
      { id: 'hard-drive', label: 'Armazenamento', icon: HardDrive, keywords: 'arquivos storage' },
      { id: 'network', label: 'Rede', icon: Network, keywords: 'microsserviços' },
      { id: 'boxes', label: 'Serviços', icon: Boxes, keywords: 'containers módulos' },
      { id: 'layers', label: 'Camadas', icon: Layers, keywords: 'arquitetura' },
      { id: 'gauge', label: 'Desempenho', icon: Gauge, keywords: 'carga monitoramento' },
      { id: 'image', label: 'Mídia', icon: Image, keywords: 'imagens upload' },
    ],
  },
  {
    label: 'Pessoal e outros',
    items: [
      { id: 'house', label: 'Casa', icon: House, keywords: 'pessoal home' },
      { id: 'heart', label: 'Pessoal', icon: Heart, keywords: 'saúde favorito' },
      { id: 'gamepad', label: 'Jogos', icon: Gamepad2 },
      { id: 'music', label: 'Música', icon: Music },
      { id: 'book', label: 'Estudos', icon: BookOpen, keywords: 'curso documentação' },
      { id: 'graduation', label: 'Educação', icon: GraduationCap, keywords: 'escola' },
      { id: 'map-pin', label: 'Localização', icon: MapPin, keywords: 'mapa endereço cep' },
      { id: 'car', label: 'Veículos', icon: Car, keywords: 'frota' },
      { id: 'plane', label: 'Viagens', icon: Plane },
      { id: 'stethoscope', label: 'Saúde', icon: Stethoscope, keywords: 'clínica médico' },
      { id: 'pill', label: 'Farmácia', icon: Pill, keywords: 'remédio' },
      { id: 'utensils', label: 'Restaurante', icon: Utensils, keywords: 'comida delivery' },
      { id: 'leaf', label: 'Agro', icon: Leaf, keywords: 'natureza' },
      { id: 'calendar', label: 'Agenda', icon: Calendar, keywords: 'eventos reservas' },
    ],
  },
  {
    label: 'Marcas',
    items: [
      brand('stripe', siStripe, 'pagamento gateway'),
      brand('mercadopago', siMercadopago, 'pagamento gateway'),
      brand('pagseguro', siPagseguro, 'pagamento gateway'),
      brand('pix', siPix, 'pagamento'),
      brand('paypal', siPaypal, 'pagamento'),
      brand('nubank', siNubank, 'banco'),
      brand('picpay', siPicpay, 'pagamento'),
      brand('shopify', siShopify, 'ecommerce loja'),
      brand('vtex', siVtex, 'ecommerce loja'),
      brand('woocommerce', siWoocommerce, 'ecommerce loja'),
      brand('shopee', siShopee, 'marketplace'),
      brand('ifood', siIfood, 'delivery'),
      brand('sap', siSap, 'erp'),
      brand('totvs', siTotvs, 'erp'),
      brand('hubspot', siHubspot, 'crm'),
      brand('whatsapp', siWhatsapp, 'mensagens'),
      brand('telegram', siTelegram, 'mensagens bot'),
      brand('discord', siDiscord, 'mensagens bot'),
      brand('meta', siMeta, 'facebook'),
      brand('instagram', siInstagram),
      brand('mailchimp', siMailchimp, 'email marketing'),
      brand('resend', siResend, 'email'),
      brand('github', siGithub, 'git'),
      brand('gitlab', siGitlab, 'git'),
      brand('jira', siJira, 'tarefas'),
      brand('notion', siNotion, 'documentação'),
      brand('google', siGoogle),
      brand('googlecloud', siGooglecloud, 'nuvem'),
      brand('cloudflare', siCloudflare, 'nuvem'),
      brand('vercel', siVercel, 'deploy'),
      brand('firebase', siFirebase, 'nuvem'),
      brand('supabase', siSupabase, 'banco'),
      brand('auth0', siAuth0, 'login autenticação'),
      brand('clerk', siClerk, 'login autenticação'),
      brand('keycloak', siKeycloak, 'login autenticação'),
      brand('anthropic', siAnthropic, 'ia claude'),
      brand('zapier', siZapier, 'automação'),
      brand('n8n', siN8n, 'automação'),
      brand('docker', siDocker),
      brand('graphql', siGraphql),
      brand('nodejs', siNodedotjs, 'javascript'),
      brand('nestjs', siNestjs, 'javascript'),
      brand('python', siPython),
      brand('dotnet', siDotnet, 'csharp'),
      brand('spring', siSpring, 'java'),
      brand('laravel', siLaravel, 'php'),
      brand('wordpress', siWordpress),
      brand('postgresql', siPostgresql, 'banco'),
      brand('mysql', siMysql, 'banco'),
      brand('mongodb', siMongodb, 'banco'),
      brand('redis', siRedis, 'cache'),
    ],
  },
];

const BY_ID = new Map(ICON_GROUPS.flatMap((g) => g.items.map((item) => [item.id, item] as const)));

export function findIconChoice(id: string | undefined): IconChoice | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** Cores pensadas para o tema escuro (contraste AA com o fundo). */
export const ITEM_COLORS: { value: string; label: string }[] = [
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

// Fundo das duas paletas (ambas quase pretas): basta um para decidir se a cor
// da marca aparece. Marcas pretas (GitHub, Vercel...) usam a cor do texto.
const DARK_BG = '#0E0F1A';
const brandColorCache = new Map<string, string | undefined>();

function visibleBrandColor(si: SimpleIcon): string | undefined {
  if (!brandColorCache.has(si.slug)) {
    const hex = `#${si.hex}`;
    brandColorCache.set(si.slug, contrastRatio(hex, DARK_BG) >= 3 ? hex : undefined);
  }
  return brandColorCache.get(si.slug);
}

export function BrandIcon({
  si,
  className,
  color,
}: {
  si: SimpleIcon;
  className?: string | undefined;
  color?: string | undefined;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn('shrink-0', className)}
      fill={color ?? visibleBrandColor(si) ?? 'currentColor'}
    >
      <path d={si.path} />
    </svg>
  );
}

export function ChoiceIcon({
  choice,
  className,
  color,
}: {
  choice: IconChoice;
  className?: string | undefined;
  color?: string | undefined;
}) {
  if (choice.brand) return <BrandIcon si={choice.brand} className={className} color={color} />;
  const Icon = choice.icon ?? Library;
  return (
    <Icon
      className={cn('shrink-0', className)}
      strokeWidth={1.75}
      {...(color ? { style: { color } satisfies CSSProperties } : {})}
    />
  );
}

export type AppearanceKind = 'collection' | 'folder' | 'environment' | 'tunnel';

const DEFAULT_ICONS: Record<Exclude<AppearanceKind, 'folder'>, LucideIcon> = {
  collection: Library,
  environment: Globe,
  tunnel: Webhook,
};

/** Ícone do item: o escolhido pelo usuário ou o padrão do tipo (pasta abre e fecha). */
export function ItemIcon({
  kind,
  appearance,
  open = false,
  className,
}: {
  kind: AppearanceKind;
  appearance?: Appearance | undefined;
  open?: boolean;
  className?: string | undefined;
}) {
  const choice = findIconChoice(appearance?.icon);
  if (choice) return <ChoiceIcon choice={choice} className={className} color={appearance?.color} />;
  const Icon = kind === 'folder' ? (open ? FolderOpen : Folder) : DEFAULT_ICONS[kind];
  return (
    <Icon
      className={cn('shrink-0', className)}
      strokeWidth={1.75}
      {...(appearance?.color ? { style: { color: appearance.color } } : {})}
    />
  );
}

// Cores das marcas clareadas para o fundo escuro.
const ENGINE_COLORS: Record<DbEngine, string> = {
  postgres: '#7DA7F0',
  mysql: '#F29111',
  firebird: '#F97316',
  sqlserver: '#F15A5A',
};

/**
 * Selo de cada banco: fundo na cor da marca e o símbolo dentro. Firebird e
 * SQL Server não estão no simple-icons, e o logo do MySQL traz o nome escrito
 * (ilegível em 16 px): usam um símbolo ou a sigla.
 */
export function EngineIcon({ engine, className }: { engine: DbEngine; className?: string | undefined }) {
  const color = ENGINE_COLORS[engine];
  const glyph = 'size-[70%]';
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center rounded-[22%]', className)}
      style={{ color, backgroundColor: `${color}26` }}
    >
      {engine === 'postgres' && <BrandIcon si={siPostgresql} className={glyph} color={color} />}
      {engine === 'firebird' && <Flame className={glyph} strokeWidth={2.25} />}
      {engine === 'sqlserver' && <Server className={glyph} strokeWidth={2.25} />}
      {engine === 'mysql' && (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-full">
          <text
            x="12"
            y="16.5"
            textAnchor="middle"
            fontSize="12.5"
            fontWeight="700"
            fill="currentColor"
            fontFamily="inherit"
          >
            My
          </text>
        </svg>
      )}
    </span>
  );
}
