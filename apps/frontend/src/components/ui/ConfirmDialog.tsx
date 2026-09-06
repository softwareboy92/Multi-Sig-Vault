import React from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  /** Optional warning block rendered between description and buttons. */
  warning?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" renders a red confirm button; "primary" keeps the default accent. */
  variant?: "danger" | "primary";
  loading?: boolean;
  maxWidth?: string;
  children?: React.ReactNode;
}

/**
 * Unified confirmation dialog for destructive or important actions.
 *
 * Usage:
 * ```tsx
 * <ConfirmDialog
 *   isOpen={showDelete}
 *   onClose={() => setShowDelete(false)}
 *   onConfirm={handleDelete}
 *   title="Delete wallet"
 *   description="This action cannot be undone."
 *   variant="danger"
 *   confirmLabel="Delete"
 * />
 * ```
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  warning,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
  loading = false,
  maxWidth = "28rem",
  children,
}) => {
  const isDanger = variant === "danger";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth={maxWidth}>
      <div className="flex flex-col gap-4">
        {description && (
          <p className="text-sm text-[var(--text)]">{description}</p>
        )}

        {warning && (
          <div className="rounded-lg bg-[var(--danger)]/5 border border-[var(--danger)]/20 p-3 text-sm text-[var(--danger)]">
            {warning}
          </div>
        )}

        {children}

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={loading}
            className={
              isDanger
                ? "bg-[var(--danger)] hover:bg-[var(--danger)]/80 border-[var(--danger)]"
                : ""
            }
          >
            {loading ? `${confirmLabel}…` : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
