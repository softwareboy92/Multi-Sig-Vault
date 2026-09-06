import { create } from "zustand";
import type { ToastType } from "../components/ui/Toast";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  action?: ToastAction;
}

interface ToastState {
  toasts: ToastItem[];
  showToast: (
    message: string,
    type: ToastType,
    options?: number | { duration?: number; action?: ToastAction },
  ) => string;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  showToast: (message, type, options) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const duration = typeof options === "number" ? options : options?.duration;
    const action = typeof options === "object" ? options?.action : undefined;
    set((state) => ({
      toasts: [...state.toasts, { id, message, type, duration, action }],
    }));
    return id;
  },
  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));
