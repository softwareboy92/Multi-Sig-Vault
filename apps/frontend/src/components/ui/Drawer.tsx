import React from "react";
import { useOverlayFocus } from "../../hooks/useOverlayFocus";

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  children,
  title,
}) => {
  const panelRef = useOverlayFocus(isOpen, onClose);

  return (
    <>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={isOpen ? "true" : undefined}
        aria-label={title || "Drawer"}
        aria-hidden={!isOpen}
        inert={!isOpen}
        tabIndex={-1}
        className={`fixed inset-0 z-[60] bg-black/50 transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      <div
        className={`glass-surface fixed right-0 top-0 z-[70] h-full w-[94%] max-w-[42rem] border-l border-[var(--border)] bg-[var(--panel)] shadow-2xl transition-transform duration-300 ease-in-out sm:w-[72%] lg:w-[46%] xl:w-[36%] ${
          isOpen ? "translate-x-0" : "translate-x-full"
        } flex flex-col`}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] p-[var(--modal-padding)]">
          <h3 className="title-h3 text-[var(--text)]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-10 h-10 rounded-xl border border-[var(--border)] flex items-center justify-center text-[var(--text)] hover:bg-[var(--row-head-bg)] transition-all"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-auto p-[var(--modal-padding)]">{children}</div>
      </div>
    </>
  );
};
