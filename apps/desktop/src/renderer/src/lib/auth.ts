import {
  ancestorsOf,
  type ContainerNode,
  type EffectiveAuth,
  findNode,
  resolveEffectiveAuth,
} from '@rota/core/shared';
import { useMemo } from 'react';
import { useSnapshot } from '../state/workspace';

/**
 * Autenticação que um item herdaria dos ancestrais (pasta -> coleção).
 * `anchorId` é o próprio item (para requisições/pastas salvas) ou o pai
 * (para requisições novas).
 */
export function useInheritedAuth(anchorId: string | null, anchorIsParent = false): EffectiveAuth {
  const snapshot = useSnapshot();
  return useMemo(() => {
    if (!anchorId) return { auth: { type: 'none' }, source: null };
    const chain = anchorIsParent
      ? [findNode(snapshot, anchorId), ...ancestorsOf(snapshot, anchorId)]
      : ancestorsOf(snapshot, anchorId);
    return resolveEffectiveAuth(
      chain
        .filter((n): n is ContainerNode => n !== undefined && n.kind !== 'request')
        .map((n) => ({ kind: n.kind, id: n.id, name: n.name, auth: n.auth })),
    );
  }, [snapshot, anchorId, anchorIsParent]);
}
