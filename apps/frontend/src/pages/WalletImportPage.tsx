import React from "react";
import { useNavigate } from "react-router-dom";
import { Breadcrumb, Card, PageShell } from "../components/ui";
import { ImportWalletForm } from "../components/wallet/ImportWalletForm";
import { useTranslation } from "../hooks/useTranslation";

export const WalletImportPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <PageShell
      title={t("wallet.importExisting")}
      breadcrumbs={
        <Breadcrumb
          items={[
            { label: t("wallet.listTitle"), href: "/wallet" },
            { label: t("wallet.importExisting") },
          ]}
        />
      }
    >
      <div className="w-full">
        <Card className="p-8 w-full">
          <ImportWalletForm
            className="max-w-none"
            onCancel={() => navigate("/wallet")}
            onCompleted={(walletId) => navigate(`/wallet/${walletId}`)}
          />
        </Card>
      </div>
    </PageShell>
  );
};
