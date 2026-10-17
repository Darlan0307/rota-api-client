import type { Auth } from '../model/schemas';

export interface AuthOwner {
  kind: 'collection' | 'folder' | 'request';
  id: string;
  name: string;
  auth: Auth;
}

export interface EffectiveAuth {
  auth: Exclude<Auth, { type: 'inherit' }>;
  /** De onde veio a autenticação (null = nenhuma definida em lugar algum). */
  source: Omit<AuthOwner, 'auth'> | null;
}

/**
 * Resolve a herança como no Postman: "herdar" sobe para a pasta pai, depois
 * para a coleção. Se ninguém define, não há autenticação.
 *
 * @param chain do item atual até a coleção (ex.: [requisição, pasta, coleção]).
 */
export function resolveEffectiveAuth(chain: readonly AuthOwner[]): EffectiveAuth {
  for (const owner of chain) {
    if (owner.auth.type === 'inherit') continue;
    const { auth, ...source } = owner;
    return { auth: owner.auth, source };
  }
  return { auth: { type: 'none' }, source: null };
}
