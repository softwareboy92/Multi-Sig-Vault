import React from "react";
import { useTransition } from "../../hooks/useTransition";
import { useOverlayFocus } from "../../hooks/useOverlayFocus";

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
  const panelRef = useOverlayFocus(isOpen, onClose);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-[var(--page-gutter)] backdrop-blur-sm transition-opacity duration-normal ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || "Dialog"}
        tabIndex={-1}
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
                type="button"
                onClick={onClose}
                aria-label="Close"
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
