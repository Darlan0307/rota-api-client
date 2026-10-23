import type { DbCredentialView } from '@rota/core/shared';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { TextInput } from '../../components/form';
import { IconButton } from '../../components/IconButton';
import { api, errorMessage } from '../../lib/api';
import { confirmDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';
import { setCredentialsOpen, useDatabases } from './state';

const connectionsText = (n: number) => (n === 1 ? '1 conexão' : `${n} conexões`);

/** Usuário e senha reaproveitados por várias conexões (ex.: o mesmo SYSDBA em vários servidores). */
export function CredentialsDialog() {
  const open = useDatabases((s) => s.credentialsOpen);
  const credentials = useDatabases((s) => s.credentials);
  return (
    <Dialog
      open={open}
      onOpenChange={setCredentialsOpen}
      title="Credenciais salvas"
      className="w-[min(560px,calc(100vw-32px))]"
    >
      <div className="space-y-3 px-5 py-4">
        <p className="text-xs leading-relaxed text-fg-muted">
          Quando várias conexões usam o mesmo usuário e senha, salve uma vez aqui e escolha a credencial em
          cada conexão. Trocar a senha aqui vale para todas. A senha fica cifrada neste PC.
        </p>
        {credentials.map((c) => (
          <CredentialRow key={c.id} credential={c} />
        ))}
        <CredentialRow credential={null} />
      </div>
    </Dialog>
  );
}

function CredentialRow({ credential }: { credential: DbCredentialView | null }) {
  const [name, setName] = useState(credential?.name ?? '');
  const [user, setUser] = useState(credential?.user ?? 'SYSDBA');
  const [password, setPassword] = useState('');
  const isNew = credential === null;
  const dirty = isNew
    ? name.trim() !== '' && password !== ''
    : name !== credential.name || user !== credential.user || password !== '';

  async function save() {
    try {
      await api.invoke(
        'db:saveCredential',
        { ...(credential ? { id: credential.id } : {}), name, user },
        password ? password : undefined,
      );
      setPassword('');
      if (isNew) {
        setName('');
        setUser('SYSDBA');
      }
      toast.success(isNew ? 'Credencial salva.' : 'Credencial atualizada.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function remove() {
    if (!credential) return;
    const choice = await confirmDialog({
      title: `Excluir a credencial "${credential.name}"?`,
      description:
        credential.usedBy > 0
          ? `${connectionsText(credential.usedBy)} ${credential.usedBy === 1 ? 'usa' : 'usam'} esta credencial: ${credential.usedBy === 1 ? 'ela mantém' : 'elas mantêm'} o usuário, mas vai pedir a senha de novo.`
          : 'A senha salva é apagada.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (choice !== 'confirm') return;
    try {
      await api.invoke('db:removeCredential', credential.id);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-center gap-2 text-xs">
        {isNew ? <Plus className="size-3.5 text-primary" /> : <KeyRound className="size-3.5 text-success" />}
        <span className="flex-1 font-medium text-fg">
          {isNew
            ? 'Nova credencial'
            : `Usada em ${connectionsText(credential.usedBy)}${credential.hasPassword ? '' : ' · sem senha'}`}
        </span>
        {!isNew && (
          <IconButton icon={Trash2} label="Excluir credencial" size="sm" onClick={() => void remove()} />
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
        <TextInput
          value={name}
          placeholder="Nome (ex.: SYSDBA padrão)"
          onChange={(e) => setName(e.target.value)}
        />
        <TextInput mono value={user} placeholder="Usuário" onChange={(e) => setUser(e.target.value)} />
        <TextInput
          mono
          type="password"
          autoComplete="off"
          value={password}
          placeholder={credential?.hasPassword ? '•••••• (salva)' : 'Senha'}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && dirty && void save()}
        />
        <Button
          size="sm"
          className="h-8"
          variant={isNew ? 'primary' : 'secondary'}
          disabled={!dirty}
          onClick={() => void save()}
        >
          {isNew ? 'Adicionar' : 'Salvar'}
        </Button>
      </div>
    </div>
  );
}
