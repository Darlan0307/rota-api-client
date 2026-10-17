import type { Auth, AuthType, EffectiveAuth } from '@rota/core/shared';
import { ArrowUpRight, KeyRound, ShieldOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { Field, Select, type SelectOption } from '../../components/form';
import { VariableInput } from '../../components/VariableInput';

const AUTH_OPTIONS: SelectOption<AuthType>[] = [
  { value: 'inherit', label: 'Herdar do pai' },
  { value: 'none', label: 'Sem autenticação' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'apikey', label: 'API Key' },
];

function defaultAuth(type: AuthType, previous: Auth): Auth {
  switch (type) {
    case 'inherit':
    case 'none':
      return { type };
    case 'bearer':
      return { type, token: previous.type === 'bearer' ? previous.token : '' };
    case 'basic':
      return { type, username: '', password: '' };
    case 'apikey':
      return { type, key: '', value: '', in: 'header' };
  }
}

const SOURCE_KIND: Record<string, string> = { collection: 'coleção', folder: 'pasta', request: 'requisição' };

interface AuthEditorProps {
  auth: Auth;
  onChange: (auth: Auth) => void;
  /** Coleções não herdam de ninguém. */
  allowInherit: boolean;
  inherited?: EffectiveAuth | undefined;
  /** Abre o item de onde a auth é herdada. */
  onOpenSource?: ((id: string) => void) | undefined;
}

export function AuthEditor({ auth, onChange, allowInherit, inherited, onOpenSource }: AuthEditorProps) {
  const options = allowInherit ? AUTH_OPTIONS : AUTH_OPTIONS.filter((o) => o.value !== 'inherit');

  return (
    <div className="grid gap-6 p-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <div className="space-y-2">
        <Field label="Tipo">
          <Select
            value={auth.type}
            options={options}
            onChange={(type) => onChange(defaultAuth(type, auth))}
            triggerClassName="w-full h-8"
            ariaLabel="Tipo de autenticação"
          />
        </Field>
        <p className="text-xs leading-relaxed text-fg-subtle">
          {auth.type === 'inherit'
            ? 'Usa a autenticação da pasta ou coleção acima, como no Postman.'
            : 'O header de autenticação é gerado no envio. Use {{variáveis}} para não deixar segredos no arquivo.'}
        </p>
      </div>

      <div className="min-w-0 max-w-xl">
        {auth.type === 'inherit' && <InheritInfo inherited={inherited} onOpenSource={onOpenSource} />}
        {auth.type === 'none' && (
          <EmptyState
            compact
            icon={ShieldOff}
            title="Sem autenticação"
            description="Nenhum header de autenticação será enviado."
          />
        )}
        {auth.type === 'bearer' && (
          <Field label="Token">
            <Box>
              <VariableInput
                value={auth.token}
                onChange={(token) => onChange({ ...auth, token })}
                placeholder="{{ACCESS_TOKEN}}"
              />
            </Box>
          </Field>
        )}
        {auth.type === 'basic' && (
          <div className="space-y-4">
            <Field label="Usuário">
              <Box>
                <VariableInput
                  value={auth.username}
                  onChange={(username) => onChange({ ...auth, username })}
                />
              </Box>
            </Field>
            <Field label="Senha" hint="Dica: use uma variável secreta, ex.: {{SENHA}}.">
              <Box>
                <VariableInput
                  value={auth.password}
                  onChange={(password) => onChange({ ...auth, password })}
                />
              </Box>
            </Field>
          </div>
        )}
        {auth.type === 'apikey' && (
          <div className="space-y-4">
            <Field label="Nome">
              <Box>
                <VariableInput
                  value={auth.key}
                  onChange={(key) => onChange({ ...auth, key })}
                  placeholder="X-API-Key"
                />
              </Box>
            </Field>
            <Field label="Valor">
              <Box>
                <VariableInput
                  value={auth.value}
                  onChange={(value) => onChange({ ...auth, value })}
                  placeholder="{{API_KEY}}"
                />
              </Box>
            </Field>
            <Field label="Enviar em">
              <Select
                value={auth.in}
                options={[
                  { value: 'header', label: 'Header' },
                  { value: 'query', label: 'Query params' },
                ]}
                onChange={(where) => onChange({ ...auth, in: where })}
                triggerClassName="w-40 h-8"
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

function Box({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-8 items-stretch rounded-md border border-border bg-surface-2 transition-colors focus-within:border-primary hover:border-border-strong">
      {children}
    </div>
  );
}

function InheritInfo({ inherited, onOpenSource }: Pick<AuthEditorProps, 'inherited' | 'onOpenSource'>) {
  if (!inherited?.source) {
    return (
      <EmptyState
        compact
        icon={KeyRound}
        title="Nada para herdar"
        description="Nenhuma pasta ou coleção acima define autenticação; nada será enviado."
      />
    );
  }
  const labels: Record<Auth['type'], string> = {
    inherit: 'Herdar',
    none: 'Sem autenticação',
    bearer: 'Bearer Token',
    basic: 'Basic Auth',
    apikey: 'API Key',
  };
  const source = inherited.source;
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-fg-muted">Herdando de {SOURCE_KIND[source.kind] ?? source.kind}</p>
      <button
        type="button"
        onClick={() => onOpenSource?.(source.id)}
        className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
      >
        {source.name}
        <ArrowUpRight className="size-3.5" />
      </button>
      <p className="mt-3 text-[13px] text-fg">{labels[inherited.auth.type]}</p>
    </div>
  );
}
