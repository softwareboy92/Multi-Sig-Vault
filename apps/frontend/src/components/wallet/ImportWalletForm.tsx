import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Input,
  Spinner,
} from "../ui";
import { useTranslation } from "@/hooks/useTranslation";
import { usePreferenceStore } from "@/stores/usePreferenceStore";
import { usePendingStore } from "@/stores/usePendingStore";
import { useToastStore } from "@/stores/useToastStore";
import { getNetworks, importWallet, getSafeInfo, getSigners, getBtcPreview } from "@/api";
import { isValidEvmAddress, isValidBtcAddress } from "@/utils/address";
import type { NetworkConfig, ChainType, Signer } from "@/types";
import type { SafeInfoPreview, BtcPreviewResult } from "@/api/wallets";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ImportChain = "BTC" | "EVM";
type BTCMode = "manual" | "auto";
type Step = 1 | 2 | 3;

interface ImportWalletFormProps {
  onCancel: () => void;
  onCompleted: (walletId: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const generateWalletName = () => {
  const nouns = [
    "ridge", "orbit", "forest", "vault", "harbor", "ember", "delta", "stone",
  ];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const suffix = Math.floor(Math.random() * 90 + 10);
  return `wallet-${noun}-${suffix}`;
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

export const ImportWalletForm: React.FC<ImportWalletFormProps> = ({
  onCancel,
  onCompleted,
  className = "",
}) => {
  const { t } = useTranslation();
  const { showTestnets } = usePreferenceStore();
  const { requestRefresh } = usePendingStore();
  const { showToast } = useToastStore();

  // -- wizard state --
  const [step, setStep] = useState<Step>(1);

  const stepLabels = [
    { id: 1, label: t("walletModal.stepInfo") },
    { id: 2, label: t("wallet.importDetails") || "Details" },
    { id: 3, label: t("walletModal.stepDone") },
  ];

  // -- Networks --
  const [evmNetworks, setEvmNetworks] = useState<NetworkConfig[]>([]);
  const [btcNetworks, setBtcNetworks] = useState<NetworkConfig[]>([]);
  const [networksLoading, setNetworksLoading] = useState(false);

  // -- Step 1 form data --
  const [chain, setChain] = useState<ImportChain>("EVM");
  const [networkId, setNetworkId] = useState("");
  const [name, setName] = useState(generateWalletName());

  // -- Network picker --
  const [networkTab, setNetworkTab] = useState<"mainnet" | "testnet">("mainnet");
  const [networkPickerOpen, setNetworkPickerOpen] = useState(false);
  const networkButtonRef = useRef<HTMLButtonElement>(null);
  const networkMenuRef = useRef<HTMLDivElement>(null);

  // -- EVM fields --
  const [safeAddress, setSafeAddress] = useState("");
  const [safeInfo, setSafeInfo] = useState<SafeInfoPreview | null>(null);
  const [safeInfoLoading, setSafeInfoLoading] = useState(false);
  const [safeInfoError, setSafeInfoError] = useState<string | null>(null);

  // -- Signers (for EVM owner matching) --
  const [evmSigners, setEvmSigners] = useState<Signer[]>([]);
  const [, setSignersLoading] = useState(false);

  // -- BTC fields --
  const [btcMode, setBtcMode] = useState<BTCMode>("manual");
  const [btcAddress, setBtcAddress] = useState("");
  const [btcThreshold, setBtcThreshold] = useState(2);
  const [btcPublicKeys, setBtcPublicKeys] = useState("");
  const [btcTxId, setBtcTxId] = useState("");

  // -- BTC preview (step 2 verification) --
  const [btcPreview, setBtcPreview] = useState<BtcPreviewResult | null>(null);
  const [btcPreviewLoading, setBtcPreviewLoading] = useState(false);
  const [btcPreviewError, setBtcPreviewError] = useState<string | null>(null);

  // -- BTC signers (for public key matching in step 2) --
  const [btcSigners, setBtcSigners] = useState<Signer[]>([]);

  // -- Submit state --
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // =========================================================================
  // Load networks
  // =========================================================================
  useEffect(() => {
    const load = async () => {
      setNetworksLoading(true);
      try {
        const [evm, btc] = await Promise.all([
          getNetworks("EVM"),
          getNetworks("BTC"),
        ]);
        setEvmNetworks(evm);
        setBtcNetworks(btc);
      } catch {
        // silently ignore
      } finally {
        setNetworksLoading(false);
      }
    };
    load();
  }, []);

  // -- Close picker on outside click --
  useEffect(() => {
    if (!networkPickerOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (networkButtonRef.current?.contains(target)) return;
      if (networkMenuRef.current?.contains(target)) return;
      setNetworkPickerOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [networkPickerOpen]);

  // -- Reset chain-specific fields when chain changes --
  useEffect(() => {
    setSafeAddress("");
    setSafeInfo(null);
    setSafeInfoError(null);
    setBtcAddress("");
    setBtcPublicKeys("");
    setBtcTxId("");
    setBtcPreview(null);
    setBtcPreviewError(null);
    setError(null);
  }, [chain]);

  // -- Hide testnet tab if pref disabled --
  useEffect(() => {
    if (!showTestnets && networkTab === "testnet") {
      setNetworkTab("mainnet");
    }
  }, [showTestnets, networkTab]);

  // -- Auto-select first matching network for current picker state --
  useEffect(() => {
    if (networksLoading) return;
    const evmMainnets = evmNetworks.filter((n) => !n.is_testnet);
    const evmTestnets = evmNetworks.filter((n) => n.is_testnet);
    const btcMainnets = btcNetworks.filter((n) => !n.is_testnet);
    const btcTestnets = btcNetworks.filter((n) => n.is_testnet);

    const btcList = networkTab === "mainnet" ? btcMainnets : btcTestnets;
    const evmList = networkTab === "mainnet" ? evmMainnets : evmTestnets;

    const isBtcValid = chain === "BTC" && btcList.some((n) => n.id === networkId);
    const isEvmValid = chain === "EVM" && evmList.some((n) => n.id === networkId);
    if (isBtcValid || isEvmValid) return;

    // Build ordered fallback — prefer current chain
    const list = networkTab === "mainnet"
      ? [
          ...evmMainnets.map((n) => ({ ch: "EVM" as const, id: n.id })),
          ...btcMainnets.map((n) => ({ ch: "BTC" as const, id: n.id })),
        ]
      : [
          ...evmTestnets.map((n) => ({ ch: "EVM" as const, id: n.id })),
          ...(showTestnets ? btcTestnets : []).map((n) => ({ ch: "BTC" as const, id: n.id })),
        ];

    const currentChain = chain;
    list.sort((a, b) => {
      if (a.ch === currentChain && b.ch !== currentChain) return -1;
      if (a.ch !== currentChain && b.ch === currentChain) return 1;
      return 0;
    });

    const pick = list[0];
    if (pick) {
      setChain(pick.ch);
      setNetworkId(pick.id);
    }
  }, [networkTab, evmNetworks, btcNetworks, networksLoading, chain, networkId, showTestnets]);

  // -- Derived --
  const selectedNetwork = useMemo(() => {
    const nets = chain === "EVM" ? evmNetworks : btcNetworks;
    return nets.find((n) => n.id === networkId);
  }, [chain, evmNetworks, btcNetworks, networkId]);

  const selectedNetworkLabel = useMemo(() => {
    if (!selectedNetwork) return chain === "EVM" ? "EVM" : "Bitcoin";
    const testLabel = selectedNetwork.is_testnet ? ` (${t("common.testnet")})` : "";
    return `${selectedNetwork.name}${testLabel}`;
  }, [selectedNetwork, chain, t]);

  // -- Load Safe info + signers for EVM step 2 --
  const handleEvmLoadInfo = async () => {
    if (!safeAddress.trim() || !networkId) return;
    if (!isValidEvmAddress(safeAddress.trim())) {
      setSafeInfoError(t("wallet.importInvalidSafeAddress"));
      return;
    }
    setSafeInfoLoading(true);
    setSignersLoading(true);
    setSafeInfoError(null);
    setSafeInfo(null);
    setError(null);
    try {
      const [info, signersResp] = await Promise.all([
        getSafeInfo(safeAddress.trim(), networkId),
        getSigners(),
      ]);
      setSafeInfo(info);
      setEvmSigners(
        (signersResp.items || []).filter((s) => s.chain_type === "EVM")
      );
      setStep(2);
    } catch (err: any) {
      setSafeInfoError(err?.message || "Failed to load Safe info");
    } finally {
      setSafeInfoLoading(false);
      setSignersLoading(false);
    }
  };

  // -- Load BTC preview + signers for BTC step 2 --
  const handleBtcLoadInfo = async () => {
    if (!btcAddress.trim() || !networkId) return;
    if (!isValidBtcAddress(btcAddress.trim())) {
      setBtcPreviewError(t("wallet.importInvalidBtcAddress"));
      return;
    }
    if (btcMode === "manual") {
      const keys = btcPublicKeys.split("\n").map((k) => k.trim()).filter(Boolean);
      for (let i = 0; i < keys.length; i++) {
        if (!/^[0-9a-fA-F]{66}$/.test(keys[i]) && !/^[0-9a-fA-F]{130}$/.test(keys[i])) {
          setBtcPreviewError(t("wallet.importInvalidPubkey", { line: String(i + 1) }));
          return;
        }
      }
    } else if (btcTxId.trim() && !/^[0-9a-fA-F]{64}$/.test(btcTxId.trim())) {
      setBtcPreviewError(t("wallet.importInvalidTxId"));
      return;
    }
    setBtcPreviewLoading(true);
    setBtcPreviewError(null);
    setBtcPreview(null);
    setError(null);
    try {
      const payload: Parameters<typeof getBtcPreview>[0] = {
        network_id: networkId,
        address: btcAddress.trim(),
      };
      if (btcMode === "manual") {
        payload.public_keys = btcPublicKeys
          .split("\n")
          .map((k) => k.trim())
          .filter(Boolean);
        payload.threshold = btcThreshold;
      } else {
        if (btcTxId.trim()) payload.tx_id = btcTxId.trim();
      }

      const [preview, signersResp] = await Promise.all([
        getBtcPreview(payload),
        getSigners(),
      ]);
      setBtcPreview(preview);
      setBtcSigners(
        (signersResp.items || []).filter((s) => s.chain_type === "BTC")
      );
      setStep(2);
    } catch (err: any) {
      setBtcPreviewError(
        err?.message || "Failed to verify BTC address"
      );
    } finally {
      setBtcPreviewLoading(false);
    }
  };

  /** Match an on-chain owner address to a local signer (case-insensitive) */
  const matchSigner = (ownerAddress: string): Signer | undefined =>
    evmSigners.find(
      (s) => s.address?.toLowerCase() === ownerAddress.toLowerCase()
    );

  /** Match a BTC public key to a local signer */
  const matchBtcSigner = (pubKey: string): Signer | undefined =>
    btcSigners.find(
      (s) => s.public_key?.toLowerCase() === pubKey.toLowerCase()
    );

  // -- Step 1 validation --
  const canProceedStep1 = useMemo(() => {
    if (!networkId || !name.trim()) return false;
    if (chain === "EVM" && !safeAddress.trim()) return false;
    if (chain === "BTC") {
      if (!btcAddress.trim()) return false;
      if (btcMode === "manual") {
        const keys = btcPublicKeys.split("\n").map((k) => k.trim()).filter(Boolean);
        return keys.length >= 2 && btcThreshold >= 1 && btcThreshold <= keys.length;
      }
      // auto mode: address is sufficient
    }
    return true;
  }, [networkId, name, chain, safeAddress, btcAddress, btcMode, btcPublicKeys, btcThreshold]);

  // -- Step 2 validation --
  const canProceedStep2 = useMemo(() => {
    if (!networkId) return false;
    if (chain === "EVM") return !!safeInfo;
    // BTC: require successful preview verification
    return !!btcPreview;
  }, [networkId, chain, safeInfo, btcPreview]);

  // =========================================================================
  // Submit
  // =========================================================================
  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload: any = {
        name: name || `imported-${chain.toLowerCase()}-${Date.now()}`,
        chain_type: chain as ChainType,
        network_id: networkId,
      };

      if (chain === "EVM") {
        payload.safe_address = safeAddress;
        // Pass pre-fetched SafeInfo to skip redundant chain query on backend
        if (safeInfo) {
          payload.safe_owners = safeInfo.owners;
          payload.safe_threshold = safeInfo.threshold;
        }
      } else if (btcPreview) {
        // Always pass verified preview data — backend uses Mode A (re-derive
        // only, no chain query) since public_keys + threshold are provided.
        payload.address = btcPreview.address;
        payload.threshold = btcPreview.threshold;
        payload.public_keys = btcPreview.public_keys;
      } else if (btcMode === "manual") {
        // Fallback: no preview (shouldn't normally happen)
        payload.address = btcAddress;
        payload.threshold = btcThreshold;
        payload.public_keys = btcPublicKeys
          .split("\n")
          .map((k: string) => k.trim())
          .filter(Boolean);
      } else {
        payload.address = btcAddress;
        if (btcTxId) payload.tx_id = btcTxId;
      }

      const wallet = await importWallet(payload);
      requestRefresh();
      showToast(t("wallet.imported"), "success");
      onCompleted(wallet.id);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || "Import failed");
    } finally {
      setSubmitting(false);
    }
  };

  // =========================================================================
  // Render
  // =========================================================================
  return (
    <div
      className={`flex flex-col w-full max-w-2xl gap-4 text-[var(--text)] ${className}`}
    >
      <StepIndicator steps={stepLabels} currentStep={step} />

      {error && (
        <div className="text-sm text-[var(--danger)] font-bold">{error}</div>
      )}

      {/* ================================================================= */}
      {/* Step 1: Chain / Network / Name                                    */}
      {/* ================================================================= */}
      {step === 1 && (
        <div className="flex flex-col gap-5">
          {/* ---- Network picker dropdown (matching CreateWalletPage) ---- */}
          <div>
            <div className="text-sm font-semibold text-[var(--text)] mb-2">
              {t("walletModal.stepSelectChain")}
            </div>
            <div className="relative">
              <button
                type="button"
                ref={networkButtonRef}
                onClick={() => setNetworkPickerOpen((prev) => !prev)}
                className="w-full h-14 px-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)] flex items-center justify-between shadow-[var(--card-shadow)]"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`w-9 h-9 rounded-xl flex items-center justify-center font-semibold text-white ${
                      chain === "EVM"
                        ? "bg-[var(--chain-evm)]"
                        : "bg-[var(--chain-btc)]"
                    }`}
                  >
                    {chain === "EVM" ? "E" : "B"}
                  </span>
                  <span className="font-semibold text-[var(--text)]">
                    {selectedNetworkLabel}
                  </span>
                </div>
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
                    d="M6 9l6 6 6-6"
                  />
                </svg>
              </button>

              {networkPickerOpen && (
                <div
                  ref={networkMenuRef}
                  className="overlay-surface absolute z-20 mt-2 w-full rounded-2xl border border-[var(--border)] p-3 shadow-[var(--shadow-overlay)]"
                >
                  {/* mainnet / testnet tabs */}
                  <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-1 w-fit">
                    {(["mainnet", "testnet"] as const)
                      .filter((tab) => tab === "mainnet" || showTestnets)
                      .map((tab) => {
                        const active = networkTab === tab;
                        return (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setNetworkTab(tab)}
                            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                              active
                                ? "bg-[var(--row-head-bg)] text-[var(--text)] border border-[var(--border)]"
                                : "text-[var(--muted)] hover:text-[var(--text)]"
                            }`}
                          >
                            {tab === "mainnet"
                              ? t("common.mainnet")
                              : t("common.testnet")}
                          </button>
                        );
                      })}
                  </div>

                  {/* Network items */}
                  <div className="mt-3 space-y-2 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
                    {(() => {
                      const evmMainnets = evmNetworks.filter(
                        (n) => !n.is_testnet
                      );
                      const evmTestnets = evmNetworks.filter(
                        (n) => n.is_testnet
                      );
                      const btcMainnets = btcNetworks.filter(
                        (n) => !n.is_testnet
                      );
                      const btcTestnets = btcNetworks.filter(
                        (n) => n.is_testnet
                      );

                      const btcOptions =
                        networkTab === "mainnet"
                          ? btcMainnets
                          : showTestnets
                          ? btcTestnets
                          : [];
                      const evmOptions =
                        networkTab === "mainnet"
                          ? evmMainnets
                          : evmTestnets;

                      const items = [
                        ...btcOptions.map((network) => ({
                          type: "BTC" as const,
                          key: `btc-${network.id}`,
                          title: network.name,
                          description:
                            network.btc_network ?? network.name,
                          selected:
                            chain === "BTC" &&
                            networkId === network.id,
                          onClick: () => {
                            setChain("BTC");
                            setNetworkId(network.id);
                          },
                        })),
                        ...evmOptions.map((network) => ({
                          type: "EVM" as const,
                          key: `evm-${network.id}`,
                          title: network.name,
                          description:
                            network.explorer_url || network.name,
                          selected:
                            chain === "EVM" &&
                            networkId === network.id,
                          onClick: () => {
                            setChain("EVM");
                            setNetworkId(network.id);
                          },
                        })),
                      ];

                      if (networksLoading) {
                        return (
                          <div className="text-sm text-[var(--muted)]">
                            {t("common.loading")}
                          </div>
                        );
                      }

                      if (items.length === 0) {
                        return (
                          <div className="text-sm text-[var(--muted)]">
                            {t("walletModal.evmNetworkEmpty")}
                          </div>
                        );
                      }

                      return items.map((item) => (
                        <button
                          type="button"
                          key={item.key}
                          onClick={() => {
                            item.onClick();
                            setNetworkPickerOpen(false);
                          }}
                          className={`w-full flex items-center justify-between rounded-xl border px-3 py-2 text-left transition-colors ${
                            item.selected
                              ? "border-[var(--accent)] bg-[var(--row-head-bg)]"
                              : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent-3)]"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-8 h-8 rounded-lg flex items-center justify-center font-semibold text-white ${
                                item.type === "EVM"
                                  ? "bg-[var(--chain-evm)]"
                                  : "bg-[var(--chain-btc)]"
                              }`}
                            >
                              {item.type === "EVM" ? "E" : "B"}
                            </span>
                            <div>
                              <div className="font-semibold text-sm">
                                {item.title}
                              </div>
                              <div className="text-xs text-[var(--muted)] truncate max-w-[220px]">
                                {item.description}
                              </div>
                            </div>
                          </div>
                          <span
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                              item.selected
                                ? "border-[var(--accent)]"
                                : "border-[var(--border)]"
                            }`}
                          >
                            {item.selected && (
                              <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]" />
                            )}
                          </span>
                        </button>
                      ));
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ---- Wallet name with random dice button ---- */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label={t("walletModal.nameLabel")}
                placeholder={t("walletModal.namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
              />
            </div>
            <Button
              variant="ghost"
              className="h-10 px-3"
              onClick={() => setName(generateWalletName())}
              aria-label={t("createWallet.regenerateName")}
              title={t("createWallet.regenerateName")}
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

          {/* ---- Safe address (EVM only, in step 1) ---- */}
          {chain === "EVM" && (
            <div>
              <Input
                label="Safe Address"
                placeholder="0x..."
                value={safeAddress}
                onChange={(e) => {
                  setSafeAddress(e.target.value);
                  setSafeInfo(null);
                  setSafeInfoError(null);
                }}
              />
              {safeInfoError && (
                <div className="text-sm text-[var(--danger)] font-semibold mt-2">
                  {safeInfoError}
                </div>
              )}
            </div>
          )}

          {/* ---- BTC fields (in step 1) ---- */}
          {chain === "BTC" && (
            <div className="space-y-4">
              {/* Wallet type (read-only for now) */}
              <div>
                <div className="text-sm font-semibold text-[var(--text)] mb-2">
                  {t("wallet.importWalletType") || "Wallet Type"}
                </div>
                <div className="h-10 px-4 rounded-xl border border-[var(--border)] bg-[var(--row-head-bg)] flex items-center text-sm text-[var(--text)]">
                  P2WSH
                  <span className="ml-2 text-xs text-[var(--muted)]">
                    ({t("wallet.importOnlyOption") || "only option"})
                  </span>
                </div>
              </div>

              {/* Import mode toggle */}
              <div>
                <div className="text-sm font-semibold text-[var(--text)] mb-2">
                  {t("wallet.importMode") || "Import Mode"}
                </div>
                <div className="inline-flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
                  <button
                    type="button"
                    onClick={() => setBtcMode("manual")}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      btcMode === "manual"
                        ? "bg-[var(--row-head-bg)] text-[var(--text)] border border-[var(--border)]"
                        : "text-[var(--muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    {t("wallet.importManual") || "Manual (Public Keys)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBtcMode("auto")}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      btcMode === "auto"
                        ? "bg-[var(--row-head-bg)] text-[var(--text)] border border-[var(--border)]"
                        : "text-[var(--muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    {t("wallet.importAuto") || "Auto (From TX)"}
                  </button>
                </div>
              </div>

              {/* BTC address */}
              <Input
                label={t("wallet.importBtcAddress") || "Multisig Address"}
                placeholder="bc1q... or tb1q..."
                value={btcAddress}
                onChange={(e) => setBtcAddress(e.target.value)}
              />

              {btcMode === "manual" ? (
                <>
                  {/* Public keys textarea */}
                  <div className="field">
                    <label className="field-label">
                      {t("wallet.importPublicKeys") || "Public Keys (one per line)"}
                    </label>
                    <textarea
                      className="field-control min-h-[120px] resize-none font-mono text-xs"
                      placeholder={
                        "02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc\n03..."
                      }
                      value={btcPublicKeys}
                      onChange={(e) => setBtcPublicKeys(e.target.value)}
                      maxLength={2000}
                    />
                    <div className="text-xs text-[var(--muted)] mt-1">
                      {
                        btcPublicKeys
                          .split("\n")
                          .filter((k) => k.trim()).length
                      }{" "}
                      {t("wallet.importKeysEntered") || "key(s) entered"}
                    </div>
                  </div>

                  {/* Threshold */}
                  <div>
                    <div className="text-sm font-semibold text-[var(--text)] mb-2">
                      {t("wallet.importThreshold") || "Threshold"}
                    </div>
                    <div className="inline-flex items-center rounded-xl border border-[var(--border)] bg-[var(--row-head-bg)] overflow-hidden">
                      <button
                        type="button"
                        className="w-10 h-10 flex items-center justify-center text-lg font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-40"
                        onClick={() =>
                          setBtcThreshold((p) => Math.max(1, p - 1))
                        }
                        disabled={btcThreshold <= 1}
                      >
                        -
                      </button>
                      <div className="w-12 h-10 flex items-center justify-center font-semibold">
                        {btcThreshold}
                      </div>
                      <button
                        type="button"
                        className="w-10 h-10 flex items-center justify-center text-lg font-semibold text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-40"
                        onClick={() => {
                          const maxKeys = btcPublicKeys
                            .split("\n")
                            .filter((k) => k.trim()).length;
                          setBtcThreshold((p) =>
                            Math.min(maxKeys || 15, p + 1)
                          );
                        }}
                      >
                        +
                      </button>
                    </div>
                    <div className="text-xs text-[var(--muted)] mt-1">
                      {btcThreshold} of{" "}
                      {
                        btcPublicKeys
                          .split("\n")
                          .filter((k) => k.trim()).length
                      }{" "}
                      {t("wallet.importKeysRequired") || "keys required to sign"}
                    </div>
                  </div>
                </>
              ) : (
                <Input
                  label={t("wallet.importTxId") || "Transaction ID (optional)"}
                  placeholder={t("wallet.importTxIdPlaceholder") || "Funding transaction hash for key extraction"}
                  value={btcTxId}
                  onChange={(e) => setBtcTxId(e.target.value)}
                />
              )}
            </div>
          )}

          {/* ---- Step 1 error display ---- */}
          {(safeInfoError || btcPreviewError) && (
            <div className="text-sm text-[var(--danger)] font-bold">
              {safeInfoError || btcPreviewError}
            </div>
          )}

          {/* ---- Actions ---- */}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (chain === "EVM") {
                  handleEvmLoadInfo();
                } else {
                  handleBtcLoadInfo();
                }
              }}
              disabled={!canProceedStep1 || safeInfoLoading || btcPreviewLoading}
            >
              {(safeInfoLoading || btcPreviewLoading) ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner size="sm" /> {t("common.loading")}
                </span>
              ) : (
                t("common.next")
              )}
            </Button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Step 2: Chain-specific details                                    */}
      {/* ================================================================= */}
      {step === 2 && (
        <div className="flex flex-col gap-5">
          {/* ---- EVM: on-chain Safe info + signer matching ---- */}
          {chain === "EVM" && safeInfo && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4">
                <div className="text-sm font-semibold text-[var(--text)]">
                  Safe Info
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted)]">Address</span>
                  <span className="font-mono text-xs text-[var(--text)] max-w-[65%] text-right break-all">
                    {safeInfo.address}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted)]">Threshold</span>
                  <span className="font-semibold">
                    {safeInfo.threshold} / {safeInfo.owners.length}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted)]">Nonce</span>
                  <span className="font-semibold">{safeInfo.nonce}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted)]">Deployed</span>
                  <span className="font-semibold">
                    {safeInfo.is_deployed ? "Yes" : "No"}
                  </span>
                </div>

                {/* Owners with signer matching */}
                <div className="text-sm">
                  <span className="text-[var(--muted)]">
                    Owners ({safeInfo.owners.length})
                  </span>
                  <div className="mt-3 space-y-2">
                    {safeInfo.owners.map((owner, i) => {
                      const matched = matchSigner(owner);
                      return (
                        <div
                          key={i}
                          className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-2 ${
                            matched
                              ? "border-[var(--accent)] bg-[var(--row-head-bg)]"
                              : "border-[var(--border)] bg-[var(--row-bg)]"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-xs text-[var(--text)] break-all">
                              {owner}
                            </div>
                            {matched && (
                              <div className="text-xs text-[var(--muted)] mt-1 flex items-center gap-1.5">
                                <span className="font-semibold text-[var(--text)]">
                                  {matched.name || t("common.unknown")}
                                </span>
                                <span className="text-[var(--muted)]">·</span>
                                <span className="text-[var(--muted)]">
                                  {matched.device_type}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="shrink-0">
                            {matched ? (
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                                  matched.status === "VERIFIED"
                                    ? "bg-green-500/15 text-green-400"
                                    : matched.status === "REVOKED"
                                    ? "bg-red-500/15 text-red-400"
                                    : "bg-yellow-500/15 text-yellow-400"
                                }`}
                              >
                                {matched.status === "VERIFIED" && (
                                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                )}
                                {matched.status}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]">
                                {t("common.unknown")}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ---- BTC: verified preview from backend ---- */}
          {chain === "BTC" && btcPreview && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-[var(--text)]">
                    {t("wallet.importBtcVerified") || "BTC Verification Result"}
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2.5 py-1 text-xs font-semibold text-green-400">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {t("wallet.importAddressVerified") || "Verified"}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted)]">{t("wallet.importWalletType") || "Wallet Type"}</span>
                  <span className="font-semibold">P2WSH</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted)]">{t("wallet.importMode") || "Import Mode"}</span>
                  <span className="font-semibold">
                    {btcPreview.mode === "manual"
                      ? (t("wallet.importManual") || "Manual (Public Keys)")
                      : (t("wallet.importAuto") || "Auto (From TX)")}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted)]">Address</span>
                  <span className="font-mono text-xs text-[var(--text)] max-w-[65%] text-right break-all">
                    {btcPreview.address}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted)]">{t("wallet.importThreshold") || "Threshold"}</span>
                  <span className="font-semibold">
                    {btcPreview.threshold} / {btcPreview.signer_count}
                  </span>
                </div>

                {/* Public keys with signer matching */}
                <div className="text-sm">
                  <span className="text-[var(--muted)]">
                    {t("wallet.importPublicKeys") || "Public Keys"} ({btcPreview.public_keys.length})
                  </span>
                  <div className="mt-3 space-y-2">
                    {btcPreview.public_keys.map((pk, i) => {
                      const matched = matchBtcSigner(pk);
                      return (
                        <div
                          key={i}
                          className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-2 ${
                            matched
                              ? "border-[var(--accent)] bg-[var(--row-head-bg)]"
                              : "border-[var(--border)] bg-[var(--row-bg)]"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-xs text-[var(--text)] break-all">
                              {pk}
                            </div>
                            {matched && (
                              <div className="text-xs text-[var(--muted)] mt-1 flex items-center gap-1.5">
                                <span className="font-semibold text-[var(--text)]">
                                  {matched.name || t("common.unknown")}
                                </span>
                                <span className="text-[var(--muted)]">·</span>
                                <span className="text-[var(--muted)]">
                                  {matched.device_type}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="shrink-0">
                            {matched ? (
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                                  matched.status === "VERIFIED"
                                    ? "bg-green-500/15 text-green-400"
                                    : matched.status === "REVOKED"
                                    ? "bg-red-500/15 text-red-400"
                                    : "bg-yellow-500/15 text-yellow-400"
                                }`}
                              >
                                {matched.status === "VERIFIED" && (
                                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                )}
                                {matched.status}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]">
                                {t("common.unknown")}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ---- Actions ---- */}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => { setBtcPreview(null); setBtcPreviewError(null); setStep(1); }}>
              {t("common.prev")}
            </Button>
            <Button
              variant="primary"
              onClick={() => setStep(3)}
              disabled={!canProceedStep2}
            >
              {t("common.next")}
            </Button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Step 3: Confirm & Import                                          */}
      {/* ================================================================= */}
      {step === 3 && (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            {t("walletModal.confirmInfo")}
          </p>

          <div className="p-5 rounded-xl border border-[var(--field-border)] bg-[var(--row-bg)] divide-y divide-[var(--border)]">
            <InfoRow
              label={t("walletModal.summaryName")}
              value={name || "-"}
            />
            <InfoRow
              label={t("walletModal.summaryChain")}
              value={selectedNetworkLabel}
            />
            {chain === "EVM" && (
              <>
                <InfoRow label="Safe Address" value={safeAddress} mono />
                {safeInfo && (
                  <InfoRow
                    label="Threshold"
                    value={`${safeInfo.threshold} / ${safeInfo.owners.length}`}
                  />
                )}
              </>
            )}
            {chain === "BTC" && btcPreview && (
              <>
                <InfoRow label="Address" value={btcPreview.address} mono />
                <InfoRow
                  label="Mode"
                  value={btcPreview.mode === "manual" ? "Manual" : "Auto (TX)"}
                />
                <InfoRow
                  label="Threshold"
                  value={`${btcPreview.threshold} / ${btcPreview.signer_count}`}
                />
                <InfoRow
                  label={t("wallet.importPublicKeys") || "Public Keys"}
                  value={`${btcPreview.public_keys.length} keys`}
                />
              </>
            )}
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => { setError(null); setStep(2); }}>
              {t("common.back")}
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner size="sm" /> Importing...
                </span>
              ) : (
                t("wallet.importExisting") || "Import Wallet"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
