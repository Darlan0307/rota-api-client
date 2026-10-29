import { findNode } from '@rota/core/shared';
import { Save } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../../components/Button';
import { TextArea } from '../../components/form';
import { TabStrip } from '../../components/TabStrip';
import { Tooltip } from '../../components/Tooltip';
import { useInheritedAuth } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { ItemIcon } from '../../lib/item-icons';
import { VariableContextProvider } from '../../lib/variables';
import { saveTab } from '../../state/actions';
import { type CollectionTab, type FolderTab, isDirty, useTabs } from '../../state/tabs';
import { useSnapshot } from '../../state/workspace';
import { openAppearanceDialog } from '../appearance/AppearanceDialog';
import { ConflictBanner } from '../conflict/ConflictBanner';
import { AuthEditor } from '../request/AuthEditor';
import { openItemById } from '../request/open';
import { ScriptsEditor } from '../scripts/ScriptsEditor';
import { VariablesEditor } from '../variables/VariablesEditor';

/** Configurações de uma coleção ou pasta (auth herdável, variáveis, descrição). */
export function ContainerTabView({ tab }: { tab: CollectionTab | FolderTab }) {
  const update = useTabs((s) => s.update);
  const dirty = isDirty(tab);
  const inherited = useInheritedAuth(tab.kind === 'folder' ? tab.itemId : null);
  const isCollection = tab.kind === 'collection';
  const snapshot = useSnapshot();
  const found = tab.itemId ? findNode(snapshot, tab.itemId) : undefined;
  const node = found && found.kind !== 'request' ? found : undefined;

  const sections: { id: string; label: string }[] = isCollection
    ? [
        { id: 'variables', label: 'Variáveis' },
        { id: 'auth', label: 'Autenticação' },
        { id: 'scripts', label: 'Scripts' },
        { id: 'description', label: 'Descrição' },
      ]
    : [
        { id: 'auth', label: 'Autenticação' },
        { id: 'scripts', label: 'Scripts' },
        { id: 'description', label: 'Descrição' },
      ];

  const setSection = (section: string) =>
    update<CollectionTab | FolderTab>(tab.id, (t) => ({ ...t, section }) as typeof t);
  const setDraft = (patch: Partial<CollectionTab['draft']>) =>
    update<CollectionTab | FolderTab>(tab.id, (t) => ({ ...t, draft: { ...t.draft, ...patch } }) as typeof t);

  let content: ReactNode = null;
  if (tab.section === 'variables' && tab.kind === 'collection') {
    content = (
      <div className="p-6">
        <VariablesEditor
          drafts={tab.draft.variables}
          onChange={(variables) => setDraft({ variables })}
          target={{ kind: 'collection', id: tab.itemId ?? '' }}
        />
        <p className="mt-3 text-xs text-fg-subtle">
          Variáveis da coleção valem para todas as requisições dela. Um ambiente ativo com a mesma variável
          tem prioridade.
        </p>
      </div>
    );
  } else if (tab.section === 'scripts') {
    content = (
      <ScriptsEditor
        scripts={tab.draft.scripts}
        onChange={(scripts) => setDraft({ scripts })}
        scopeNote={
          isCollection
            ? 'Vale para todas as requisições da coleção e roda antes dos scripts das pastas e da requisição.'
            : 'Vale para todas as requisições da pasta e roda antes do script da requisição.'
        }
      />
    );
  } else if (tab.section === 'auth') {
    content = (
      <AuthEditor
        auth={tab.draft.auth}
        onChange={(auth) => setDraft({ auth })}
        allowInherit={!isCollection}
        inherited={inherited}
        onOpenSource={openItemById}
      />
    );
  } else {
    content = (
      <div className="max-w-2xl p-6">
        <TextArea
          rows={12}
          value={tab.draft.description}
          onChange={(e) => setDraft({ description: e.target.value })}
          placeholder="Documente esta coleção/pasta: objetivo, como autenticar, observações…"
        />
      </div>
    );
  }

  return (
    <VariableContextProvider itemId={tab.itemId}>
      <div className="flex h-full min-h-0 flex-col bg-bg">
        <ConflictBanner tab={tab} />
        <div className="flex h-14 shrink-0 items-center gap-3 px-6">
          <Tooltip label="Ícone e cor">
            <button
              type="button"
              aria-label="Ícone e cor"
              disabled={!node}
              onClick={() =>
                node &&
                openAppearanceDialog({
                  id: node.id,
                  name: node.name,
                  kind: tab.kind,
                  appearance: node.appearance,
                })
              }
              className="flex size-8 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <ItemIcon kind={tab.kind} appearance={node?.appearance} className="size-4" />
            </button>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{tab.title}</h1>
            <p className="text-xs text-fg-muted">
              {isCollection ? 'Configurações da coleção' : 'Configurações da pasta'}
            </p>
          </div>
          <Tooltip label="Salvar" shortcut="Ctrl+S">
            <Button
              size="sm"
              variant={dirty ? 'primary' : 'ghost'}
              disabled={!dirty}
              onClick={() => void saveTab(tab.id)}
            >
              <Save className="size-3.5" /> Salvar
            </Button>
          </Tooltip>
        </div>
        <TabStrip
          activeKey={tab.section}
          className="h-10 shrink-0 items-stretch gap-4 border-b border-border px-6"
        >
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={tab.section === s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                'relative flex shrink-0 items-center text-[13px] transition-colors',
                tab.section === s.id ? 'text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {s.label}
              {tab.section === s.id && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </TabStrip>
        <div className="min-h-0 flex-1 overflow-auto">{content}</div>
      </div>
    </VariableContextProvider>
  );
}
