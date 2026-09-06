import React, { useCallback, useEffect, useState } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastProps {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  action?: { label: string; onClick: () => void };
  onClose: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({
  id,
  message,
  type,
  duration = 3000,
  action,
  onClose,
}) => {
  const [exiting, setExiting] = useState(false);

  const triggerClose = useCallback(() => {
    setExiting(true);
    setTimeout(() => onClose(id), 150);
  }, [id, onClose]);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        triggerClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, triggerClose]);

  const bgColor = {
    success: "bg-[var(--success)]",
    error: "bg-[var(--danger)]",
    warning: "bg-[var(--warning)]",
    info: "bg-[var(--info)]",
  }[type];

  const icon = {
    success: "✓",
    error: "✕",
    warning: "⚠",
    info: "ℹ",
  }[type];

  return (
    <div
      className={`${bgColor} text-white px-4 py-3 rounded-[var(--radius-modal)] shadow-[var(--shadow-overlay)] flex items-center gap-3 min-w-[280px] max-w-[400px] relative overflow-hidden ${
        exiting ? "animate-slide-out-right" : "animate-slide-in-right"
      }`}
    >
      <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold flex-shrink-0">
        {icon}
      </div>
      <p className="text-sm font-medium flex-1">{message}</p>
      {action && (
        <button
          onClick={() => { action.onClick(); triggerClose(); }}
          className="ml-2 text-sm font-medium underline hover:no-underline flex-shrink-0"
        >
          {action.label}
        </button>
      )}
      <button
        onClick={() => triggerClose()}
        className="w-5 h-5 flex items-center justify-center text-white/80 hover:text-white transition-colors flex-shrink-0"
      >
        ×
      </button>
      {duration > 0 && (
        <div
          className="absolute bottom-0 left-0 h-0.5 bg-white/30 rounded-b"
          style={{ animation: `toast-shrink ${duration}ms linear forwards` }}
        />
      )}
    </div>
  );
};

export const ToastContainer: React.FC<{
  toasts: Array<{
    id: string;
    message: string;
    type: ToastType;
    duration?: number;
    action?: { label: string; onClick: () => void };
  }>;
  onClose: (id: string) => void;
}> = ({ toasts, onClose }) => {
  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          id={toast.id}
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          action={toast.action}
          onClose={onClose}
        />
      ))}
    </div>
  );
};
