import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { useWalletConnection } from "../../hooks/useWalletConnection";
import type { WalletConnectionResult } from "../../hooks/useWalletConnection";
import { createChallenge, verifySigner, getKeyvaultProtocol } from "../../api";
import type { DeviceType, Signer, ChainType } from "../../types";
import { isBtcTestnet as checkBtcTestnet, SOURCE_ICON_MAP } from "../../utils/signer";
import { truncateAddress } from "../../utils/address";
import { getChainSymbolForKeyVault } from "../../utils/chainSymbol";
import { toAccountLevelPath, parseBtcAccount } from "../../utils/derivationPath";
import { getErrorMessage } from "../../utils/errorUtils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VerifySignatureAddressFormProps {
  signer: Signer;
  onCancel: () => void;
  onCompleted: () => void;
  className?: string;
}

type Step = 1 | 2 | 3 | 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseEvmPath(path?: string | null): {
  account: string;
  change: string;
  index: string;
} {
  if (!path) return { account: "0", change: "0", index: "0" };
  const match = path.match(/m\/44'\/60'\/(\d+)'\/(\d+)\/(\d+)/);
  if (!match) return { account: "0", change: "0", index: "0" };
  return {
    account: match[1] || "0",
    change: match[2] || "0",
    index: match[3] || "0",
  };
}

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
  <div className="flex items-start justify-between gap-2 mb-8 flex-wrap lg:flex-nowrap">
    {steps.map((item, index) => {
      const isCompleted = currentStep > item.id;
      const isActive = currentStep === item.id;
      return (
        <React.Fragment key={item.id}>
          <div className="flex flex-col items-center flex-1">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border transition-colors ${
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
                item.id
              )}
            </div>
            <span
              className={`text-sm mt-3 text-center font-semibold whitespace-nowrap ${
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
            <div className="flex items-center justify-center mt-5">
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

export const VerifySignatureAddressForm: React.FC<
  VerifySignatureAddressFormProps
> = ({ signer, onCancel, onCompleted, className = "" }) => {
  const { t } = useTranslation();
  const wallet = useWalletConnection();

  // Use ref so the effect only fires on unmount, not when cleanup
  // identity changes (which happens after every successful connect).
  const cleanupRef = useRef(wallet.cleanup);
  cleanupRef.current = wallet.cleanup;

  useEffect(() => {
    return () => {
      cleanupRef.current().catch(() => {});
    };
  }, []);

  // -- wizard state --
  const [step, setStep] = useState<Step>(1);

  const steps = [
    { id: 1, label: t("signatureAddress.stepBasicInfo") },
    { id: 2, label: t("signatureAddress.stepConnectWallet") },
    { id: 3, label: t("signatureAddress.stepSignVerify") },
    { id: 4, label: t("signatureAddress.stepComplete") },
  ];

  // -- signer-derived info --
  const chainType = signer.chain_type as ChainType;
  const originalDeviceType = signer.device_type as DeviceType;
  const isUnknown = originalDeviceType === "UNKNOWN";

  // -- device selection (for UNKNOWN signers) --
  const [selectedDeviceType, setSelectedDeviceType] = useState<
    DeviceType | undefined
  >(isUnknown ? undefined : originalDeviceType);

  const effectiveDeviceType = isUnknown ? selectedDeviceType : originalDeviceType;
  const isLedger = effectiveDeviceType === "LEDGER";
  const isBtc = chainType === "BTC";

  const isBtcTestnet = useMemo(() => {
    const result = checkBtcTestnet(signer);
    return result === true;
  }, [signer]);

  // KeyVault only supports P2SH-P2WSH for BTC (path ending /1')
  const isBtcP2shP2wsh = isBtc && signer.derivation_path?.endsWith("/1'");

  const walletOptions = useMemo(() => {
    if (isBtc) {
      const opts: { value: DeviceType; label: string }[] = [
        { value: "LEDGER" as DeviceType, label: t("signatureAddress.deviceLedger") },
      ];
      if (isBtcP2shP2wsh) {
        opts.push({ value: "KEYVAULT" as DeviceType, label: t("signatureAddress.deviceKeyvault") });
      }
      return opts;
    }
    return [
      { value: "LEDGER" as DeviceType, label: t("signatureAddress.deviceLedger") },
      { value: "KEYVAULT" as DeviceType, label: t("signatureAddress.deviceKeyvault") },
      { value: "METAMASK" as DeviceType, label: t("signatureAddress.deviceMetamask") },
      {
        value: "WALLETCONNECT" as DeviceType,
        label: t("signatureAddress.deviceWalletConnect"),
      },
    ];
  }, [isBtc, isBtcP2shP2wsh, t]);

  const deviceIconMap: Partial<Record<DeviceType, string>> = {
    LEDGER: SOURCE_ICON_MAP.LEDGER?.icon,
    METAMASK: SOURCE_ICON_MAP.METAMASK?.icon,
    WALLETCONNECT: SOURCE_ICON_MAP.WALLETCONNECT?.icon,
    KEYVAULT: SOURCE_ICON_MAP.KEYVAULT?.icon,
  };

  // -- Ledger path state --
  const [btcAccount, setBtcAccount] = useState(
    parseBtcAccount(signer.derivation_path)
  );
  const [evmAccount, setEvmAccount] = useState(
    parseEvmPath(signer.derivation_path).account
  );

  // -- connection result --
  const [connectionResult, setConnectionResult] =
    useState<WalletConnectionResult | null>(null);

  // -- verification --
  const [challenge, setChallenge] = useState("");
  const [, setSignature] = useState("");

  // -- UI --
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deviceVerified, setDeviceVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [addressMismatch, setAddressMismatch] = useState(false);

  // -- chain label --
  const chainLabel = useMemo(() => {
    if (isBtc) {
      return isBtcTestnet
        ? t("signatureAddress.chainBtcTestnet")
        : t("signatureAddress.chainBtcMainnet");
    }
    return t("signatureAddress.chainEvm");
  }, [isBtc, isBtcTestnet, t]);

  // =========================================================================
  // KeyVault: Step 1 -> connect + compare + sign + verify (skips steps 2/3)
  // =========================================================================
  const handleKeyvaultVerify = async () => {
    if (!chainType) return;
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch KeyVault protocol payload (includes challenge)
      const chainNetType = isBtcTestnet ? "testnet" : "mainnet";
      const protocolRequest = isBtc
        ? {
            chain_type: "BTC" as const,
            chain_net_type: chainNetType,
            chain_type_value: isBtcTestnet ? "BTC_TESTNET" : "BTC",
          }
        : {
            chain_type: "EVM" as const,
            chain_net_type: "mainnet",
            // TODO: resolve real chain_id from signer.network instead of hardcoding Ethereum mainnet
            evm_chain_id: 1,
            chain_type_value: getChainSymbolForKeyVault(1),
          };
      const protocolResult = await getKeyvaultProtocol(protocolRequest);
      setChallenge(protocolResult.challenge);

      // 2. Connect via KeyVault SDK
      await wallet.connect({ chainType, deviceType: "KEYVAULT" });

      // 3. Compare identity with stored signer record
      const acct = wallet.getAccount();
      let mismatch = false;
      if (isBtc) {
        const connectedPubKey = acct?.publicKey?.toLowerCase();
        const storedPubKey = signer.public_key?.toLowerCase();
        if (storedPubKey && connectedPubKey && connectedPubKey !== storedPubKey) {
          mismatch = true;
        }
      } else {
        const connectedAddr = acct?.address?.toLowerCase();
        const storedAddr = signer.address?.toLowerCase();
        if (storedAddr && connectedAddr && connectedAddr !== storedAddr) {
          mismatch = true;
        }
      }
      // 4. Populate connectionResult (used for both mismatch & happy path)
      setConnectionResult({
        address: acct?.address || "",
        publicKey: acct?.publicKey || "",
        derivationPath: acct?.derivationPath || "",
        masterFingerprint: acct?.masterFingerprint || "",
        xpub: acct?.xpub || "",
      });
      if (mismatch) {
        setAddressMismatch(true);
        setStep(2);
        return;
      }

      // 5. Sign challenge via QR modal
      const sig = await wallet.signChallenge(protocolResult.payload_json);

      // 6. Verify on backend
      const verifyPayload: Parameters<typeof verifySigner>[1] = {
        challenge: protocolResult.challenge,
        signature: sig,
      };
      if (isUnknown) {
        verifyPayload.device_type = "KEYVAULT";
        if (acct?.derivationPath) verifyPayload.derivation_path = toAccountLevelPath(acct.derivationPath);
        if (acct?.masterFingerprint) verifyPayload.master_fingerprint = acct.masterFingerprint;
        if (acct?.xpub) verifyPayload.xpub = acct.xpub;
      }

      await verifySigner(signer.id, verifyPayload);
      setStep(4);
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // Step 1 -> Connect wallet (advances to Step 2)
  // =========================================================================
  const buildLedgerPath = (): {
    path?: string;
    network?: "mainnet" | "testnet";
  } => {
    if (!isLedger || !chainType) return {};
    if (isBtc) {
      const account = Number.parseInt(btcAccount || "0", 10);
      if (!Number.isInteger(account) || account < 0) {
        throw new Error(t("signatureAddress.errorInvalidAccount"));
      }
      const coinType = isBtcTestnet ? 1 : 0;
      const scriptSuffix = isBtcP2shP2wsh ? "1'" : "2'";
      return {
        path: `m/48'/${coinType}'/${account}'/${scriptSuffix}`,
        network: isBtcTestnet ? "testnet" : "mainnet",
      };
    }

    const account = Number.parseInt(evmAccount || "0", 10);
    if (!Number.isInteger(account) || account < 0) {
      throw new Error(t("signatureAddress.errorInvalidPath"));
    }
    return { path: `m/44'/60'/${account}'` };
  };

  const handleConnect = async () => {
    if (!chainType || !effectiveDeviceType) return;
    setLoading(true);
    setError(null);
    try {
      const { path, network } = buildLedgerPath();
      const result = await wallet.connect({
        chainType,
        deviceType: effectiveDeviceType,
        derivationPath: path,
        btcNetwork: network,
        showOnDevice: effectiveDeviceType === 'LEDGER' ? false : undefined,
      });
      setConnectionResult(result);

      // Auto-compare connected result with stored signer record
      let mismatch = false;
      if (chainType === "EVM") {
        const connected = result.address?.toLowerCase();
        const stored = signer.address?.toLowerCase();
        if (stored && connected && connected !== stored) {
          mismatch = true;
        }
      } else if (chainType === "BTC") {
        const connected = result.publicKey?.toLowerCase();
        const stored = signer.public_key?.toLowerCase();
        if (stored && connected && connected !== stored) {
          mismatch = true;
        }
      }
      setAddressMismatch(mismatch);
      setDeviceVerified(false);

      setStep(2);
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // Step 2 -> Step 3: pre-fetch challenge
  // =========================================================================
  const handleVerifyOnDevice = async () => {
    setVerifying(true);
    setError(null);
    try {
      await wallet.verifyOnDevice();
      setDeviceVerified(true);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t("signatureAddress.errorDeviceRejected");
      const isLocked = errorMsg.toLowerCase().includes("locked") ||
                        errorMsg.toLowerCase().includes("5502");
      setError(getErrorMessage(err, t));
      if (!isLocked) {
        setDeviceVerified(false);
        setAddressMismatch(false);
        await wallet.forceDisconnect();
        setStep(1);
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleGoToStep3 = async () => {
    setLoading(true);
    setError(null);
    try {
      const identifier =
        chainType === "EVM" ? signer.address : signer.public_key;
      if (!identifier) {
        throw new Error(t("signatureAddress.errorMissingIdentifier"));
      }
      const response = await createChallenge({
        chain_type: chainType,
        address: chainType === "EVM" ? identifier : undefined,
        public_key: chainType === "BTC" ? identifier : undefined,
      });
      setChallenge(response.challenge);
      setStep(3);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("signatureAddress.errorChallenge")
      );
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // Step 3 -> Sign + Verify -> auto Step 4
  // =========================================================================
  const handleSignAndVerify = async () => {
    setLoading(true);
    setError(null);
    try {
      const sig = await wallet.signChallenge(challenge);
      setSignature(sig);

      // Build verify payload — include device metadata when signer was UNKNOWN
      const verifyPayload: Parameters<typeof verifySigner>[1] = {
        challenge,
        signature: sig,
      };
      if (isUnknown && effectiveDeviceType) {
        verifyPayload.device_type = effectiveDeviceType;
        if (connectionResult?.derivationPath) {
          verifyPayload.derivation_path = toAccountLevelPath(connectionResult.derivationPath);
        }
        if (connectionResult?.masterFingerprint) {
          verifyPayload.master_fingerprint = connectionResult.masterFingerprint;
        }
        if (connectionResult?.xpub) {
          verifyPayload.xpub = connectionResult.xpub;
        }
      }

      await verifySigner(signer.id, verifyPayload);

      setStep(4);
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // Render
  // =========================================================================
  return (
    <div
      className={`flex flex-col w-full max-w-2xl gap-4 text-[var(--text)] ${className}`}
    >
      <StepIndicator steps={steps} currentStep={step} />

      {error && (
        <div className="text-sm text-[var(--danger)] font-bold">{error}</div>
      )}

      {/* ================================================================= */}
      {/* Step 1: Basic Info — signer details + device select + path config */}
      {/* ================================================================= */}
      {step === 1 && (
        <div className="flex flex-col gap-5">
          {/* ---- Signer info card (read-only) ---- */}
          <div className="p-5 rounded-xl border border-[var(--field-border)] bg-[var(--row-bg)] divide-y divide-[var(--border)]">
            <InfoRow
              label={t("signatureAddress.addressName")}
              value={signer.name}
            />
            <InfoRow
              label={t("signatureAddress.chain")}
              value={chainLabel}
            />
            <InfoRow
              label={t("signatureAddress.address")}
              value={signer.address || "-"}
              mono
            />
            {signer.public_key && (
              <InfoRow
                label={t("signatureAddress.publicKey")}
                value={truncateAddress(signer.public_key, 12, 10)}
                mono
              />
            )}
          </div>

          {/* ---- Device / wallet selection (only for UNKNOWN signers) ---- */}
          {isUnknown && (
            <div className="flex flex-col gap-2">
              <label className="field-label">
                <span className="text-[var(--danger)]">*</span>{" "}
                {t("signatureAddress.selectWallet")}
              </label>
              <div className="flex flex-row flex-wrap gap-2.5 justify-center">
                {walletOptions.map((opt) => (
                  <div
                    key={opt.value}
                    onClick={() => setSelectedDeviceType(opt.value)}
                    className={`flex items-center gap-2.5 w-[160px] px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                      selectedDeviceType === opt.value
                        ? "border-[var(--accent)] bg-[var(--row-bg)]"
                        : "border-[var(--field-border)] bg-[var(--panel)] hover:border-[var(--accent-3)]"
                    }`}
                  >
                    <img
                      src={deviceIconMap[opt.value]}
                      alt={opt.label}
                      className="w-8 h-8 object-contain"
                    />
                    <span className="text-xs font-semibold text-[var(--text)] text-center">
                      {opt.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ---- Ledger derivation path config ---- */}
          {effectiveDeviceType === "LEDGER" && (
            <div className="flex flex-col gap-3">
              <label className="field-label">
                {t("signatureAddress.derivationPath")}
              </label>
              {isBtc ? (
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
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] text-[var(--field-text)]"
                    />
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {t("signatureAddress.pathPreview", {
                      path: `m/48'/${isBtcTestnet ? 1 : 0}'/${
                        btcAccount || "0"
                      }'/${isBtcP2shP2wsh ? "1'" : "2'"}`,
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
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={async () => {
              await wallet.cleanup();
              onCancel();
            }}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={effectiveDeviceType === "KEYVAULT" ? handleKeyvaultVerify : handleConnect}
              disabled={loading || (isUnknown && !selectedDeviceType)}
            >
              {loading ? t("common.loading") : t("common.next")}
            </Button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Step 2: Connection Result                                         */}
      {/* ================================================================= */}
      {step === 2 && (
        <div className="flex flex-col gap-5">
          <div className="p-5 rounded-xl border border-[var(--field-border)] bg-[var(--row-bg)] divide-y divide-[var(--border)]">
            <InfoRow label={t("signatureAddress.chain")} value={chainLabel} />
            <InfoRow
              label={t("signatureAddress.selectWallet")}
              value={effectiveDeviceType || "-"}
            />
            <InfoRow
              label={t("signatureAddress.address")}
              value={connectionResult?.address || signer.address || "-"}
              mono
            />
            {connectionResult?.derivationPath && (
              <InfoRow
                label={t("signatureAddress.derivationPath")}
                value={connectionResult.derivationPath}
                mono
              />
            )}
            {connectionResult?.publicKey && (
              <InfoRow
                label={t("signatureAddress.publicKey")}
                value={connectionResult.publicKey}
                mono
              />
            )}
            {connectionResult?.masterFingerprint && (
              <InfoRow
                label={t("signatureAddress.masterFingerprint")}
                value={connectionResult.masterFingerprint}
                mono
              />
            )}
            {connectionResult?.xpub && (
              <InfoRow
                label={t("signatureAddress.xpub")}
                value={connectionResult.xpub}
                mono
              />
            )}
          </div>

          {/* Address mismatch warning */}
          {addressMismatch && (
            <div className="text-sm text-[var(--danger)] font-bold p-3 rounded-lg border border-[var(--danger)] bg-[var(--danger)]/5">
              {chainType === "EVM"
                ? t("signatureAddress.errorAddressMismatch")
                : t("signatureAddress.errorPubkeyMismatch")}
            </div>
          )}

          {/* Device verification for Ledger */}
          {effectiveDeviceType === "LEDGER" && !addressMismatch && (
            <div className="flex flex-col items-center gap-2 pt-2">
              <p className="text-xs text-[var(--danger)] font-semibold text-center">
                {t("signatureAddress.verifyOnDeviceHint")}
              </p>
              <Button
                variant={deviceVerified ? "ghost" : "primary"}
                onClick={handleVerifyOnDevice}
                disabled={verifying || deviceVerified}
                className={deviceVerified ? "text-[var(--success)]" : ""}
              >
                {verifying
                  ? t("common.loading")
                  : deviceVerified
                  ? `\u2713 ${t("signatureAddress.deviceVerified")}`
                  : t("signatureAddress.verifyOnDevice")}
              </Button>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => { setDeviceVerified(false); setAddressMismatch(false); setStep(1); }}>
              {t("common.prev")}
            </Button>
            <Button
              variant="primary"
              onClick={handleGoToStep3}
              disabled={
                loading ||
                addressMismatch ||
                (effectiveDeviceType === "LEDGER" && !deviceVerified)
              }
            >
              {loading ? t("common.loading") : t("common.next")}
            </Button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Step 3: Sign & Verify                                             */}
      {/* ================================================================= */}
      {step === 3 && (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            {t("signatureAddress.signVerifyDescription")}
          </p>

          <div className="p-5 rounded-xl border border-[var(--field-border)] bg-[var(--row-bg)] divide-y divide-[var(--border)]">
            <InfoRow label={t("signatureAddress.chain")} value={chainLabel} />
            <InfoRow
              label={t("signatureAddress.address")}
              value={signer.address || signer.public_key || "-"}
              mono
            />
            <InfoRow
              label={t("signatureAddress.challengeText")}
              value={challenge}
              mono
            />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => setStep(2)}>
              {t("common.prev")}
            </Button>
            <Button
              variant="primary"
              onClick={handleSignAndVerify}
              disabled={loading}
            >
              {loading
                ? t("common.loading")
                : t("signatureAddress.signVerify")}
            </Button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Step 4: Complete                                                  */}
      {/* ================================================================= */}
      {step === 4 && (
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
            {t("signatureAddress.verifySuccess")}
          </h3>

          {/* Summary card */}
          <div className="w-full p-5 rounded-xl border border-[var(--field-border)] bg-[var(--row-bg)] divide-y divide-[var(--border)]">
            <InfoRow
              label={t("signatureAddress.addressName")}
              value={signer.name}
            />
            <InfoRow label={t("signatureAddress.chain")} value={chainLabel} />
            <InfoRow
              label={t("signatureAddress.selectWallet")}
              value={effectiveDeviceType || originalDeviceType}
            />
            <InfoRow
              label={t("signatureAddress.address")}
              value={truncateAddress(
                signer.address || signer.public_key || "",
                12,
                10
              )}
              mono
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 w-full justify-end pt-2">
            <Button variant="ghost" onClick={async () => {
              await wallet.cleanup();
              onCancel();
            }}>
              {t("signatureAddress.backToList")}
            </Button>
            <Button variant="primary" onClick={onCompleted}>
              {t("signatureAddress.viewDetail")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
