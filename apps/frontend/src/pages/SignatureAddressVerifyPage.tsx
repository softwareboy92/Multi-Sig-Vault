import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Breadcrumb, Button, Card, PageShell } from "../components/ui";
import { VerifySignatureAddressForm } from "../components/SignatureAddress/VerifySignatureAddressForm";
import { useTranslation } from "../hooks/useTranslation";
import { useToastStore } from "../stores/useToastStore";
import { getSigner } from "../api";
import type { Signer } from "../types";

export const SignatureAddressVerifyPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { showToast } = useToastStore();

  const [signer, setSigner] = useState<Signer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getSigner(id);
        setSigner(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("common.loadFailed"));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  if (loading) {
    return (
      <PageShell title={t("signatureAddress.verifyTitle")}>
        <Card className="text-center py-10 text-[var(--muted)]">
          {t("common.loading")}
        </Card>
      </PageShell>
    );
  }

  if (error || !signer) {
    return (
      <PageShell title={t("signatureAddress.verifyTitle")}>
        <Card className="text-center py-10">
          <div className="text-[var(--danger)] text-sm mb-4">
            {error || "No data"}
          </div>
          <Button variant="ghost" onClick={() => navigate("/signer")}>
            {t("common.back")}
          </Button>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={t("signatureAddress.verifyTitle")}
      breadcrumbs={
        <Breadcrumb
          items={[
            { label: t("signatureAddress.title"), href: "/signer" },
            { label: t("signatureAddress.verifyTitle") },
          ]}
        />
      }
    >
      <div className="w-full">
        <Card className="p-8 w-full">
          <VerifySignatureAddressForm
            className="max-w-none"
            signer={signer}
            onCancel={() => navigate("/signer")}
            onCompleted={() => {
              showToast(t("signatureAddress.verifySuccess"), "success");
              navigate(`/signer/${signer.id}`);
            }}
          />
        </Card>
      </div>
    </PageShell>
  );
};
