import type { ReactNode } from 'react';
import { create } from 'zustand';

/**
 * Diálogos imperativos: `await confirm(...)` e `await prompt(...)` em vez de
 * espalhar estado de diálogo por todos os componentes.
 */

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Terceira opção (ex.: "Descartar" ao fechar aba alterada). */
  alternateLabel?: string;
  danger?: boolean;
}

export type ConfirmResult = 'confirm' | 'alternate' | 'cancel';

export interface PromptOptions {
  title: string;
  label?: string;
  /** Texto explicativo acima do campo. */
  description?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  validate?: (value: string) => string | null;
}

type Dialog =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (result: ConfirmResult) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void };

interface DialogState {
  current: Dialog | null;
  close(): void;
}

export const useDialogs = create<DialogState>()((set) => ({
  current: null,
  close: () => set({ current: null }),
}));

/** Retorna 'confirm', 'alternate' ou 'cancel'. */
export function confirmDialog(options: ConfirmOptions): Promise<ConfirmResult> {
  return new Promise((resolve) => {
    useDialogs.setState({
      current: {
        kind: 'confirm',
        options,
        resolve: (result) => {
          useDialogs.setState({ current: null });
          resolve(result);
        },
      },
    });
  });
}

/** Retorna o texto digitado (sem espaços nas pontas) ou null se cancelado. */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogs.setState({
      current: {
        kind: 'prompt',
        options,
        resolve: (value) => {
          useDialogs.setState({ current: null });
          resolve(value);
        },
      },
    });
  });
}
