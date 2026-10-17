import { errorMessage } from '../lib/api';
import { toast, useToasts } from './toasts';

/**
 * Desfazer a última ação na árvore (excluir, mover, renomear, duplicar): um
 * aviso com "Desfazer" e o atalho Ctrl+Z fora dos campos de texto.
 */

interface UndoEntry {
  undo: () => Promise<unknown>;
  toastId: number;
  expiresAt: number;
  done: boolean;
}

/** Tempo do aviso na tela e do Ctrl+Z depois dele. */
const TOAST_MS = 6000;
const SHORTCUT_MS = 60_000;

let last: UndoEntry | null = null;

export function offerUndo(message: string, undo: () => Promise<unknown>): void {
  const entry: UndoEntry = { undo, toastId: 0, expiresAt: Date.now() + SHORTCUT_MS, done: false };
  entry.toastId = useToasts.getState().push('success', message, {
    action: { label: 'Desfazer', run: () => void runUndo(entry) },
    duration: TOAST_MS,
  });
  last = entry;
}

async function runUndo(entry: UndoEntry): Promise<void> {
  if (entry.done) return;
  entry.done = true;
  if (last === entry) last = null;
  useToasts.getState().dismiss(entry.toastId);
  try {
    await entry.undo();
    toast.info('Desfeito.');
  } catch (error) {
    toast.error(`Não foi possível desfazer: ${errorMessage(error)}`);
  }
}

/** Desfaz a última ação, se ainda houver. Devolve false quando não há o que desfazer. */
export function undoLast(): boolean {
  if (!last || last.done || Date.now() > last.expiresAt) return false;
  void runUndo(last);
  return true;
}
