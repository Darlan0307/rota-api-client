import { randomUUID } from 'node:crypto';

/** Id estável de itens do workspace (fica dentro do JSON, não no nome do arquivo). */
export function newId(): string {
  return randomUUID();
}
