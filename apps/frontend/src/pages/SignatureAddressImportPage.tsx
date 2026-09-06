import React from "react";
import { useNavigate } from "react-router-dom";
import { Breadcrumb, Card, PageShell } from "../components/ui";
import { ImportSignatureAddressForm } from "../components/SignatureAddress/ImportSignatureAddressForm";
import { useTranslation } from "../hooks/useTranslation";

export const SignatureAddressImportPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <PageShell
      title={t("signatureAddress.importAddress")}
      breadcrumbs={
        <Breadcrumb
          items={[
            { label: t("signatureAddress.title"), href: "/signer" },
            { label: t("signatureAddress.importAddress") },
          ]}
        />
      }
    >
      <div className="w-full">
        <Card className="p-8 w-full">
          <ImportSignatureAddressForm
            className="max-w-none"
            onCancel={() => navigate("/signer")}
            onCompleted={(signerId) => navigate(`/signer/${signerId}`)}
          />
        </Card>
      </div>
    </PageShell>
  );
};
