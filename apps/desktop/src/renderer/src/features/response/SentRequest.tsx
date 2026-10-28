import type { HttpResponse, PreparedRequest } from '@rota/core/shared';
import { Copy, Info } from 'lucide-react';
import { IconButton } from '../../components/IconButton';
import { cn } from '../../lib/cn';
import { formatBytes } from '../../lib/format';
import { methodTextClass } from '../../lib/http-method';
import { toast } from '../../state/toasts';

/** Acima disso o corpo é cortado na tela (a cópia leva tudo). */
const MAX_SHOWN_CHARS = 512 * 1024;

/**
 * A requisição como saiu: URL e corpo com as variáveis trocadas (e o que os
 * pré-scripts mudaram) e os headers lidos da conexão. Segredos chegam mascarados.
 */
export function SentRequest({
  request,
  response,
}: {
  request: PreparedRequest;
  response?: HttpResponse | undefined;
}) {
  // Sem os da conexão (via proxy, envio sem resposta ou histórico antigo), mostra os que o Rota montou.
  const fromWire = response?.sentHeaders !== undefined;
  const headers = response?.sentHeaders ?? request.headers;
  const body = request.body;
  const text = body.kind === 'text' ? body.text : '';

  const copy = (value: string, what: string) => {
    void navigator.clipboard.writeText(value);
    toast.success(`${what} copiado.`);
  };

  return (
    <div className="min-h-0 flex-1 select-text overflow-auto p-4 text-xs">
      <div className="flex items-start gap-2">
        <span className={cn('shrink-0 font-mono font-semibold', methodTextClass(request.method))}>
          {request.method}
        </span>
        <span className="min-w-0 flex-1 break-all font-mono text-fg">{request.url}</span>
        <IconButton icon={Copy} label="Copiar URL" size="sm" onClick={() => copy(request.url, 'URL')} />
      </div>

      <h3 className="mt-5 mb-1 text-2xs font-medium uppercase tracking-wider text-fg-subtle">
        Headers ({headers.length})
      </h3>
      <table className="w-full">
        <tbody>
          {headers.map(([k, v], i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: headers podem se repetir
            <tr key={i} className="border-b border-border last:border-0">
              <td className="w-1/3 py-1.5 pr-4 align-top font-mono text-fg-muted">{k}</td>
              <td className="break-all py-1.5 font-mono text-fg">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!fromWire && (
        <p className="mt-2 flex items-start gap-1.5 text-fg-subtle">
          <Info className="mt-px size-3.5 shrink-0" />
          Headers como o Rota montou. Os da conexão (Host, Connection, Content-Length) não foram registrados
          neste envio: via proxy, sem resposta ou envio antigo do histórico.
        </p>
      )}

      <div className="mt-5 mb-1 flex h-6 items-center gap-2">
        <h3 className="text-2xs font-medium uppercase tracking-wider text-fg-subtle">Body</h3>
        {body.kind === 'text' && (
          <>
            <span className="text-2xs text-fg-subtle">
              {formatBytes(new TextEncoder().encode(text).length)}
            </span>
            <div className="flex-1" />
            <IconButton icon={Copy} label="Copiar body" size="sm" onClick={() => copy(text, 'Body')} />
          </>
        )}
      </div>
      {body.kind === 'none' && <p className="text-fg-subtle">Sem corpo.</p>}
      {body.kind === 'text' && (
        <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-surface p-3 font-mono text-fg">
          {text.length > MAX_SHOWN_CHARS ? `${text.slice(0, MAX_SHOWN_CHARS)}\n…` : text}
        </pre>
      )}
      {body.kind === 'formdata' && (
        <table className="w-full">
          <tbody>
            {body.fields.map((f, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: campos podem se repetir
              <tr key={i} className="border-b border-border last:border-0">
                <td className="w-1/3 py-1.5 pr-4 align-top font-mono text-fg-muted">{f.key}</td>
                <td className="break-all py-1.5 font-mono text-fg">
                  {f.type === 'file' ? <span className="text-fg-muted">arquivo: {f.value}</span> : f.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-4 text-fg-subtle">Valores secretos aparecem como ••••••.</p>
    </div>
  );
}
