import { useEffect, useState } from "react";
import { Button, Input, Modal } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import {
  TRANSACTION_TAG_COLORS,
  useTransactionTagStore,
} from "../../stores/useTransactionTagStore";

interface TransactionTagModalProps {
  transactionId: string | null;
  onClose: () => void;
}

export const TransactionTagModal: React.FC<TransactionTagModalProps> = ({
  transactionId,
  onClose,
}) => {
  const { t } = useTranslation();
  const { tags, transactionTags, createTag, deleteTag, setTransactionTags } =
    useTransactionTagStore();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(TRANSACTION_TAG_COLORS[0]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedIds(transactionId ? transactionTags[transactionId] || [] : []);
    setNewName("");
    setNewColor(TRANSACTION_TAG_COLORS[0]);
  }, [transactionId, transactionTags]);

  const handleConfirm = () => {
    if (!transactionId) return;

    let nextSelectedIds = selectedIds;
    const name = newName.trim();
    if (name) {
      const existing = tags.find(
        (tag) => tag.name.toLowerCase() === name.toLowerCase(),
      );
      const tagId = existing?.id || createTag(name, newColor);
      if (!nextSelectedIds.includes(tagId)) {
        nextSelectedIds = [...nextSelectedIds, tagId];
      }
    }

    setTransactionTags(transactionId, nextSelectedIds);
    onClose();
  };

  return (
    <Modal
      isOpen={Boolean(transactionId)}
      onClose={onClose}
      title={t("history.manageTags")}
      showCloseButton
      maxWidth="32rem"
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold text-[var(--text)]">
            {t("history.assignedTags")}
          </div>
          {tags.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] px-3 py-4 text-center text-sm text-[var(--muted)]">
              {t("history.noTags")}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {tags.map((tag) => {
                const checked = selectedIds.includes(tag.id);
                return (
                  <div
                    key={tag.id}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedIds((current) =>
                            current.includes(tag.id)
                              ? current.filter((id) => id !== tag.id)
                              : [...current, tag.id],
                          );
                        }}
                      />
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="truncate text-sm font-medium">
                        {tag.name}
                      </span>
                    </label>
                    <button
                      type="button"
                      className="rounded-lg px-2 py-1 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10"
                      onClick={() => deleteTag(tag.id)}
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border)] pt-4">
          <div className="mb-2 text-sm font-semibold text-[var(--text)]">
            {t("history.createTag")}
          </div>
          <div className="flex flex-col gap-3">
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={t("history.tagNamePlaceholder")}
              maxLength={24}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleConfirm();
              }}
            />
            <div className="flex items-center gap-3">
              <div className="flex gap-2" aria-label={t("history.tagColor")}>
                {TRANSACTION_TAG_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`h-7 w-7 rounded-full border-2 transition-transform ${
                      color === newColor
                        ? "scale-110 border-[var(--text)]"
                        : "border-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewColor(color)}
                    aria-label={color}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-[var(--border)] pt-4">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={handleConfirm}>
            {t("common.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
