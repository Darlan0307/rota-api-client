import { cn } from '../lib/cn';
import { type HttpMethod, methodShortLabel, methodTextClass } from '../lib/http-method';

/** Método HTTP como texto colorido discreto (sem fundo), alinhado em largura fixa. */
export function MethodBadge({
  method,
  short = true,
  className,
}: {
  method: HttpMethod;
  short?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'shrink-0 font-mono text-2xs font-semibold tracking-wide',
        short && 'w-10',
        methodTextClass(method),
        className,
      )}
    >
      {short ? methodShortLabel(method) : method}
    </span>
  );
}
