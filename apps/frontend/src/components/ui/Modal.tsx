import React, { useEffect } from "react";
import { useTransition } from "../../hooks/useTransition";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  maxWidth?: string;
  height?: string;
  showCloseButton?: boolean;
  panelClassName?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  children,
  title,
  maxWidth = "36rem",
  height,
  showCloseButton = false,
  panelClassName = "",
}) => {
  const { mounted, visible } = useTransition(isOpen, 150);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "unset";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  // Escape key to close — only topmost modal should respond
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    // Capture phase not needed: later-registered listeners (topmost modal)
    // run first when using stopImmediatePropagation.
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-[var(--page-gutter)] backdrop-blur-sm transition-opacity duration-normal ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      onClick={onClose}
    >
      <div
        className={`glass-surface flex max-h-[88dvh] w-full flex-col rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow-overlay)] ${panelClassName} ${
          visible ? "animate-scale-in" : "animate-scale-out"
        }`}
        style={{ maxWidth, height }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] p-[var(--modal-padding)]">
            <h3 className="title-h3 text-[var(--text)]">{title}</h3>
            {showCloseButton && (
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-[var(--text)] hover:bg-[var(--row-head-bg)] transition-colors"
              >
                ×
              </button>
            )}
          </div>
        )}
        <div
          className={`overflow-y-auto p-[var(--modal-padding)] ${
            height ? "min-h-0 flex-1" : ""
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
