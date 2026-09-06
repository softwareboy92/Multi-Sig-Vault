import React from "react";
import { Modal, Button } from "../ui";
import { useTranslation } from "@/hooks/useTranslation";
import type { DeviceType, WalletDeployment, WalletSigner } from "@/types";
import { truncateAddress } from "@/utils/address";
import { getAddressExplorerUrl } from "@/utils/formatters";
import { SOURCE_ICON_MAP } from "@/utils/signer";

/** Inline address display: truncated text + optional explorer link icon. */
const AddressWithExplorer: React.FC<{
  address: string;
  chainId?: number;
  prefixLen?: number;
  suffixLen?: number;
}> = ({ address, chainId, prefixLen = 8, suffixLen = 6 }) => {
  const explorerUrl = chainId ? getAddressExplorerUrl(address, chainId) : "";
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-[var(--muted)]">
      {truncateAddress(address, prefixLen, suffixLen)}
      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--muted)] hover:text-[var(--text)] transition-colors shrink-0"
          title={address}
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      )}
    </span>
  );
};

interface DeployModalProps {
  isOpen: boolean;
  onClose: () => void;
  step: 1 | 2 | 3;
  selectedDevice: DeviceType | null;
  onSelectDevice: (device: DeviceType) => void;
  onConnect: () => Promise<void>;
  onBack: () => void;
  onDeploy: () => Promise<void>;
  connecting: boolean;
  fetchingDeployment: boolean;
  sending: boolean;
  confirming: boolean;
  connectedAddress?: string | null;
  predictedAddress?: string;
  deploymentInfo?: WalletDeployment | null;
  txHash?: string | null;
  error?: string | null;
  networkName?: string;
  walletSigners?: WalletSigner[];
  walletThreshold?: number;
}

/**
 * Deploy wallet modal component
 * Steps: select provider -> review & deploy -> wait for confirmation
 */
export const DeployModal: React.FC<DeployModalProps> = ({
  isOpen,
  onClose,
  step,
  selectedDevice,
  onSelectDevice,
  onConnect,
  onBack,
  onDeploy,
  connecting,
  fetchingDeployment,
  sending,
  confirming,
  connectedAddress,
  predictedAddress,
  deploymentInfo,
  txHash,
  error,
  networkName,
  walletSigners,
  walletThreshold,
}) => {
  const { t } = useTranslation();
  const isBusy = connecting || fetchingDeployment || sending || confirming;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("wallet.deployTitle")}
      showCloseButton={false}
    >
      <div className="flex flex-col w-full max-w-2xl gap-4">
        {/* Steps Indicator */}
        <div className="flex items-center mb-6">
          {[1, 2, 3].map((stepIndex, index) => {
            const isCompleted = step > stepIndex;
            const isActive = step === stepIndex;
            return (
              <React.Fragment key={stepIndex}>
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      isCompleted
                        ? "bg-[var(--success)] text-white"
                        : isActive
                        ? "bg-[var(--text)] text-[var(--surface)]"
                        : "bg-[var(--border)] text-[var(--muted)]"
                    }`}
                  >
                    {isCompleted ? "✓" : stepIndex}
                  </div>
                  <span
                    className={`text-xs mt-2 text-center ${
                      isCompleted
                        ? "text-[var(--success)]"
                        : step >= stepIndex
                        ? "text-[var(--text)]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    {stepIndex === 1 && t("wallet.stepSelectProvider")}
                    {stepIndex === 2 && t("wallet.stepConfirmDeploy")}
                    {stepIndex === 3 && t("wallet.stepWaitConfirmation")}
                  </span>
                </div>
                {index < 2 && (
                  <div
                    className={`w-6 flex items-center justify-center mb-6 ${
                      step > stepIndex
                        ? "text-[var(--success)]"
                        : "text-[var(--border)]"
                    }`}
                  >
                    <svg
                      className="w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Step 1: Select Provider */}
        {step === 1 && (
          <div className="flex flex-col gap-3">
            <label className="text-sm font-bold text-[var(--text)]">
              {t("wallet.deployWalletProvider")}
            </label>
            <div className="flex flex-row flex-wrap gap-2.5 justify-center">
              {(["METAMASK", "WALLETCONNECT"] as const).map((option) => (
                <div
                  key={option}
                  onClick={() => onSelectDevice(option as DeviceType)}
                  className={`flex items-center gap-2.5 w-[160px] px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                    selectedDevice === option
                      ? "border-[var(--accent)] bg-[var(--row-bg)]"
                      : "border-[var(--field-border)] bg-[var(--panel)] hover:border-[var(--accent-3)]"
                  }`}
                >
                  <img
                    src={SOURCE_ICON_MAP[option]?.icon}
                    alt={SOURCE_ICON_MAP[option]?.label}
                    className="w-8 h-8 object-contain"
                  />
                  <span className="text-xs font-semibold text-[var(--text)]">
                    {option === "METAMASK"
                      ? t("wallet.providerMetamask")
                      : t("wallet.providerWalletConnect")}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={onClose} disabled={isBusy}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={onConnect}
                disabled={!selectedDevice || connecting}
              >
                {connecting ? t("common.loading") : t("common.next")}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Review & Deploy */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm space-y-3">
              {/* Provider */}
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--text)]">
                  {t("wallet.deployWalletProvider")}
                </span>
                <span className="text-[var(--muted)]">
                  {selectedDevice === "METAMASK"
                    ? t("wallet.providerMetamask")
                    : t("wallet.providerWalletConnect")}
                </span>
              </div>
              {/* Connected address */}
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--text)]">
                  {t("wallet.connectedAddress")}
                </span>
                {connectedAddress ? (
                  <AddressWithExplorer address={connectedAddress} chainId={deploymentInfo?.chain_id} />
                ) : (
                  <span className="text-xs text-[var(--muted)]">-</span>
                )}
              </div>
              {/* Network */}
              {networkName && (
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[var(--text)]">
                    {t("wallet.deployNetwork")}
                  </span>
                  <span className="text-[var(--muted)]">
                    {networkName}{deploymentInfo?.chain_id ? ` (Chain ID: ${deploymentInfo.chain_id})` : ""}
                  </span>
                </div>
              )}
              {/* Predicted address */}
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--text)]">
                  {t("wallet.predictedAddress")}
                </span>
                {predictedAddress ? (
                  <AddressWithExplorer address={predictedAddress} chainId={deploymentInfo?.chain_id} />
                ) : (
                  <span className="text-xs text-[var(--muted)]">-</span>
                )}
              </div>
              {/* Threshold */}
              {walletThreshold != null && (
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[var(--text)]">
                    {t("transactions.threshold")}
                  </span>
                  <span className="text-[var(--muted)]">
                    {walletThreshold} / {walletSigners?.length ?? deploymentInfo?.owners?.length ?? "-"}
                  </span>
                </div>
              )}
              {/* Signers */}
              {walletSigners && walletSigners.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-[var(--text)]">
                    {t("wallet.deploySigners")}
                  </span>
                  <div className="flex flex-col gap-1 mt-1">
                    {walletSigners.map((s, i) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="text-[var(--muted)]">
                          {i + 1}. {s.name}
                        </span>
                        <span className="font-mono text-[var(--muted)]">
                          {truncateAddress(s.address || s.public_key || "-", 8, 6)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Contract info card */}
            {deploymentInfo && (
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[var(--text)]">
                    {t("wallet.deployFactoryAddress")}
                  </span>
                  <AddressWithExplorer address={deploymentInfo.factory_address} chainId={deploymentInfo.chain_id} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[var(--text)]">
                    {t("wallet.deploySingletonAddress")}
                  </span>
                  <AddressWithExplorer address={deploymentInfo.singleton_address} chainId={deploymentInfo.chain_id} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[var(--text)]">
                    {t("wallet.deployFallbackHandler")}
                  </span>
                  <AddressWithExplorer address={deploymentInfo.fallback_handler} chainId={deploymentInfo.chain_id} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[var(--text)]">
                    {t("wallet.deploySaltNonce")}
                  </span>
                  <span className="text-[var(--muted)]">
                    {deploymentInfo.salt_nonce}
                  </span>
                </div>
              </div>
            )}
            {fetchingDeployment && (
              <div className="text-xs text-[var(--muted)]">
                {t("wallet.fetchingDeployment")}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={onBack} disabled={isBusy}>
                {t("common.prev")}
              </Button>
              <Button
                variant="primary"
                onClick={onDeploy}
                disabled={fetchingDeployment || !predictedAddress || sending}
              >
                {sending ? t("wallet.deploying") : t("wallet.deploy")}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Waiting for Confirmation */}
        {step === 3 && (
          <div className="flex flex-col gap-3">
            <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm">
              <div className="text-xs text-[var(--muted)]">
                {t("wallet.deployTxHash")}:
              </div>
              <div className="text-xs font-mono break-all mt-1">
                {txHash || "-"}
              </div>
              <div className="text-xs text-[var(--muted)] mt-3">
                {t("wallet.waitingForConfirmation")}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={onClose} disabled={confirming}>
                {t("common.close")}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="text-xs text-[var(--danger)]">
            {t("wallet.deployFailed")}: {error}
          </div>
        )}
      </div>
    </Modal>
  );
};
