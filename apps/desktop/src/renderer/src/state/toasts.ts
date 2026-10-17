import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  push(kind: ToastKind, message: string, options?: { action?: ToastAction; duration?: number }): number;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push(kind, message, options = {}) {
    const id = nextId++;
    const toast: Toast = { id, kind, message, ...(options.action ? { action: options.action } : {}) };
    set((s) => ({ toasts: [...s.toasts.slice(-3), toast] }));
    setTimeout(() => get().dismiss(id), options.duration ?? (kind === 'error' ? 7000 : 3500));
    return id;
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export const toast = {
  success: (message: string) => useToasts.getState().push('success', message),
  error: (message: string) => useToasts.getState().push('error', message),
  info: (message: string) => useToasts.getState().push('info', message),
};
