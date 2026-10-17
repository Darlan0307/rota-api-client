import { Download, FolderOpen, Layers, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Kbd } from '../components/Kbd';
import { Logo } from '../components/Logo';
import { ContainerTabView } from '../features/collection/ContainerTabView';
import { ExampleTabView } from '../features/examples/ExampleTabView';
import { LoadTestView } from '../features/loadtest/LoadTestView';
import { RequestEditor } from '../features/request/RequestEditor';
import { newCollection, newEnvironment } from '../features/sidebar/item-actions';
import { VariablesTabView } from '../features/variables/VariablesTabView';
import { useActiveTab, useTabs } from '../state/tabs';
import { TabBar } from './TabBar';

/** Ações da tela inicial que dependem de fases seguintes (importar, abrir pasta). */
export interface WelcomeExtensions {
  onImport?: () => void;
  onOpenFolder?: () => void;
}
let welcome: WelcomeExtensions = {};
export function registerWelcomeExtensions(ext: WelcomeExtensions): void {
  welcome = { ...welcome, ...ext };
}

export function MainArea() {
  const tab = useActiveTab();

  return (
    <div className="flex h-full min-w-0 flex-col">
      <TabBar />
      <div className="min-h-0 flex-1">
        {!tab && <WelcomeScreen />}
        {tab?.kind === 'request' && <RequestEditor key={tab.id} tab={tab} />}
        {(tab?.kind === 'environment' || tab?.kind === 'globals') && (
          <VariablesTabView key={tab.id} tab={tab} />
        )}
        {tab?.kind === 'example' && <ExampleTabView key={tab.id} tab={tab} />}
        {tab?.kind === 'loadtest' && <LoadTestView key={tab.id} tab={tab} />}
        {(tab?.kind === 'collection' || tab?.kind === 'folder') && (
          <ContainerTabView key={tab.id} tab={tab} />
        )}
      </div>
    </div>
  );
}

function WelcomeScreen() {
  const openNewRequest = useTabs((s) => s.openNewRequest);

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
          <WelcomeAction
            icon={<Plus className="size-4" />}
            label="Nova requisição"
            shortcut="Ctrl+T"
            onClick={() => openNewRequest()}
          />
          <WelcomeAction
            icon={<Plus className="size-4" />}
            label="Nova coleção"
            onClick={() => void newCollection()}
          />
          <WelcomeAction
            icon={<Layers className="size-4" />}
            label="Novo ambiente"
            onClick={() => void newEnvironment()}
          />
          {welcome.onImport && (
            <WelcomeAction
              icon={<Download className="size-4" />}
              label="Importar (Postman ou OpenAPI)"
              onClick={welcome.onImport}
            />
          )}
          {welcome.onOpenFolder && (
            <WelcomeAction
              icon={<FolderOpen className="size-4" />}
              label="Abrir pasta como workspace"
              onClick={welcome.onOpenFolder}
            />
          )}
        </div>

        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-2.5 border-t border-border pt-6 text-xs text-fg-muted">
          <Shortcut label="Enviar requisição" keys="Ctrl+Enter" />
          <Shortcut label="Salvar" keys="Ctrl+S" />
          <Shortcut label="Buscar" keys="Ctrl+P" />
          <Shortcut label="Fechar aba" keys="Ctrl+W" />
          <Shortcut label="Nova aba" keys="Ctrl+T" />
          <Shortcut label="Recolher sidebar" keys="Ctrl+B" />
          <Shortcut label="Renomear item" keys="Ctrl+E" />
          <Shortcut label="Duplicar item" keys="Ctrl+D" />
        </div>
      </div>
    </div>
  );
}

function WelcomeAction({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-fg transition-colors hover:bg-surface-2"
    >
      <span className="text-primary">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && <Kbd keys={shortcut} />}
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
