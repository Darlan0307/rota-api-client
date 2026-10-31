import {
  type Appearance,
  contrastRatio,
  type DbEngine,
  ICON_CATALOG,
  type IconCatalogItem,
  type IconId,
  ITEM_COLORS,
} from '@rota/core/shared';
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
 * Desenho de cada ícone do catálogo (`ICON_CATALOG`, no core, que também é
 * usado pelo MCP). O tipo obriga a cobrir todos os ids. Marcas vêm do
 * simple-icons (CC0).
 */
type Glyph = LucideIcon | SimpleIcon;

const GLYPHS: Record<IconId, Glyph> = {
  library: Library,
  globe: Globe,
  code: Code,
  terminal: Terminal,
  rocket: Rocket,
  puzzle: Puzzle,
  webhook: Webhook,
  bot: Bot,
  sparkles: Sparkles,
  flask: FlaskConical,
  bug: Bug,
  'git-branch': GitBranch,
  star: Star,
  zap: Zap,
  'credit-card': CreditCard,
  wallet: Wallet,
  'qr-code': QrCode,
  banknote: Banknote,
  receipt: Receipt,
  landmark: Landmark,
  coins: Coins,
  'piggy-bank': PiggyBank,
  calculator: Calculator,
  'shopping-cart': ShoppingCart,
  store: Store,
  package: Package,
  tag: Tag,
  truck: Truck,
  warehouse: Warehouse,
  building: Building2,
  briefcase: Briefcase,
  clipboard: ClipboardList,
  spreadsheet: FileSpreadsheet,
  'file-text': FileText,
  chart: ChartColumn,
  users: Users,
  user: User,
  key: KeyRound,
  lock: Lock,
  shield: ShieldCheck,
  fingerprint: Fingerprint,
  mail: Mail,
  message: MessageSquare,
  send: Send,
  smartphone: Smartphone,
  database: Database,
  server: Server,
  cloud: Cloud,
  'hard-drive': HardDrive,
  network: Network,
  boxes: Boxes,
  layers: Layers,
  gauge: Gauge,
  image: Image,
  house: House,
  heart: Heart,
  gamepad: Gamepad2,
  music: Music,
  book: BookOpen,
  graduation: GraduationCap,
  'map-pin': MapPin,
  car: Car,
  plane: Plane,
  stethoscope: Stethoscope,
  pill: Pill,
  utensils: Utensils,
  leaf: Leaf,
  calendar: Calendar,
  'brand:stripe': siStripe,
  'brand:mercadopago': siMercadopago,
  'brand:pagseguro': siPagseguro,
  'brand:pix': siPix,
  'brand:paypal': siPaypal,
  'brand:nubank': siNubank,
  'brand:picpay': siPicpay,
  'brand:shopify': siShopify,
  'brand:vtex': siVtex,
  'brand:woocommerce': siWoocommerce,
  'brand:shopee': siShopee,
  'brand:ifood': siIfood,
  'brand:sap': siSap,
  'brand:totvs': siTotvs,
  'brand:hubspot': siHubspot,
  'brand:whatsapp': siWhatsapp,
  'brand:telegram': siTelegram,
  'brand:discord': siDiscord,
  'brand:meta': siMeta,
  'brand:instagram': siInstagram,
  'brand:mailchimp': siMailchimp,
  'brand:resend': siResend,
  'brand:github': siGithub,
  'brand:gitlab': siGitlab,
  'brand:jira': siJira,
  'brand:notion': siNotion,
  'brand:google': siGoogle,
  'brand:googlecloud': siGooglecloud,
  'brand:cloudflare': siCloudflare,
  'brand:vercel': siVercel,
  'brand:firebase': siFirebase,
  'brand:supabase': siSupabase,
  'brand:auth0': siAuth0,
  'brand:clerk': siClerk,
  'brand:keycloak': siKeycloak,
  'brand:anthropic': siAnthropic,
  'brand:zapier': siZapier,
  'brand:n8n': siN8n,
  'brand:docker': siDocker,
  'brand:graphql': siGraphql,
  'brand:nodejs': siNodedotjs,
  'brand:nestjs': siNestjs,
  'brand:python': siPython,
  'brand:dotnet': siDotnet,
  'brand:spring': siSpring,
  'brand:laravel': siLaravel,
  'brand:wordpress': siWordpress,
  'brand:postgresql': siPostgresql,
  'brand:mysql': siMysql,
  'brand:mongodb': siMongodb,
  'brand:redis': siRedis,
};

export interface IconChoice extends IconCatalogItem {
  icon?: LucideIcon;
  brand?: SimpleIcon;
}

export interface IconGroup {
  label: string;
  items: IconChoice[];
}

// Componentes do lucide também são objetos (forwardRef): a marca se reconhece pelo path.
const isBrand = (glyph: Glyph): glyph is SimpleIcon => 'path' in glyph && 'hex' in glyph;

export const ICON_GROUPS: IconGroup[] = ICON_CATALOG.map((group) => ({
  label: group.label,
  items: group.items.map((item): IconChoice => {
    const glyph = GLYPHS[item.id];
    return { ...item, ...(isBrand(glyph) ? { brand: glyph } : { icon: glyph }) };
  }),
}));

const BY_ID = new Map(ICON_GROUPS.flatMap((g) => g.items.map((item) => [item.id, item] as const)));

export function findIconChoice(id: string | undefined): IconChoice | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export { ITEM_COLORS };

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
