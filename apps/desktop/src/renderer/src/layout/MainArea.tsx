import { Download, FolderOpen, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { Kbd } from '../components/Kbd';
import { Logo } from '../components/Logo';
import { cn } from '../lib/cn';
import { useUiStore } from '../state/ui';
import { RequestPane, ResponsePane } from './RequestPane';
import { TabBar } from './TabBar';

export function MainArea() {
  const activeTab = useUiStore((s) => s.tabs.find((t) => t.id === s.activeTabId));

  return (
    <div className="flex h-full min-w-0 flex-col">
      <TabBar />
      <div className="min-h-0 flex-1">
        {activeTab ? <RequestResponseSplit key={activeTab.id} tab={activeTab} /> : <WelcomeScreen />}
      </div>
    </div>
  );
}

function RequestResponseSplit({ tab }: { tab: Parameters<typeof RequestPane>[0]['tab'] }) {
  const paneLayout = useUiStore((s) => s.paneLayout);
  // Layout separado por orientação, para cada modo lembrar o seu próprio tamanho.
  const layout = useDefaultLayout({ id: `request-response-${paneLayout}`, storage: localStorage });

  return (
    <Group
      key={paneLayout}
      orientation={paneLayout}
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
      className="h-full"
    >
      <Panel id="request" minSize="25%" defaultSize="50%">
        <RequestPane tab={tab} />
      </Panel>
      <ResizeHandle vertical={paneLayout === 'vertical'} />
      <Panel id="response" minSize="20%" defaultSize="50%">
        <ResponsePane />
      </Panel>
    </Group>
  );
}

export function ResizeHandle({ vertical = false }: { vertical?: boolean }) {
  return (
    <Separator
      className={cn(
        'group relative shrink-0 bg-border outline-none transition-colors',
        'data-[separator=hover]:bg-primary data-[separator=active]:bg-primary focus-visible:bg-primary',
        vertical ? 'h-px w-full' : 'h-full w-px',
      )}
    />
  );
}

function WelcomeScreen() {
  const newTab = useUiStore((s) => s.newTab);

  return (
    <div className="flex h-full items-center justify-center bg-bg p-8 animate-fade-in">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <Logo size={40} />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Comece por aqui</h1>
            <p className="text-[13px] text-fg-muted">Abra uma requisição da sidebar ou crie uma nova.</p>
          </div>
        </div>

        <div className="space-y-1">
          <WelcomeAction icon={<Plus className="size-4" />} label="Nova requisição" onClick={newTab} />
          <WelcomeAction icon={<Download className="size-4" />} label="Importar do Postman" hint="Fase 3" />
          <WelcomeAction
            icon={<FolderOpen className="size-4" />}
            label="Abrir pasta como workspace"
            hint="Fase 6"
          />
        </div>

        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-2.5 border-t border-border pt-6 text-xs text-fg-muted">
          <Shortcut label="Enviar requisição" keys="Ctrl+Enter" />
          <Shortcut label="Salvar" keys="Ctrl+S" />
          <Shortcut label="Buscar" keys="Ctrl+P" />
          <Shortcut label="Fechar aba" keys="Ctrl+W" />
        </div>
      </div>
    </div>
  );
}

function WelcomeAction({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-fg transition-colors hover:bg-surface-2 disabled:text-fg-muted disabled:hover:bg-transparent"
    >
      <span className="text-primary">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-2xs text-fg-subtle">{hint}</span>}
    </button>
  );
}

function Shortcut({ label, keys }: { label: string; keys: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <Kbd keys={keys} />
    </div>
  );
}
