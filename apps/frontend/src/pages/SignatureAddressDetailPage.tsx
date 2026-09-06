import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Breadcrumb,
  Button,
  Card,
  CardSkeleton,
  ConfirmDialog,
  PageShell,
} from "../components/ui";
import {
  SignerHeaderCard,
  AssociatedWalletsList,
  SignerTechnicalDetails,
} from "../components/SignatureAddress";
import { useSignerDetail } from "../hooks/useSignerDetail";
import { useTranslation } from "../hooks/useTranslation";
import { useToastStore } from "../stores/useToastStore";
import { deleteSigner } from "../api";

export const SignatureAddressDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { showToast } = useToastStore();

  const { state, error, signer, reload, rename, isRenaming } =
    useSignerDetail(id);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleDelete = async () => {
    if (!id) return;
    setDeleteLoading(true);
    try {
      await deleteSigner(id);
      showToast(t("signatureAddress.signerDeleted"), "success");
      navigate("/signer");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : t("common.loadFailed"),
        "error"
      );
    } finally {
      setDeleteLoading(false);
      setDeleteDialogOpen(false);
    }
  };

  const breadcrumbs = (
    <Breadcrumb
      items={[
        { label: t("signatureAddress.title"), href: "/signer" },
        { label: signer?.name ?? t("signatureAddress.detailTitle") },
      ]}
    />
  );

  // --- Loading ---
  if (state === "loading") {
    return (
      <PageShell
        title={t("signatureAddress.detailTitle")}
        breadcrumbs={breadcrumbs}
      >
        <CardSkeleton count={3} />
      </PageShell>
    );
  }

  // --- Error ---
  if (state === "error") {
    return (
      <PageShell
        title={t("signatureAddress.detailTitle")}
        breadcrumbs={breadcrumbs}
      >
        <Card className="text-center py-8">
          <p className="text-[var(--danger)] mb-4">{error}</p>
          <div className="flex gap-2 justify-center">
            <Button variant="ghost" onClick={() => navigate("/signer")}>
              {t("common.back")}
            </Button>
            <Button variant="primary" onClick={reload}>
              {t("common.retry")}
            </Button>
          </div>
        </Card>
      </PageShell>
    );
  }

  // --- Not found ---
  if (state === "not-found" || !signer) {
    return (
      <PageShell
        title={t("signatureAddress.detailTitle")}
        breadcrumbs={breadcrumbs}
      >
        <Card className="text-center py-8">
          <p className="text-[var(--muted)] mb-4">{t("common.noData")}</p>
          <Button variant="ghost" onClick={() => navigate("/signer")}>
            {t("common.back")}
          </Button>
        </Card>
      </PageShell>
    );
  }

  // --- Ready ---
  return (
    <PageShell title={signer.name} breadcrumbs={breadcrumbs}>
      <div className="space-y-4">
        <SignerHeaderCard
          signer={signer}
          onRename={rename}
          isRenaming={isRenaming}
          onVerify={() => navigate(`/signer/${id}/verify`)}
          onDelete={() => setDeleteDialogOpen(true)}
          deleteLoading={deleteLoading}
        />

        <AssociatedWalletsList wallets={signer.wallets} />

        <SignerTechnicalDetails signer={signer} />
      </div>

      <ConfirmDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        title={t("signatureAddress.deleteConfirm")}
        description={t("signatureAddress.deleteMessage", {
          name: signer.name,
        })}
        confirmLabel={t("common.delete")}
        variant="danger"
        loading={deleteLoading}
      />
    </PageShell>
  );
};
