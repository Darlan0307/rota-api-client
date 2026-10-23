import {
  type ContextItem,
  composeUrl,
  type DbEngine,
  type DbQueryResult,
  type DbTable,
  type TableProfile,
} from '@rota/core/shared';
import { create } from 'zustand';
import type { RequestTab } from '../../state/tabs';
import { useToasts } from '../../state/toasts';

type NewItem = ContextItem extends infer T ? (T extends ContextItem ? Omit<T, 'id'> : never) : never;

/**
 * Pacote de contexto montado à mão. Fica só na memória (como as respostas das
 * abas): pode ter dados de respostas e de bancos, então não vai para o disco
 * até você salvar.
 */
export const useContextPack = create<{ items: ContextItem[]; open: boolean }>()(() => ({
  items: [],
  open: false,
}));

export function openContextPack(open = true): void {
  useContextPack.setState({ open });
}

export function addToPack(item: NewItem, options: { silent?: boolean } = {}): void {
  const entry = { ...item, id: crypto.randomUUID() } as ContextItem;
  useContextPack.setState((s) => ({ items: [...s.items, entry] }));
  if (options.silent) return;
  const count = useContextPack.getState().items.length;
  useToasts.getState().push('success', `"${item.title}" no pacote de contexto (${count}).`, {
    action: { label: 'Ver pacote', run: () => openContextPack() },
  });
}

export function updatePackItem(
  id: string,
  change: Partial<Pick<ContextItem, 'title'>> & { text?: string },
): void {
  useContextPack.setState((s) => ({
    items: s.items.map((item) =>
      item.id !== id
        ? item
        : item.kind === 'note'
          ? { ...item, ...change }
          : { ...item, ...(change.title !== undefined ? { title: change.title } : {}) },
    ),
  }));
}

export function removeFromPack(id: string): void {
  useContextPack.setState((s) => ({ items: s.items.filter((i) => i.id !== id) }));
}

export function movePackItem(id: string, delta: -1 | 1): void {
  useContextPack.setState((s) => {
    const index = s.items.findIndex((i) => i.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= s.items.length) return s;
    const items = [...s.items];
    [items[index], items[target]] = [items[target] as ContextItem, items[index] as ContextItem];
    return { items };
  });
}

export function clearPack(): void {
  useContextPack.setState({ items: [] });
}

// ---------------------------------------------------------------------------
// Atalhos para cada origem

function bodyText(tab: RequestTab): string | undefined {
  const body = tab.draft.body;
  if (body.mode === 'json' || body.mode === 'raw') return body.text;
  if (body.mode === 'urlencoded' || body.mode === 'formdata')
    return body.fields
      .filter((f) => f.enabled && f.key)
      .map((f) => `${f.key}=${'type' in f && f.type === 'file' ? '(arquivo)' : f.value}`)
      .join('\n');
  return undefined;
}

/** A requisição como está no editor ({{variáveis}}) e a resposta exibida. */
export function addRequestToPack(tab: RequestTab): void {
  const response = tab.run?.result?.response;
  const body = bodyText(tab);
  const contentType = response?.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1];
  addToPack({
    kind: 'request',
    title: tab.title,
    method: tab.draft.method,
    url: composeUrl(tab.draft.url, tab.draft.query),
    headers: tab.draft.headers.filter((h) => h.enabled && h.key).map(({ key, value }) => ({ key, value })),
    ...(body?.trim() ? { body } : {}),
    ...(response
      ? {
          response: {
            status: response.status,
            statusText: response.statusText,
            timeMs: response.timings.total,
            ...(contentType ? { contentType } : {}),
            body: response.body.encoding === 'utf8' ? response.body.data : '(resposta binária)',
          },
        }
      : {}),
    ...(tab.itemId ? { requestId: tab.itemId } : {}),
  });
}

export function addTablesToPack(
  engine: DbEngine,
  tables: readonly DbTable[],
  samples: Readonly<Record<string, DbQueryResult | null>> = {},
): void {
  for (const table of tables)
    addToPack(
      { kind: 'table', title: table.name, engine, table, sample: samples[table.name] ?? null },
      { silent: tables.length > 1 && table !== tables.at(-1) },
    );
}

export function addProfileToPack(profile: TableProfile): void {
  addToPack({ kind: 'profile', title: `Perfil de ${profile.table}`, profile });
}

export function addNoteToPack(): void {
  addToPack({ kind: 'note', title: 'Nota', text: '' }, { silent: true });
}
