import React from "react";
import { AlertBanner } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import type { Wallet } from "../../types";

interface WalletAlertBannerProps {
  wallet: Wallet;
  isEvmPendingDeploy: boolean;
  belowThreshold: boolean;
  onDeploy: () => void;
  onVerify: () => void;
}

export const WalletAlertBanner: React.FC<WalletAlertBannerProps> = ({
  wallet,
  isEvmPendingDeploy,
  belowThreshold,
  onDeploy,
  onVerify,
}) => {
  const { t } = useTranslation();
  const alerts: React.ReactNode[] = [];

  if (isEvmPendingDeploy) {
    alerts.push(
      <AlertBanner
        key="deploy"
        severity="warning"
        icon={<span>🔧</span>}
        action={{ label: t("wallet.alertDeployAction"), onClick: onDeploy }}
      >
        {t("wallet.alertDeployRequired")}
      </AlertBanner>
    );
  }

  if (belowThreshold && !isEvmPendingDeploy) {
    const isBtc = wallet.chain_type === "BTC";
    const required = isBtc ? wallet.signer_count : wallet.threshold;
    alerts.push(
      <AlertBanner
        key="verify"
        severity="warning"
        icon={<span>⚠️</span>}
        action={{ label: t("wallet.alertVerifyAction"), onClick: onVerify }}
      >
        {t("wallet.alertVerification", {
          verified: String(wallet.verified_signer_count ?? 0),
          required: String(required),
        })}
      </AlertBanner>
    );
  }

  if (alerts.length === 0) return null;

  return <div className="flex flex-col gap-2">{alerts}</div>;
};
