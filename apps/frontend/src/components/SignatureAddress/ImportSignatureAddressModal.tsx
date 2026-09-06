import React from "react";
import { Modal } from "../ui";
import { ImportSignatureAddressForm } from "./ImportSignatureAddressForm";
import { useTranslation } from "../../hooks/useTranslation";

interface ImportSignatureAddressModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: (signerId: string) => void;
}

/**
 * Thin Modal wrapper around ImportSignatureAddressForm.
 * All logic lives in the Form component.
 */
export const ImportSignatureAddressModal: React.FC<
  ImportSignatureAddressModalProps
> = ({ isOpen, onClose, onImported }) => {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("signatureAddress.importAddress")}
      maxWidth="76rem"
      height="min(54rem, 92dvh)"
      showCloseButton
    >
      <ImportSignatureAddressForm
        className="max-w-none"
        modalLayout
        onCancel={onClose}
        onCompleted={onImported}
      />
    </Modal>
  );
};
