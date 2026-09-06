import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "../ui";
import { BtcAddressFormatSelector } from "../wallet/BtcAddressFormatSelector";
import { EvmAddressSupportPanel } from "../wallet/EvmAddressSupportPanel";
import { useTranslation } from "../../hooks/useTranslation";
import { useWalletConnection } from "../../hooks/useWalletConnection";
import { createChallenge, createSigner, getKeyvaultProtocol } from "../../api";
import { usePreferenceStore } from "../../stores/usePreferenceStore";
import { usePendingStore } from "../../stores/usePendingStore";
import { useToastStore } from "../../stores/useToastStore";
import type { ChainType, DeviceType } from "../../types";
import { SOURCE_ICON_MAP } from "../../utils/signer";
import { truncateAddress } from "../../utils/address";
import { getChainSymbolForKeyVault } from "../../utils/chainSymbol";
import { toAccountLevelPath } from "../../utils/derivationPath";
import { getErrorMessage } from "../../utils/errorUtils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImportSignatureAddressFormProps {
  onCancel: () => void;
  onCompleted: (signerId: string) => void;
  className?: string;
  initialChainOption?: "BTC_MAINNET" | "BTC_TESTNET" | "EVM";
  initialBtcNetwork?: "mainnet" | "testnet3" | "testnet4";
  initialBtcScriptType?: "p2wsh" | "p2sh-p2wsh";
  completedPrimaryLabel?: string;
  completedSecondaryLabel?: string;
  lockWalletContext?: boolean;
  modalLayout?: boolean;
}

type Step = 1 | 2 | 3 | 4 | 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const generateSignerName = () => {
  const nouns = [
    "alpha", "bravo", "delta", "echo", "foxtrot", "kilo", "oscar", "sierra",
  ];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const suffix = Math.floor(Math.random() * 90 + 10);
  return `signer-${noun}-${suffix}`;
};

/** Side-by-side key/value row */
const InfoRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({
  label,
  value,
  mono = false,
}) => (
  <div className="flex items-center justify-between py-2.5">
    <span className="text-sm font-semibold text-[var(--text)] shrink-0">
      {label}
    </span>
    <span
      className={`text-sm text-[var(--muted)] max-w-[65%] text-right break-all ${
        mono ? "font-mono text-xs" : ""
      }`}
    >
      {value || "-"}
    </span>
  </div>
);

/** Step indicator with check-mark for completed steps */
const StepIndicator: React.FC<{
  steps: { id: number; label: string }[];
  currentStep: number;
}> = ({ steps, currentStep }) => (
  <div className="mb-4 flex flex-wrap items-start justify-between gap-2 lg:flex-nowrap">
    {steps.map((item, index) => {
      const activeIndex = steps.findIndex((step) => step.id === currentStep);
      const isCompleted = activeIndex >= 0 && index < activeIndex;
      const isActive = index === activeIndex;
      return (
        <React.Fragment key={item.id}>
          <div className="flex flex-col items-center flex-1">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-bold transition-colors ${
                isCompleted
                  ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                  : isActive
                  ? "bg-[var(--text)] text-[var(--surface)] border-[var(--text)]"
                  : "bg-[var(--row-head-bg)] text-[var(--muted)] border-[var(--field-border)]"
              }`}
            >
              {isCompleted ? (
                <svg
                  className="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                index + 1
              )}
            </div>
            <span
              className={`mt-2 whitespace-nowrap text-center text-xs font-semibold sm:text-sm ${
                isCompleted
                  ? "text-[var(--accent)]"
                  : isActive
                  ? "text-[var(--text)]"
                  : "text-[var(--muted)]"
              }`}
            >
              {item.label}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div className="mt-[18px] flex items-center justify-center">
              <div
                className={`w-14 sm:w-20 lg:w-24 h-px transition-colors ${
                  isCompleted ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                }`}
              />
            </div>
          )}
        </React.Fragment>
      );
    })}
  </div>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ImportSignatureAddressForm: React.FC<
  ImportSignatureAddressFormProps
> = ({
  onCancel,
  onCompleted,
  className = "",
  initialChainOption = "BTC_MAINNET",
  initialBtcNetwork = "mainnet",
  initialBtcScriptType = "p2wsh",
  completedPrimaryLabel,
  completedSecondaryLabel,
  lockWalletContext = false,
  modalLayout = false,
}) => {
  const { t } = useTranslation();
  const walletConn = useWalletConnection();
  const { requestRefresh } = usePendingStore();
  const { showToast } = useToastStore();
  const { showTestnets } = usePreferenceStore();

  // Use ref so the effect only fires on unmount, not when cleanup
  // identity changes (which happens after every successful connect).
  const cleanupRef = useRef(walletConn.cleanup);
  cleanupRef.current = walletConn.cleanup;

  useEffect(() => {
    return () => {
      cleanupRef.current().catch(() => {});
    };
  }, []);

  // -- wizard state --
  const [step, setStep] = useState<Step>(1);

  // -- form data --
  const [signerName, setSignerName] = useState(generateSignerName());
  const [chainOption, setChainOption] = useState<
    "BTC_MAINNET" | "BTC_TESTNET" | "EVM"
  >(initialChainOption);
  const chainType: ChainType = chainOption === "EVM" ? "EVM" : "BTC";
  const btcNetwork =
    chainOption === "BTC_MAINNET"
      ? "mainnet"
      : initialBtcNetwork === "testnet4"
        ? "testnet4"
        : "testnet3";
  const [deviceType, setDeviceType] = useState<DeviceType>(
    initialChainOption === "EVM" ? "METAMASK" : "LEDGER",
  );
  const steps = useMemo(() => {
    if (deviceType === "KEYVAULT") {
      return [
        { id: 1, label: t("signatureAddress.stepSelectChain") },
        { id: 2, label: t("signatureAddress.stepBasicInfo") },
        { id: 4, label: t("signatureAddress.stepScanVerify") },
        { id: 5, label: t("signatureAddress.stepComplete") },
      ];
    }

    return [
      { id: 1, label: t("signatureAddress.stepSelectChain") },
      { id: 2, label: t("signatureAddress.stepBasicInfo") },
      {
        id: 3,
        label:
          deviceType === "LEDGER"
            ? t("signatureAddress.stepVerifyDevice")
            : t("signatureAddress.stepConnectWallet"),
      },
      { id: 4, label: t("signatureAddress.stepSignVerify") },
      { id: 5, label: t("signatureAddress.stepComplete") },
    ];
  }, [deviceType, t]);
  const [btcAccount, setBtcAccount] = useState("0");
  const [btcScriptType, setBtcScriptType] = useState<"p2wsh" | "p2sh-p2wsh">(initialBtcScriptType);
  const [evmAccount, setEvmAccount] = useState("0");

  // -- connection result --
  const [address, setAddress] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [derivationPath, setDerivationPath] = useState("");
  const [masterFingerprint, setMasterFingerprint] = useState("");
  const [xpub, setXpub] = useState("");

  // -- verification --
  const [challenge, setChallenge] = useState("");
  const [, setSignature] = useState("");

  // -- completion --
  const [createdSignerId, setCreatedSignerId] = useState("");

  // -- UI --
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deviceVerified, setDeviceVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const indicatorStep =
    deviceType === "KEYVAULT" && loading && step === 2 ? 4 : step;

  // -- chain picker --
  const [chainPickerOpen, setChainPickerOpen] = useState(false);
  const chainButtonRef = useRef<HTMLButtonElement>(null);
  const chainMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chainPickerOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (chainButtonRef.current?.contains(target)) return;
      if (chainMenuRef.current?.contains(target)) return;
      setChainPickerOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [chainPickerOpen]);

  // -- derived --
  const chainOptions = useMemo(() => {
    const opts: {
      value: "BTC_MAINNET" | "BTC_TESTNET" | "EVM";
      label: string;
      desc: string;
      icon: string;
      bg: string;
    }[] = [
      {
        value: "BTC_MAINNET",
        label: t("signatureAddress.chainBtcMainnet"),
        desc: "Bitcoin Mainnet",
        icon: "B",
        bg: "bg-[var(--chain-btc)]",
      },
    ];
    if (showTestnets) {
      opts.push({
        value: "BTC_TESTNET",
        label: t("signatureAddress.chainBtcTestnet"),
        desc: "Bitcoin Testnet",
        icon: "B",
        bg: "bg-[var(--chain-btc)]",
      });
    }
    opts.push({
      value: "EVM",
      label: t("signatureAddress.chainEvm"),
      desc: "Ethereum / EVM",
      icon: "E",
      bg: "bg-[var(--chain-evm)]",
    });
    return opts;
  }, [showTestnets, t]);

  const currentChainOpt = chainOptions.find((o) => o.value === chainOption);

  const walletOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: "LEDGER", label: t("signatureAddress.deviceLedger") },
    ];
    // KeyVault only supports P2SH-P2WSH for BTC
    const isBtcChain = chainOption.startsWith("BTC");
    if (!isBtcChain || btcScriptType === "p2sh-p2wsh") {
      opts.push({ value: "KEYVAULT", label: t("signatureAddress.deviceKeyvault") });
    }
    if (chainOption === "EVM") {
      opts.push(
        { value: "METAMASK", label: t("signatureAddress.deviceMetamask") },
        {
          value: "WALLETCONNECT",
          label: t("signatureAddress.deviceWalletConnect"),
        },
      );
    }
    return opts;
  }, [chainOption, btcScriptType, t]);

  const deviceIconMap: Partial<Record<DeviceType, string>> = {
    LEDGER: SOURCE_ICON_MAP.LEDGER?.icon,
    METAMASK: SOURCE_ICON_MAP.METAMASK?.icon,
    WALLETCONNECT: SOURCE_ICON_MAP.WALLETCONNECT?.icon,
    KEYVAULT: SOURCE_ICON_MAP.KEYVAULT?.icon,
  };

  const chainLabel =
    chainOption === "BTC_MAINNET"
      ? t("signatureAddress.chainBtcMainnet")
      : chainOption === "BTC_TESTNET"
      ? t("signatureAddress.chainBtcTestnet")
      : t("signatureAddress.chainEvm");
  const selectedDeviceLabel =
    walletOptions.find((option) => option.value === deviceType)?.label || deviceType;
  const flowDescription =
    deviceType === "LEDGER"
      ? t("signatureAddress.flowLedger")
      : deviceType === "KEYVAULT"
        ? t("signatureAddress.flowKeyvault")
        : t("signatureAddress.flowSoftwareWallet");

  // =========================================================================
  // KeyVault: Step 1 -> connect + sign via SDK (skips steps 2/3, goes to 4)
  // =========================================================================
  const handleKeyvaultConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch protocol payload from backend
      const chainNetType =
        chainOption === "BTC_TESTNET" ? "testnet" : "mainnet";
      const protocolRequest =
        chainType === "EVM"
          ? {
              chain_type: "EVM" as const,
              chain_net_type: chainNetType,
              evm_chain_id: 1,
              chain_type_value: getChainSymbolForKeyVault(1),
            }
          : {
              chain_type: "BTC" as const,
              chain_net_type: chainNetType,
              chain_type_value:
                chainOption === "BTC_TESTNET" ? "BTC_TESTNET" : "BTC",
            };
      const result = await getKeyvaultProtocol(protocolRequest);
      setChallenge(result.challenge);

      // 2. Connect via SDK (creates KeyVaultProvider internally)
      await walletConn.connect({
        chainType,
        deviceType: "KEYVAULT",
      });

      // 3. Sign via SDK — KeyVaultProvider opens QR Modal internally
      const sig = await walletConn.signChallenge(result.payload_json);

      // 4. Read account data populated by the provider after scan
      const acct = walletConn.getAccount();
      const signerAddress = acct?.address || "";
      const signerPubKey = acct?.publicKey || "";
      const signerXpub = acct?.xpub || "";
      const signerPath = acct?.derivationPath || "";
      const signerFpr = acct?.masterFingerprint || "";

      setAddress(signerAddress);
      setPublicKey(signerPubKey);
      setXpub(signerXpub);
      setDerivationPath(signerPath);
      setMasterFingerprint(signerFpr);
      setSignature(sig);

      // 5. Create signer record
      const signer = await createSigner({
        name: signerName.trim(),
        device_type: "KEYVAULT",
        chain_type: chainType,
        address: signerAddress || undefined,
        public_key: signerPubKey || undefined,
        derivation_path: signerPath ? toAccountLevelPath(signerPath) : undefined,
        master_fingerprint: signerFpr || undefined,
        xpub: signerXpub || undefined,
        script_type: chainType === "BTC" ? btcScriptType : undefined,
        btc_network:
          chainType === "BTC" ? btcNetwork : undefined,
        challenge: result.challenge,
        signature: sig,
      });
      setCreatedSignerId(signer.id);
      requestRefresh();
      showToast(t("signatureAddress.importSuccess"), "success");
      setStep(5);
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // Step 1 -> Connect wallet (advances to Step 2)
  // =========================================================================
  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      let finalPath: string | undefined;
      let network: "mainnet" | "testnet3" | "testnet4" | undefined;

      if (deviceType === "LEDGER") {
        if (chainType === "BTC") {
          const account = Number.parseInt(btcAccount || "0", 10);
          if (!Number.isInteger(account) || account < 0) {
            throw new Error(t("signatureAddress.errorInvalidAccount"));
          }
          const coinType = chainOption === "BTC_MAINNET" ? 0 : 1;
          const scriptSuffix = btcScriptType === "p2sh-p2wsh" ? "1'" : "2'";
          finalPath = `m/48'/${coinType}'/${account}'/${scriptSuffix}`;
          network = btcNetwork;
        } else {
          const account = Number.parseInt(evmAccount || "0", 10);
          if (!Number.isInteger(account) || account < 0) {
            throw new Error(t("signatureAddress.errorInvalidPath"));
          }
          finalPath = `m/44'/60'/${account}'`;
        }
      }

      const result = await walletConn.connect({
        chainType,
        deviceType,
        derivationPath: finalPath,
        btcNetwork: network,
        showOnDevice: deviceType === 'LEDGER' ? false : undefined,
      });

      setAddress(result.address || "");
      setPublicKey(result.publicKey || "");
      setDerivationPath(result.derivationPath || finalPath || "");
      setMasterFingerprint(result.masterFingerprint || "");
      setXpub(result.xpub || "");
      setDeviceVerified(false);
      setStep(3);
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // Step 2 -> Step 3: pre-fetch challenge on transition
  // =========================================================================
  const handleVerifyOnDevice = async () => {
    setVerifying(true);
    setError(null);
    try {
      await walletConn.verifyOnDevice();
      setDeviceVerified(true);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t("signatureAddress.errorDeviceRejected");
      const isLocked = errorMsg.toLowerCase().includes("locked") ||
                        errorMsg.toLowerCase().includes("5502");
      setError(getErrorMessage(err, t));
      if (!isLocked) {
        setDeviceVerified(false);
        await walletConn.forceDisconnect();
        setStep(2);
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleGoToStep3 = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await createChallenge({
        chain_type: chainType,
        address: chainType === "EVM" ? address : undefined,
        public_key: chainType === "BTC" ? publicKey : undefined,
      });
      setChallenge(resp.challenge);
      setStep(4);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("signatureAddress.errorChallenge"),
      );
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // Step 3 -> Sign + Create signer -> auto Step 4
  // =========================================================================
  const handleSignAndVerify = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Sign the cached challenge
      const sig = await walletConn.signChallenge(challenge);
      setSignature(sig);

      // 2. Create signer
      const signer = await createSigner({
        name: signerName.trim(),
        device_type: deviceType,
        chain_type: chainType,
        address: address || undefined,
        public_key: publicKey || undefined,
        derivation_path: derivationPath ? toAccountLevelPath(derivationPath) : undefined,
        master_fingerprint: masterFingerprint || undefined,
        xpub: xpub || undefined,
        script_type: chainType === "BTC" ? btcScriptType : undefined,
        btc_network:
          chainType === "BTC" ? btcNetwork : undefined,
        challenge,
        signature: sig,
      });
      setCreatedSignerId(signer.id);
      requestRefresh();
      showToast(t("signatureAddress.importSuccess"), "success");

      // 3. Auto-advance
      setStep(5);
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // Render
  // =========================================================================
  const actionBarClass = modalLayout
    ? "sticky -bottom-[var(--modal-padding)] z-20 -mx-[var(--modal-padding)] border-t border-[var(--border)] bg-[var(--panel)] px-[var(--modal-padding)] py-3"
    : "pt-2";

  return (
    <div
      className={`flex w-full max-w-none flex-col gap-4 text-[var(--text)] ${
        modalLayout ? "min-h-full" : ""
      } ${className}`}
    >
      <StepIndicator steps={steps} currentStep={indicatorStep} />

      {step > 1 && step !== 5 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {deviceIconMap[deviceType] && (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--panel)]">
                <img src={deviceIconMap[deviceType]} alt="" className="h-7 w-7 object-contain" />
              </span>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-extrabold text-[var(--text)]">{selectedDeviceLabel}</span>
                <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--accent)]">{chainLabel}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{flowDescription}</p>
            </div>
          </div>
          <span className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1.5 text-xs font-bold text-[var(--muted)]">
            {steps.find((item) => item.id === indicatorStep)?.label}
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-[color-mix(in_srgb,var(--danger)_32%,var(--border))] bg-[color-mix(in_srgb,var(--danger)_7%,var(--panel))] px-4 py-3 text-sm font-bold text-[var(--danger)]">
          <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" strokeLinecap="round" /></svg>
          <span>{error}</span>
        </div>
      )}

      {/* ================================================================= */}
      {/* Step 1: Chain                                                      */}
      {/* ================================================================= */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-2 text-sm font-semibold text-[var(--text)]">
              {t("signatureAddress.chain")}
            </div>
            <div className="relative">
              <button
                type="button"
                ref={chainButtonRef}
                onClick={() => {
                  if (!lockWalletContext) setChainPickerOpen((prev) => !prev);
                }}
                disabled={lockWalletContext}
                className="flex h-12 w-full items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 shadow-[var(--card-shadow)] disabled:cursor-default"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-lg font-semibold text-white ${
                      currentChainOpt?.bg ?? ""
                    }`}
                  >
                    {currentChainOpt?.icon}
                  </span>
                  <span className="font-semibold text-[var(--text)]">
                    {currentChainOpt?.label}
                  </span>
                </div>
                {!lockWalletContext && (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                  </svg>
                )}
              </button>

              {chainPickerOpen && (
                <div
                  ref={chainMenuRef}
                  className="overlay-surface absolute z-50 mt-2 w-full rounded-2xl border border-[var(--border)] p-3 shadow-[var(--shadow-overlay)]"
                >
                  <div className="space-y-2">
                    {chainOptions.map((opt) => (
                      <button
                        type="button"
                        key={opt.value}
                        onClick={() => {
                          setChainOption(opt.value);
                          setDeviceType(opt.value === "EVM" ? "METAMASK" : "LEDGER");
                          setChainPickerOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition-colors ${
                          chainOption === opt.value
                            ? "border-[var(--accent)] bg-[var(--row-head-bg)]"
                            : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent-3)]"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`flex h-8 w-8 items-center justify-center rounded-lg font-semibold text-white ${opt.bg}`}>
                            {opt.icon}
                          </span>
                          <div>
                            <div className="text-sm font-semibold">{opt.label}</div>
                            <div className="text-xs text-[var(--muted)]">{opt.desc}</div>
                          </div>
                        </div>
                        <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${chainOption === opt.value ? "border-[var(--accent)]" : "border-[var(--border)]"}`}>
                          {chainOption === opt.value && <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {chainType === "BTC" && (
            <BtcAddressFormatSelector
              value={btcScriptType}
              disabled={lockWalletContext}
              compact
              onChange={(next) => {
                setBtcScriptType(next);
                if (next === "p2wsh" && deviceType === "KEYVAULT") {
                  setDeviceType("LEDGER");
                }
              }}
            />
          )}
          {chainType === "EVM" && <EvmAddressSupportPanel />}

          <div className={`${actionBarClass} flex justify-end gap-2`}>
            <Button variant="ghost" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={() => setStep(2)}>
              {t("common.next")}
            </Button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Step 2: Basic Info                                                 */}
      {/* ================================================================= */}
      {step === 2 && (
        <div className="flex flex-col gap-5">
          {/* ---- Signer name with random dice button ---- */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label={t("signatureAddress.addressName")}
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder={t("signatureAddress.addressNamePlaceholder")}
                maxLength={100}
              />
            </div>
            <Button
              variant="ghost"
              className="h-10 px-3"
              onClick={() => setSignerName(generateSignerName())}
              aria-label={t("signatureAddress.regenerateName")}
              title={t("signatureAddress.regenerateName")}
            >
              <svg
                viewBox="0 0 24 24"
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 12a9 9 0 0115-6l3-3v8h-8l3-3a7 7 0 10.5 8.5"
                />
              </svg>
            </Button>
          </div>

          {/* ---- Device / wallet selection (horizontal cards) ---- */}
          <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
            <label className="field-label">
              <span className="text-[var(--danger)]">*</span>{" "}
              {t("signatureAddress.selectWallet")}
            </label>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {walletOptions.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => setDeviceType(opt.value as DeviceType)}
                  aria-pressed={deviceType === opt.value}
                  className={`flex min-h-[76px] min-w-0 items-center gap-3 rounded-xl border px-3 py-3 text-left transition-[border-color,background-color,box-shadow] ${
                    deviceType === opt.value
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_22%,transparent)]"
                      : "border-[var(--field-border)] bg-[var(--panel)] hover:border-[var(--accent)] hover:bg-[var(--row-head-bg)]"
                  }`}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--panel)]">
                    <img
                      src={deviceIconMap[opt.value as DeviceType]}
                      alt=""
                      className="h-8 w-8 object-contain"
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-[var(--text)]">
                    {opt.label}
                  </span>
                  <span className={`h-4 w-4 shrink-0 rounded-full border-2 ${deviceType === opt.value ? "border-[var(--accent)] bg-[var(--accent)] shadow-[inset_0_0_0_3px_var(--panel)]" : "border-[var(--border)]"}`} />
                </button>
              ))}
            </div>
          </div>

          {/* ---- Ledger derivation path ---- */}
          {deviceType === "LEDGER" && (
            <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
              <label className="field-label">
                {t("signatureAddress.derivationPath")}
              </label>
              {chainOption !== "EVM" ? (
                <div className="flex flex-col gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-[var(--muted)]">
                      {t("signatureAddress.accountLabel")}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      value={btcAccount}
                      onChange={(e) => setBtcAccount(e.target.value)}
                      placeholder={t("signatureAddress.accountPlaceholder")}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] text-[var(--field-text)]"
                    />
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {t("signatureAddress.pathPreview", {
                      path: `m/48'/${
                        chainOption === "BTC_MAINNET" ? 0 : 1
                      }'/${btcAccount || "0"}'/${btcScriptType === "p2sh-p2wsh" ? "1'" : "2'"}`,
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-[var(--muted)]">
                      {t("signatureAddress.accountLabel")}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      value={evmAccount}
                      onChange={(e) => setEvmAccount(e.target.value)}
                      placeholder={t("signatureAddress.accountPlaceholder")}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] text-[var(--field-text)]"
                    />
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {t("signatureAddress.pathPreview", {
                      path: `m/44'/60'/${evmAccount || "0"}'`,
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- Actions ---- */}
          <div className={`${actionBarClass} flex justify-end gap-2`}>
            <Button variant="ghost" onClick={() => setStep(1)}>
              {t("common.prev")}
            </Button>
            <Button
              variant="primary"
              onClick={
                deviceType === "KEYVAULT" ? handleKeyvaultConnect : handleConnect
              }
              disabled={loading || !signerName.trim()}
            >
              {loading ? t("common.loading") : t("common.next")}
            </Button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Step 3: Connection Result (full data, no signing)                  */}
      {/* ================================================================= */}
      {step === 3 && (
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--success)_28%,var(--border))] bg-[color-mix(in_srgb,var(--success)_7%,var(--panel))] p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--success)_14%,var(--panel))] text-[var(--success)]">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <div>
              <div className="font-extrabold text-[var(--text)]">{t("signatureAddress.connectionReady")}</div>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                {deviceType === "LEDGER" ? t("signatureAddress.verifyOnDeviceHint") : t("signatureAddress.connectionReadyHint")}
              </p>
            </div>
          </div>
          <div className="p-5 rounded-xl border border-[var(--field-border)] bg-[var(--row-bg)] divide-y divide-[var(--border)]">
            <InfoRow label={t("signatureAddress.chain")} value={chainLabel} />
            <InfoRow
              label={t("signatureAddress.selectWallet")}
              value={deviceType}
            />
            <InfoRow
              label={t("signatureAddress.address")}
              value={address}
              mono
            />
            {derivationPath && (
              <InfoRow
                label={t("signatureAddress.derivationPath")}
                value={derivationPath}
                mono
              />
            )}
            {publicKey && (
              <InfoRow
                label={t("signatureAddress.publicKey")}
                value={publicKey}
                mono
              />
            )}
            {masterFingerprint && (
              <InfoRow
                label={t("signatureAddress.masterFingerprint")}
                value={masterFingerprint}
                mono
              />
            )}
            {xpub && (
              <InfoRow
                label={t("signatureAddress.xpub")}
                value={xpub}
                mono
              />
            )}
          </div>

          {/* Device verification for Ledger */}
          {deviceType === "LEDGER" && (
            <div className="flex flex-col gap-3 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <img src={deviceIconMap.LEDGER} alt="" className="h-9 w-9 object-contain" />
                <div>
                  <div className="text-sm font-extrabold text-[var(--text)]">{t("signatureAddress.stepVerifyDevice")}</div>
                  <p className="mt-1 text-xs text-[var(--muted)]">{t("signatureAddress.verifyOnDeviceHint")}</p>
                </div>
              </div>
              <Button
                variant={deviceVerified ? "ghost" : "primary"}
                onClick={handleVerifyOnDevice}
                disabled={verifying || deviceVerified}
                className={deviceVerified ? "text-[var(--success)]" : ""}
              >
                {verifying
                  ? t("common.loading")
                  : deviceVerified
                  ? `✓ ${t("signatureAddress.deviceVerified")}`
                  : t("signatureAddress.verifyOnDevice")}
              </Button>
            </div>
          )}

          <div className={`${actionBarClass} flex justify-end gap-2`}>
            <Button variant="ghost" onClick={() => { setDeviceVerified(false); setStep(2); }}>
              {t("common.prev")}
            </Button>
            <Button
              variant="primary"
              onClick={handleGoToStep3}
              disabled={loading || (deviceType === "LEDGER" && !deviceVerified)}
            >
              {loading ? t("common.loading") : t("common.next")}
            </Button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Step 4: Sign & Verify (Ledger / MetaMask / WalletConnect)         */}
      {/* ================================================================= */}
      {step === 4 && (
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--panel)] text-[var(--accent)]">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 12.5 10.5 16 18 8.5M5 4h14v16H5z" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <div>
              <div className="font-extrabold text-[var(--text)]">{t("signatureAddress.stepSignVerify")}</div>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("signatureAddress.signVerifyDescription")}</p>
            </div>
          </div>

          <div className="p-5 rounded-xl border border-[var(--field-border)] bg-[var(--row-bg)] divide-y divide-[var(--border)]">
            <InfoRow label={t("signatureAddress.chain")} value={chainLabel} />
            <InfoRow
              label={t("signatureAddress.address")}
              value={address}
              mono
            />
            <InfoRow
              label={t("signatureAddress.challengeText")}
              value={challenge}
              mono
            />
          </div>

          <div className={`${actionBarClass} flex justify-end gap-2`}>
            <Button variant="ghost" onClick={() => setStep(3)}>
              {t("common.prev")}
            </Button>
            <Button
              variant="primary"
              onClick={handleSignAndVerify}
              disabled={loading}
            >
              {loading ? t("common.loading") : t("signatureAddress.signVerify")}
            </Button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Step 5: Complete                                                  */}
      {/* ================================================================= */}
      {step === 5 && (
        <div className="flex flex-col items-center gap-6 py-4">
          {/* Success icon */}
          <div className="w-16 h-16 rounded-full bg-[var(--success)]/15 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-[var(--success)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <h3 className="text-lg font-bold text-[var(--text)]">
            {t("signatureAddress.importSuccess")}
          </h3>

          {/* Summary card */}
          <div className="w-full p-5 rounded-xl border border-[var(--field-border)] bg-[var(--row-bg)] divide-y divide-[var(--border)]">
            <InfoRow
              label={t("signatureAddress.addressName")}
              value={signerName}
            />
            <InfoRow label={t("signatureAddress.chain")} value={chainLabel} />
            <InfoRow
              label={t("signatureAddress.selectWallet")}
              value={deviceType}
            />
            <InfoRow
              label={t("signatureAddress.address")}
              value={truncateAddress(address, 12, 10)}
              mono
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 w-full justify-end pt-2">
            <Button variant="ghost" onClick={async () => {
              await walletConn.cleanup();
              onCancel();
            }}>
              {completedSecondaryLabel || t("signatureAddress.backToList")}
            </Button>
            <Button
              variant="primary"
              onClick={() => onCompleted(createdSignerId)}
            >
              {completedPrimaryLabel || t("signatureAddress.viewDetail")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
