import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { Modal, Button } from '../ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Generic node form state — pages provide their own shape via generics. */
export interface NodeFormModalProps<T extends object> {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (form: T) => Promise<void>;
  title: string;
  /** Whether this is an edit (true) or create (false). */
  isEditing: boolean;
  /** Current form state. */
  form: T;
  /** Called when the form state changes. */
  onFormChange: (form: T) => void;
  /** Render the form fields. The parent provides EVM or BTC specific fields. */
  renderFields: (form: T, onChange: (patch: Partial<T>) => void) => ReactNode;
  /** Optional client-side validation. Returns error message or null. */
  validate?: (form: T) => string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NodeFormModal<T extends object>({
  isOpen,
  onClose,
  onSubmit,
  title,
  isEditing,
  form,
  onFormChange,
  renderFields,
  validate,
}: NodeFormModalProps<T>) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleChange = (patch: Partial<T>) => {
    onFormChange({ ...form, ...patch });
    if (formError) setFormError(null);
  };

  const handleSubmit = async () => {
    if (validate) {
      const err = validate(form);
      if (err) {
        setFormError(err);
        return;
      }
    }
    setSaving(true);
    try {
      await onSubmit(form);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setFormError(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title}>
      <div className="flex flex-col gap-4">
        {renderFields(form, handleChange)}

        {formError && (
          <p className="text-sm text-[var(--danger)]">{formError}</p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="ghost" onClick={handleClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={saving}>
            {saving
              ? t('networks.saving')
              : isEditing
                ? t('common.save')
                : t('common.create')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
