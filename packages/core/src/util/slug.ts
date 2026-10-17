const MAX_SLUG_LENGTH = 60;
const FALLBACK_SLUG = 'sem-nome';

// Nomes reservados pelo Windows que não podem ser usados como nome de arquivo.
const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/**
 * Converte um nome livre ("Listar usuários (v2)") em um slug seguro para
 * nome de arquivo em qualquer sistema ("listar-usuarios-v2").
 */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');

  if (slug === '') return FALLBACK_SLUG;
  if (WINDOWS_RESERVED.has(slug)) return `${slug}-1`;
  return slug;
}

/**
 * Gera um slug que não colide com os já existentes na mesma pasta,
 * acrescentando um sufixo numérico ("nome", "nome-2", "nome-3", ...).
 * A comparação ignora maiúsculas/minúsculas, como o sistema de arquivos do Windows.
 */
export function uniqueSlug(name: string, existing: Iterable<string>): string {
  const taken = new Set(Array.from(existing, (s) => s.toLowerCase()));
  const base = slugify(name);
  if (!taken.has(base)) return base;

  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
