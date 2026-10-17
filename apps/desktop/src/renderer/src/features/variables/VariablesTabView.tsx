import { CheckCircle2, Globe, Lock, Save } from 'lucide-react';
import { Button } from '../../components/Button';
import { Tooltip } from '../../components/Tooltip';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { saveTab } from '../../state/actions';
import { isDirty, useTabs, type VariablesTab } from '../../state/tabs';
import { useActiveEnvironmentId } from '../../state/workspace';
import { ConflictBanner } from '../conflict/ConflictBanner';
import { VariablesEditor } from './VariablesEditor';

/** Aba de edição de um ambiente ou das variáveis globais. */
export function VariablesTabView({ tab }: { tab: VariablesTab }) {
  const update = useTabs((s) => s.update);
  const activeEnvId = useActiveEnvironmentId();
  const isEnv = tab.kind === 'environment';
  const isActive = isEnv && tab.itemId === activeEnvId;
  const dirty = isDirty(tab);
  const target =
    isEnv && tab.itemId ? { kind: 'environment' as const, id: tab.itemId } : { kind: 'global' as const };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <ConflictBanner tab={tab} />
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <Globe className="size-4 text-fg-subtle" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{tab.title}</h1>
          <p className="text-xs text-fg-muted">
            {isEnv
              ? 'Ambiente: sobrepõe variáveis globais e da coleção.'
              : 'Valem em todas as coleções, com a menor prioridade.'}
          </p>
        </div>
        {isEnv && tab.itemId && (
          <Button
            size="sm"
            variant={isActive ? 'ghost' : 'secondary'}
            disabled={isActive}
            onClick={() => void api.invoke('workspace:setActiveEnvironment', tab.itemId)}
          >
            <CheckCircle2 className={cn('size-3.5', isActive && 'text-primary')} />
            {isActive ? 'Ambiente ativo' : 'Ativar'}
          </Button>
        )}
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
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <VariablesEditor
          drafts={tab.draft}
          onChange={(draft) => update<VariablesTab>(tab.id, (t) => ({ ...t, draft }))}
          target={target}
        />
        <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-subtle">
          <Lock className="size-3" />
          Variáveis secretas ficam cifradas só nesta máquina; no arquivo versionado vai apenas o nome.
        </p>
      </div>
    </div>
  );
}
