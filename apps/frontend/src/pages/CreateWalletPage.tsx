import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Breadcrumb,
  Button,
  Card,
  Input,
  Modal,
  PageShell,
  SelectMenu,
  Spinner,
} from "../components/ui";
import { ImportSignatureAddressForm } from "../components/SignatureAddress/ImportSignatureAddressForm";
import { BtcAddressFormatSelector } from "../components/wallet/BtcAddressFormatSelector";
import { useTranslation } from "../hooks/useTranslation";
import { useFormDraft } from "../hooks/useFormDraft";
import { usePreferenceStore } from "../stores/usePreferenceStore";
import { usePendingStore } from "../stores/usePendingStore";
import { useToastStore } from "../stores/useToastStore";
import { createWallet, getNetworks, getSigners } from "../api";
import { SOURCE_ICON_MAP } from "../utils/signer";
import type { NetworkConfig, Signer, ChainType, Wallet } from "../types";

type ChainOption = "BTC" | "EVM";
type BtcNetworkName = "mainnet" | "testnet3" | "testnet4";

interface CreateWalletDraft {
  formData: { name: string; chain: string; note: string; networkId: string };
  signerCount: number;
  signerSlots: string[];
  threshold: number;
  displayThreshold: number;
  networkTab: string;
  btcScriptType?: "p2wsh" | "p2sh-p2wsh";
}

export const CreateWalletPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { showTestnets } = usePreferenceStore();
  const { requestRefresh } = usePendingStore();
  const { showToast } = useToastStore();

  const [createStep, setCreateStep] = useState<1 | 2 | 3>(1);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdWallet, setCreatedWallet] = useState<Wallet | null>(null);

  const [signers, setSigners] = useState<Signer[]>([]);
  const [signersLoading, setSignersLoading] = useState(false);
  const [signersLoaded, setSignersLoaded] = useState(false);
  const signerRequestRef = React.useRef(0);
  const [signerCount, setSignerCount] = useState(2);
  const [signerSlots, setSignerSlots] = useState<string[]>(["", ""]);
  const [threshold, setThreshold] = useState(2);
  const [displayThreshold, setDisplayThreshold] = useState(2);

  const [evmNetworksAll, setEvmNetworksAll] = useState<NetworkConfig[]>([]);
  const [evmNetworksLoading, setEvmNetworksLoading] = useState(false);
  const [evmNetworksError, setEvmNetworksError] = useState<string | null>(null);
  const [btcNetworksAll, setBtcNetworksAll] = useState<NetworkConfig[]>([]);
  const [btcNetworksLoading, setBtcNetworksLoading] = useState(false);
  const [btcNetworksError, setBtcNetworksError] = useState<string | null>(null);

  const [networkTab, setNetworkTab] = useState<"mainnet" | "testnet">("mainnet");
  const [networkPickerOpen, setNetworkPickerOpen] = useState(false);
  const networkButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const networkMenuRef = React.useRef<HTMLDivElement | null>(null);

  const generateWalletName = () => {
    const nouns = ["ridge", "orbit", "forest", "vault", "harbor", "ember", "delta", "stone"];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const suffix = Math.floor(Math.random() * 90 + 10);
    return `wallet-${noun}-${suffix}`;
  };

  const [formData, setFormData] = useState({
    name: generateWalletName(),
    chain: "BTC" as ChainOption,
    note: "",
    networkId: "" as string,
  });

  const [btcScriptType, setBtcScriptType] = useState<"p2wsh" | "p2sh-p2wsh">("p2wsh");
  const [importSignerSlot, setImportSignerSlot] = useState<number | null>(null);
  const reviewTreeRef = React.useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const tree = reviewTreeRef.current;
    if (!tree) return;

    const wallet = tree.querySelector<HTMLElement>("[data-review-wallet]");
    const cards = tree.querySelectorAll<HTMLElement>("[data-review-signer]");
    const svg = tree.querySelector<SVGSVGElement>("[data-review-connectors]");
    if (!wallet || !svg) return;

    const updateConnectors = () => {
      const bounds = svg.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const source = wallet.getBoundingClientRect();
      const startX = source.right - bounds.left;
      const startY = source.top + source.height / 2 - bounds.top;
      const paths = svg.querySelectorAll("path");
      cards.forEach((card, index) => {
        const target = card.getBoundingClientRect();
        const endX = target.left - bounds.left;
        const endY = target.top + target.height / 2 - bounds.top;
        const controlX = (startX + endX) / 2;
        paths[index]?.setAttribute(
          "d",
          `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`,
        );
      });
    };

    // Follow real card sizes, including text wrapping and responsive changes.
    updateConnectors();
    const observer = new ResizeObserver(updateConnectors);
    observer.observe(tree);
    observer.observe(wallet);
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [createStep, formData.chain, signerSlots]);


  const { load: loadDraft, save: saveDraft, clear: clearDraft } =
    useFormDraft<CreateWalletDraft>("create-wallet");

  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setFormData(draft.formData as typeof formData);
      setSignerCount(draft.signerCount);
      setSignerSlots(draft.signerSlots);
      setThreshold(draft.threshold);
      setDisplayThreshold(draft.displayThreshold);
      setNetworkTab(draft.networkTab as typeof networkTab);
      if (draft.btcScriptType) setBtcScriptType(draft.btcScriptType);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    saveDraft({
      formData,
      signerCount,
      signerSlots,
      threshold,
      displayThreshold,
      networkTab,
      btcScriptType,
    });
  }, [formData, signerCount, signerSlots, threshold, displayThreshold, networkTab, btcScriptType, saveDraft]);

  const walletTypeLabel = useMemo(() => {
    if (formData.chain === "EVM") return t("walletModal.walletTypeSafe");
    return btcScriptType === "p2sh-p2wsh"
      ? t("walletModal.walletTypeP2shP2wsh")
      : t("walletModal.walletTypeP2wsh");
  }, [formData.chain, btcScriptType, t]);

  const selectedNetworkLabel = useMemo(() => {
    if (formData.chain === "BTC") {
      const network = btcNetworksAll.find((item) => item.id === formData.networkId);
      if (!network) return t("common.bitcoin");
      const networkLabel = network.is_testnet ? t("common.testnet") : t("common.mainnet");
      return `${network.name} · ${networkLabel}`;
    }
    const network = evmNetworksAll.find((item) => item.id === formData.networkId);
    if (network) {
      return `${network.name}${network.is_testnet ? ` (${t("common.testnet")})` : ""}`;
    }
    return t("common.evm");
  }, [btcNetworksAll, evmNetworksAll, formData.networkId, formData.chain, t]);

  const selectedBtcNetwork = useMemo(() => {
    if (formData.chain !== "BTC") return null;
    return btcNetworksAll.find((item) => item.id === formData.networkId) ?? null;
  }, [btcNetworksAll, formData.chain, formData.networkId]);

  const selectedBtcNetworkName = useMemo<BtcNetworkName | null>(() => {
    const value = selectedBtcNetwork?.btc_network?.toLowerCase();
    if (value === "mainnet" || value === "testnet3" || value === "testnet4") {
      return value;
    }
    return null;
  }, [selectedBtcNetwork]);

  const fetchSigners = async (chain: ChainOption = formData.chain) => {
    const requestId = ++signerRequestRef.current;
    try {
      setSignersLoading(true);
      // Request the intended chain from the API.  Keeping this server-side
      // prevents an EVM item from ever becoming a BTC select-menu option.
      const response = await getSigners(chain);
      const verified = (response.items || []).filter(
        (signer) => signer.status === "VERIFIED" && signer.chain_type === chain,
      );
      if (requestId === signerRequestRef.current) setSigners(verified);
      return verified;
    } catch (err) {
      if (requestId === signerRequestRef.current) {
        setCreateError(
          err instanceof Error ? err.message : t("walletModal.errorLoadSigners")
        );
        setSigners([]);
      }
      return [] as Signer[];
    } finally {
      if (requestId === signerRequestRef.current) {
        setSignersLoading(false);
        setSignersLoaded(true);
      }
    }
  };

  const fetchEvmNetworks = async () => {
    try {
      setEvmNetworksLoading(true);
      setEvmNetworksError(null);
      const networks = await getNetworks('EVM');
      setEvmNetworksAll(networks || []);
      setFormData((prev) => {
        if (prev.chain !== "EVM" || prev.networkId !== "" || !networks?.length) return prev;
        const preferred = networks.find(
          (item) => item.name.toLowerCase() === "ethereum" && !item.is_testnet
        );
        return { ...prev, networkId: (preferred || networks[0]).id };
      });
    } catch (err) {
      setEvmNetworksAll([]);
      setEvmNetworksError(
        err instanceof Error ? err.message : t("walletModal.errorLoadNetworks")
      );
    } finally {
      setEvmNetworksLoading(false);
    }
  };

  const fetchBtcNetworks = async () => {
    try {
      setBtcNetworksLoading(true);
      setBtcNetworksError(null);
      const networks = await getNetworks('BTC');
      setBtcNetworksAll(networks || []);
      setFormData((prev) => {
        if (prev.chain !== "BTC" || prev.networkId !== "" || !networks?.length) return prev;
        const preferred = networks.find((item) => !item.is_testnet);
        return { ...prev, networkId: (preferred || networks[0]).id };
      });
    } catch (err) {
      setBtcNetworksAll([]);
      setBtcNetworksError(
        err instanceof Error ? err.message : t("walletModal.errorLoadNetworks")
      );
    } finally {
      setBtcNetworksLoading(false);
    }
  };

  useEffect(() => {
    void fetchSigners(formData.chain);
  }, [formData.chain]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchEvmNetworks();
    fetchBtcNetworks();
  }, [showTestnets]);

  useEffect(() => {
    if (!showTestnets && networkTab === "testnet") {
      setNetworkTab("mainnet");
    }
  }, [showTestnets, networkTab]);

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

  const availableSigners = useMemo(() => {
    if (formData.chain === "EVM") {
      return signers.filter((s) => s.chain_type === "EVM");
    }

    const network = selectedBtcNetwork;
    const isTestnet = network?.is_testnet || selectedBtcNetworkName?.includes("testnet");
    const expectedCoinType = isTestnet ? "/1'" : "/0'";
    const expectedSuffix = btcScriptType === "p2sh-p2wsh" ? "/1'" : "/2'";
    return signers.filter((s) => {
      if (s.chain_type !== "BTC" || !s.public_key) return false;
      // BTC testnet variants are separate networks.  A signer already used
      // on Testnet4 must not be offered for Testnet3 (and vice versa).
      if (s.wallets?.length) {
        return s.wallets.some((wallet) => wallet.network_id === formData.networkId);
      }
      if (s.btc_network) {
        return s.btc_network.toLowerCase() === selectedBtcNetworkName;
      }
      // Legacy testnet signers only record BIP-48 coin type 1, which cannot
      // distinguish Testnet3 from Testnet4.  Exclude them until re-imported.
      if (isTestnet) return false;
      if (!s.derivation_path) return true;
      // Match BIP 48 signers with correct coin type
      const coinTypeMatch = s.derivation_path.startsWith(`m/48'${expectedCoinType}`) ||
        s.derivation_path.startsWith(`m/84'${expectedCoinType}`);
      if (!coinTypeMatch) return false;
      // Filter by script type suffix
      if (s.derivation_path.startsWith("m/48'")) {
        return s.derivation_path.endsWith(expectedSuffix);
      }
      return true; // Legacy BIP 84 signers pass through
    });
  }, [signers, formData.chain, formData.networkId, selectedBtcNetwork, selectedBtcNetworkName, btcScriptType]);

  const availableSignerShortage = Math.max(0, signerCount - availableSigners.length);

  useEffect(() => {
    if (!signersLoaded) return;
    const availableSignerIds = new Set(availableSigners.map((signer) => signer.id));
    setSignerSlots((slots) => {
      const next = slots.map((signerId) =>
        signerId && !availableSignerIds.has(signerId) ? "" : signerId,
      );
      return next.some((signerId, index) => signerId !== slots[index])
        ? next
        : slots;
    });
  }, [availableSigners, signersLoaded]);

  const normalizeSlots = (count: number, slots: string[]) => {
    const next = slots.slice(0, count);
    while (next.length < count) next.push("");
    return next;
  };

  useEffect(() => {
    setSignerSlots((slots) => normalizeSlots(signerCount, slots));
  }, [signerCount]);

  useEffect(() => {
    if (displayThreshold > signerCount) setDisplayThreshold(signerCount);
    if (displayThreshold < 2) setDisplayThreshold(2);
  }, [displayThreshold, signerCount]);

  useEffect(() => {
    setThreshold(displayThreshold);
  }, [displayThreshold]);

  useEffect(() => {
    if (formData.chain === "BTC") {
      setSignerSlots((prev) => prev.map(() => ""));
    }
  }, [btcScriptType]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateSignerSlot = (index: number, value: string) => {
    if (value && !availableSigners.some((signer) => signer.id === value)) return;
    setSignerSlots((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const closeSignerImport = () => {
    setImportSignerSlot(null);
    void fetchSigners();
  };

  const useImportedSigner = async (signerId: string) => {
    const targetSlot = importSignerSlot;
    const eligibleSigners = await fetchSigners(formData.chain);
    // The import wizard is locked to the wallet context, but retain a final
    // guard here so an address returned for another chain cannot be inserted.
    if (targetSlot !== null && eligibleSigners.some((signer) => signer.id === signerId)) {
      updateSignerSlot(targetSlot, signerId);
    }
    setImportSignerSlot(null);
  };

  const adjustSignerCount = (next: number) => {
    const clamped = Math.max(2, Math.min(next, 5));
    setSignerCount(clamped);
    setSignerSlots((slots) => normalizeSlots(clamped, slots));
    setDisplayThreshold((prev) => Math.min(Math.max(2, prev), clamped));
  };

  const selectNetwork = (chain: ChainOption, networkId: string) => {
    if (chain !== formData.chain) {
      // A signer is valid only for the chain it was selected under.
      setSignerSlots((slots) => slots.map(() => ""));
    }
    setFormData((prev) => ({ ...prev, chain, networkId }));
  };

  useEffect(() => {
    if (evmNetworksLoading || btcNetworksLoading) return;
    const evmMainnets = evmNetworksAll.filter((n) => !n.is_testnet);
    const evmTestnets = evmNetworksAll.filter((n) => n.is_testnet);
    const btcMainnets = btcNetworksAll.filter((n) => !n.is_testnet);
    const btcTestnets = btcNetworksAll.filter((n) => n.is_testnet);

    const btcList = networkTab === "mainnet" ? btcMainnets : btcTestnets;
    const evmList = networkTab === "mainnet" ? evmMainnets : evmTestnets;

    const isBtcValid =
      formData.chain === "BTC" &&
      btcList.some((n) => n.id === formData.networkId);
    const isEvmValid =
      formData.chain === "EVM" &&
      evmList.some((n) => n.id === formData.networkId);

    if (isBtcValid || isEvmValid) return;

    // Build ordered fallback candidates — prefer the user's current chain type
    const list = networkTab === "mainnet"
      ? [
          ...btcMainnets.map((n) => ({ chain: "BTC" as const, id: n.id })),
          ...evmMainnets.map((n) => ({ chain: "EVM" as const, id: n.id })),
        ]
      : [
          ...(showTestnets ? btcTestnets : []).map((n) => ({ chain: "BTC" as const, id: n.id })),
          ...evmTestnets.map((n) => ({ chain: "EVM" as const, id: n.id })),
        ];

    // Sort: same chain first, then the other
    const currentChain = formData.chain;
    list.sort((a, b) => {
      if (a.chain === currentChain && b.chain !== currentChain) return -1;
      if (a.chain !== currentChain && b.chain === currentChain) return 1;
      return 0;
    });

    const pick = list[0];
    if (pick) {
      if (pick.chain !== formData.chain) {
        setSignerSlots((slots) => slots.map(() => ""));
      }
      setFormData((prev) => ({ ...prev, chain: pick.chain, networkId: pick.id }));
    }
  }, [
    networkTab,
    evmNetworksAll,
    btcNetworksAll,
    evmNetworksLoading,
    btcNetworksLoading,
    formData.chain,
    formData.networkId,
    showTestnets,
  ]);

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      setCreateError(t("walletModal.errorNameRequired"));
      return;
    }
    if (formData.networkId === "") {
      setCreateError(
        formData.chain === "EVM"
          ? t("walletModal.errorEvmNetworkRequired")
          : t("walletModal.errorBtcNetworkRequired")
      );
      return;
    }
    const normalizedSignerIds = signerSlots.filter((id) => id);
    const uniqueSignerIds = Array.from(new Set(normalizedSignerIds));
    if (signerCount < 1 || normalizedSignerIds.length < signerCount) {
      setCreateError(t("walletModal.errorSignerRequired"));
      return;
    }
    if (uniqueSignerIds.length !== normalizedSignerIds.length) {
      setCreateError(t("walletModal.errorSignerDuplicate"));
      return;
    }
    const eligibleSignerIds = new Set(availableSigners.map((signer) => signer.id));
    if (uniqueSignerIds.some((signerId) => !eligibleSignerIds.has(signerId))) {
      setCreateError(t("walletModal.errorSignerRequired"));
      return;
    }
    if (threshold < 1 || threshold > signerCount) {
      setCreateError(t("walletModal.errorThresholdInvalid"));
      return;
    }

    setCreating(true);
    setCreateStep(3);
    setCreateError(null);

    try {
      const chainType: ChainType =
        formData.chain === "EVM" ? "EVM" : "BTC";
      const wallet = await createWallet({
        name: formData.name.trim(),
        chain_type: chainType,
        threshold,
        signer_ids: uniqueSignerIds,
        network_id: formData.networkId,
      });
      setCreatedWallet(wallet);
      setCreateStep(3);
      clearDraft();
      requestRefresh();
      showToast(t("wallet.created"), "success");
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : t("walletModal.errorCreateFailed")
      );
      setCreateStep(2);
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!createdWallet?.id) return;
    const timer = window.setTimeout(() => {
      navigate(`/wallet/${createdWallet.id}`);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [createdWallet, navigate]);

  return (
    <PageShell
      title={t("walletModal.title")}
      breadcrumbs={
        <Breadcrumb
          items={[
            { label: t("wallet.listTitle"), href: "/wallet" },
            { label: t("walletModal.title") },
          ]}
        />
      }
    >
      <Card className="mx-auto w-full max-w-[1040px] p-4 sm:p-6 lg:p-7">
        <div className="flex items-start justify-between gap-2 mb-6 flex-wrap lg:flex-nowrap">
          {[1, 2, 3].map((stepIndex, index) => {
            const isCompleted = createStep > stepIndex;
            const isActive = createStep === stepIndex;
            return (
              <React.Fragment key={stepIndex}>
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border ${
                      isActive
                        ? "bg-[var(--wallet-primary)] text-white border-[var(--wallet-primary)]"
                        : isCompleted
                        ? "bg-[var(--wallet-primary-soft)] text-[var(--wallet-primary)] border-[var(--wallet-primary)]/25"
                        : "bg-[var(--surface)] text-[var(--muted)] border-[var(--border)]"
                    }`}
                  >
                    {stepIndex}
                  </div>
                  <span className="text-sm mt-3 text-center text-[var(--muted)] font-semibold whitespace-nowrap">
                    {stepIndex === 1 && t("walletModal.stepInfo")}
                    {stepIndex === 2 && t("walletModal.stepSigners")}
                    {stepIndex === 3 && t("walletModal.stepDone")}
                  </span>
                </div>
                {index < 2 && (
                  <div className="flex items-center justify-center mt-5">
                    <div className={`h-px w-8 sm:w-16 lg:w-24 ${isCompleted ? "bg-[var(--wallet-primary)]" : "bg-[var(--border)]"}`} />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {createError && (
          <div className="mb-3 text-sm text-[var(--danger)] font-bold">{createError}</div>
        )}

        {createStep === 1 && (
          <div className="space-y-5">
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
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center font-semibold text-white ${
                      formData.chain === "EVM"
                        ? "bg-[var(--chain-evm)]"
                        : "bg-[var(--chain-btc)]"
                    }`}>
                      {formData.chain === "EVM" ? "E" : "B"}
                    </span>
                    <span className="font-semibold text-[var(--text)]">{selectedNetworkLabel}</span>
                  </div>
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {networkPickerOpen && (
                  <div
                    ref={networkMenuRef}
                    className="overlay-surface absolute z-20 mt-2 w-full rounded-2xl border border-[var(--field-border)] shadow-[var(--shadow-overlay)] p-3"
                  >
                    <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--overlay-bg)] p-1 w-fit">
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
                            {tab === "mainnet" ? t("common.mainnet") : t("common.testnet")}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 space-y-2 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
                      {(() => {
                        const evmMainnets = evmNetworksAll.filter((n) => !n.is_testnet);
                        const evmTestnets = evmNetworksAll.filter((n) => n.is_testnet);
                        const btcMainnets = btcNetworksAll.filter((n) => !n.is_testnet);
                        const btcTestnets = btcNetworksAll.filter((n) => n.is_testnet);

                        const btcOptions =
                          networkTab === "mainnet" ? btcMainnets : showTestnets ? btcTestnets : [];
                        const evmOptions = networkTab === "mainnet" ? evmMainnets : evmTestnets;

                        const items = [
                          ...btcOptions.map((network) => ({
                            type: "BTC" as const,
                            key: `btc-${network.id}`,
                            title: network.name,
                            description: network.btc_network ?? network.name,
                            recommended: !network.is_testnet,
                            selected:
                              formData.chain === "BTC" && formData.networkId === network.id,
                            onClick: () => selectNetwork("BTC", network.id),
                          })),
                          ...evmOptions.map((network) => ({
                            type: "EVM" as const,
                            key: `evm-${network.id}`,
                            title: network.name,
                            description: network.explorer_url || network.name,
                            recommended:
                              network.name.toLowerCase() === "ethereum" && !network.is_testnet,
                            selected:
                              formData.chain === "EVM" && formData.networkId === network.id,
                            onClick: () => selectNetwork("EVM", network.id),
                          })),
                        ];

                        if (evmNetworksLoading || btcNetworksLoading) {
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
                                : "border-[var(--border)] bg-[var(--overlay-bg)] hover:border-[var(--accent-3)]"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-semibold text-white ${
                                item.type === "EVM"
                                  ? "bg-[var(--chain-evm)]"
                                  : "bg-[var(--chain-btc)]"
                              }`}>
                                {item.type === "EVM" ? "E" : "B"}
                              </span>
                              <div>
                                <div className="font-semibold text-sm">{item.title}</div>
                                <div className="text-xs text-[var(--muted)] truncate max-w-[220px]">
                                  {item.description}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
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
                            </div>
                          </button>
                        ));
                      })()}
                    </div>
                    {(evmNetworksError || btcNetworksError) && (
                      <div className="text-xs text-[var(--danger)] mt-2">
                        {evmNetworksError || btcNetworksError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {formData.chain === "BTC" ? (
              <BtcAddressFormatSelector
                value={btcScriptType}
                onChange={setBtcScriptType}
              />
            ) : (
              <section className="space-y-3" aria-labelledby="evm-wallet-format-title">
                <div>
                  <h3 id="evm-wallet-format-title" className="field-label">{t("createWallet.evmAddressFormatTitle")}</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("createWallet.evmFormatDescription")}</p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--accent)]/25 bg-[var(--accent-soft)] text-[var(--accent)]">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M12 14v2" strokeLinecap="round" />
                        </svg>
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-extrabold text-[var(--text)]">{t("createWallet.evmFormatTitle")}</span>
                          <span className="rounded-full bg-[var(--row-head-bg)] px-2 py-0.5 text-[11px] font-bold text-[var(--muted)]">{t("createWallet.evmFormatFixed")}</span>
                        </div>
                        <p className="mt-1 text-sm text-[var(--muted)]">{walletTypeLabel}</p>
                      </div>
                    </div>
                    <span className="inline-flex w-fit items-center rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1.5 font-mono text-xs font-bold text-[var(--text)]">0x...</span>
                  </div>
                  <dl className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-[var(--muted)]">{t("createWallet.evmFormatAccountType")}</dt>
                      <dd className="mt-1 text-sm font-bold text-[var(--text)]">{t("createWallet.evmFormatContractAccount")}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--muted)]">{t("createWallet.formatAddressPrefix")}</dt>
                      <dd className="mt-1 font-mono text-sm font-bold text-[var(--text)]">0x...</dd>
                    </div>
                  </dl>
                </div>
              </section>
            )}

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label={t("walletModal.nameLabel")}
                  placeholder={t("walletModal.namePlaceholder")}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  maxLength={100}
                />
              </div>
              <Button
                variant="ghost"
                className="h-10 px-3"
                onClick={() => setFormData((prev) => ({ ...prev, name: generateWalletName() }))}
                aria-label={t("createWallet.regenerateName")}
                title={t("createWallet.regenerateName")}
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 0115-6l3-3v8h-8l3-3a7 7 0 10.5 8.5" />
                </svg>
              </Button>
            </div>

            <div className="field">
              <label className="field-label">{t("createWallet.noteLabel")}</label>
              <textarea
                className="field-control min-h-[96px] w-full resize-none"
                placeholder={t("createWallet.notePlaceholder")}
                value={formData.note}
                onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                maxLength={500}
              />
            </div>

            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => navigate("/wallet")} className="w-full justify-center sm:w-auto">
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={() => setCreateStep(2)}
                className="w-full justify-center sm:min-w-[128px] sm:w-auto"
                disabled={
                  formData.networkId === "" ||
                  !formData.name.trim()
                }
              >
                {t("common.next")}
              </Button>
            </div>
          </div>
        )}

        {createStep === 2 && (
          <div className="space-y-6">
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-base font-extrabold text-[var(--text)]">{t("createWallet.securityPolicyTitle")}</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("createWallet.securityPolicyHint")}</p>
                </div>
                <div className="inline-flex w-fit items-baseline gap-1 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-2 text-[var(--accent)]">
                  <span className="text-2xl font-extrabold tabular-nums">{displayThreshold}</span>
                  <span className="text-sm font-semibold">/</span>
                  <span className="text-lg font-bold tabular-nums">{signerCount}</span>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  {
                    label: t("createWallet.requiredApprovals"),
                    value: displayThreshold,
                    decrease: () => setDisplayThreshold((prev) => Math.max(2, prev - 1)),
                    increase: () => {
                      const nextThreshold = Math.min(5, displayThreshold + 1);
                      setDisplayThreshold(nextThreshold);
                      if (signerCount < nextThreshold) adjustSignerCount(nextThreshold);
                    },
                    decreaseDisabled: displayThreshold <= 2,
                    increaseDisabled: displayThreshold >= 5,
                  },
                  {
                    label: t("createWallet.totalSigners"),
                    value: signerCount,
                    decrease: () => adjustSignerCount(signerCount - 1),
                    increase: () => adjustSignerCount(signerCount + 1),
                    decreaseDisabled: signerCount <= displayThreshold,
                    increaseDisabled: signerCount >= 5,
                  },
                ].map((control) => (
                  <div key={control.label} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
                    <div className="mb-3 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">{control.label}</div>
                    <div className="grid grid-cols-[44px_1fr_44px] overflow-hidden rounded-xl border border-[var(--field-border)] bg-[var(--field-bg)]">
                      <button
                        type="button"
                        className="flex h-11 items-center justify-center border-r border-[var(--field-border)] text-xl font-semibold text-[var(--text)] transition-colors hover:bg-[var(--row-head-bg)] disabled:cursor-not-allowed disabled:opacity-35"
                        onClick={control.decrease}
                        disabled={control.decreaseDisabled}
                        aria-label={`${control.label} - 1`}
                      >
                        -
                      </button>
                      <div className="flex h-11 items-center justify-center text-lg font-extrabold tabular-nums text-[var(--text)]">{control.value}</div>
                      <button
                        type="button"
                        className="flex h-11 items-center justify-center border-l border-[var(--field-border)] text-xl font-semibold text-[var(--text)] transition-colors hover:bg-[var(--row-head-bg)] disabled:cursor-not-allowed disabled:opacity-35"
                        onClick={control.increase}
                        disabled={control.increaseDisabled}
                        aria-label={`${control.label} + 1`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-xl bg-[var(--row-head-bg)] px-3 py-2.5 text-xs leading-5 text-[var(--muted)]">
                <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="10" cy="10" r="8" />
                  <path d="M10 9v5M10 6.2v.1" strokeLinecap="round" />
                </svg>
                <span>{t("walletModal.thresholdHint", { total: String(signerCount), threshold: String(displayThreshold) })}</span>
              </div>
            </section>

            <section>
              <div className="mb-3">
                <h3 className="text-base font-extrabold text-[var(--text)]">{t("createWallet.signerTreeTitle")}</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                  {t("createWallet.signerTreeHint", { count: String(signerCount) })}
                </p>
              </div>

              <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
                {signersLoading && (
                  <div className="mb-4 flex items-center gap-2 rounded-xl bg-[var(--row-head-bg)] px-3 py-2 text-sm text-[var(--muted)]">
                    <Spinner size="sm" /> {t("walletModal.signersLoading")}
                  </div>
                )}
                {!signersLoading && availableSignerShortage > 0 && (
                  <div className="mb-4 flex items-start gap-3 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-extrabold text-[var(--panel)]">
                      {availableSignerShortage}
                    </span>
                    <div>
                      <div className="text-sm font-bold text-[var(--text)]">
                        {t("createWallet.signerShortageTitle", { count: String(availableSignerShortage) })}
                      </div>
                      <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">
                        {t("createWallet.signerShortageHint")}
                      </p>
                    </div>
                  </div>
                )}

                <div ref={reviewTreeRef} className="relative grid gap-5 md:grid-cols-[minmax(170px,0.78fr)_minmax(0,1.5fr)] md:gap-20">
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    className="pointer-events-none absolute inset-0 z-0 hidden h-full w-full overflow-visible md:block"
                    aria-hidden="true"
                  >
                    {signerSlots.map((_, index) => {
                      const y = ((index + 0.5) / signerCount) * 100;
                      const active = index < displayThreshold;
                      return (
                        <path
                          key={`signer-path-${index}`}
                          d={`M 28 50 C 34 50, 36 ${y}, 42 ${y}`}
                          className={`multisig-connector ${active ? "multisig-connector--active" : ""}`}
                        />
                      );
                    })}
                  </svg>

                  <div className="relative z-10 flex items-center justify-center md:min-h-[360px]">
                    <div data-review-wallet className="w-full max-w-[210px] rounded-2xl border border-[var(--accent)]/35 bg-[var(--panel)] p-4 shadow-[var(--card-shadow)]">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <path d="M4 7h16v12H4zM7 7V5h10v2M8 12h8M8 15h5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <div className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">{t("createWallet.walletNode")}</div>
                      <div className="mt-1 break-words text-base font-extrabold text-[var(--text)]">{formData.name}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">{selectedNetworkLabel}</div>
                      <div className="mt-4 border-t border-[var(--border)] pt-3">
                        <div className="text-2xl font-extrabold tabular-nums text-[var(--accent)]">{displayThreshold}/{signerCount}</div>
                        <div className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("createWallet.walletReadyWhen", { threshold: String(displayThreshold) })}</div>
                      </div>
                    </div>
                  </div>

                  <div className="relative z-10 space-y-3">
                    {signerSlots.map((value, index) => {
                      const used = new Set(signerSlots.filter((id) => id));
                      const required = index < displayThreshold;
                      const options = [
                        { value: "", label: t("walletModal.signerAddressPlaceholder") },
                        ...availableSigners
                          .filter((signer) => !used.has(signer.id) || signer.id === value)
                          .map((signer) => {
                            const raw = formData.chain === "BTC"
                              ? signer.public_key || ""
                              : signer.address || "";
                            const deviceInfo = SOURCE_ICON_MAP[signer.device_type];
                            const networkLabel = formData.chain === "BTC"
                              ? selectedBtcNetwork?.name || "Bitcoin"
                              : selectedNetworkLabel;
                            return {
                              value: signer.id,
                              label: `${signer.name}${deviceInfo ? ` (${deviceInfo.label})` : ""}\n${networkLabel} · ${raw}`,
                              icon: deviceInfo?.icon,
                            };
                          }),
                      ];
                      return (
                        <div
                          key={`signer-slot-${index}`}
                          className={`relative rounded-xl border p-3 transition-colors ${
                            required
                              ? "border-[var(--accent)]/35 bg-[var(--accent-soft)]"
                              : "border-[var(--border)] bg-[var(--panel)]"
                          }`}
                        >
                          {formData.chain === "BTC" && (
                            <span className={`absolute -left-5 top-1/2 h-px w-5 -translate-y-1/2 md:hidden ${required ? "multisig-mobile-connector" : "bg-[var(--border)]"}`} aria-hidden="true" />
                          )}
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold ${
                                required ? "bg-[var(--accent)] text-[var(--panel)]" : "bg-[var(--row-head-bg)] text-[var(--muted)]"
                              }`}>
                                {index + 1}
                              </span>
                              <span className="truncate text-xs font-bold text-[var(--text)]">
                                {t("createWallet.signerSlotLabel", { index: String(index + 1) })}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {value && (
                                <button
                                  type="button"
                                  onClick={() => updateSignerSlot(index, "")}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)]"
                                  aria-label={t("common.delete")}
                                  title={t("common.delete")}
                                >
                                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M3 6h18" />
                                    <path d="M8 6V4h8v2" />
                                    <path d="M19 6l-1 14H6L5 6" />
                                    <path d="M10 11v5M14 11v5" />
                                  </svg>
                                </button>
                              )}
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                required ? "bg-[var(--accent)] text-[var(--panel)]" : "bg-[var(--row-head-bg)] text-[var(--muted)]"
                              }`}>
                                {required ? t("createWallet.requiredPath") : t("createWallet.standbyPath")}
                              </span>
                            </div>
                          </div>
                          <SelectMenu
                            value={value}
                            onChange={(next) => updateSignerSlot(index, next)}
                            options={options}
                            className="min-h-[48px] w-full bg-[var(--field-bg)]"
                            menuClassName="bg-[var(--panel)]"
                          />
                          {!value && (
                            <button
                              type="button"
                              onClick={() => setImportSignerSlot(index)}
                              className="mt-2 flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--accent)]/45 bg-[var(--panel)] px-3 py-2 text-xs font-bold text-[var(--accent)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                            >
                              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                <path d="M10 4v12M4 10h12" strokeLinecap="round" />
                              </svg>
                              {t("createWallet.addSignerAddress")}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setCreateStep(1)} className="w-full justify-center sm:w-auto">
                {t("common.back")}
              </Button>
              <Button
                variant="primary"
                onClick={() => setCreateStep(3)}
                className="w-full justify-center sm:min-w-[128px] sm:w-auto"
                disabled={
                  signerCount < 2 ||
                  signerSlots.filter((id) => id).length !== signerCount ||
                  new Set(signerSlots.filter((id) => id)).size !== signerCount ||
                  threshold < 2
                }
              >
                {t("common.next")}
              </Button>
            </div>
          </div>
        )}

        {createStep === 3 && (
          <div className="space-y-4">
            <div className="text-sm text-[var(--muted)]">
              {createdWallet
                ? t("walletModal.walletCreated")
                : creating
                ? t("walletModal.creatingWallet")
                : t("walletModal.confirmInfo")}
            </div>

            {formData.chain === "EVM" ? (
              <div className="space-y-5">
                <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-base font-extrabold text-[var(--text)]">{t("createWallet.reviewWalletInfo")}</h3>
                    <span className="rounded-full bg-[var(--row-head-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--muted)]">
                      {t("createWallet.readOnlyReview")}
                    </span>
                  </div>
                  <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                    {[
                      [t("walletModal.summaryName"), formData.name || "-"],
                      [t("walletModal.summaryChain"), selectedNetworkLabel],
                      [t("walletModal.walletTypeLabel"), walletTypeLabel],
                      [t("walletModal.summaryThreshold"), `${threshold} / ${signerCount}`],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-3">
                        <dt className="text-xs font-semibold text-[var(--muted)]">{label}</dt>
                        <dd className="mt-1 break-words text-sm font-extrabold text-[var(--text)]">{value}</dd>
                      </div>
                    ))}
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-3 sm:col-span-2">
                      <dt className="text-xs font-semibold text-[var(--muted)]">{t("createWallet.noteLabel")}</dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text)]">
                        {formData.note.trim() || t("createWallet.noNote")}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section>
                  <div className="mb-3">
                    <h3 className="text-base font-extrabold text-[var(--text)]">{t("createWallet.reviewSignerTreeTitle")}</h3>
                    <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                      {t("createWallet.reviewSignerTreeHint", { threshold: String(threshold), total: String(signerCount) })}
                    </p>
                  </div>
                  <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
                    <div ref={reviewTreeRef} className="relative grid gap-5 md:grid-cols-[minmax(170px,0.78fr)_minmax(0,1.5fr)] md:gap-20">
                      <svg
                        data-review-connectors
                        className="pointer-events-none absolute inset-0 z-0 hidden h-full w-full overflow-visible md:block"
                        aria-hidden="true"
                      >
                        {signerSlots.map((_, index) => (
                          <path
                            key={`review-signer-path-${index}`}
                            className={`multisig-connector ${index < threshold ? "multisig-connector--active" : ""}`}
                          />
                        ))}
                      </svg>

                      <div className="relative z-10 flex items-center justify-center md:min-h-[330px]">
                        <div data-review-wallet className="w-full max-w-[210px] rounded-2xl border border-[var(--accent)]/35 bg-[var(--panel)] p-4 shadow-[var(--card-shadow)]">
                          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                              <path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M12 14v2" strokeLinecap="round" />
                            </svg>
                          </div>
                          <div className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">Safe · EVM</div>
                          <div className="mt-1 break-words text-base font-extrabold text-[var(--text)]">{formData.name}</div>
                          <div className="mt-1 text-xs text-[var(--muted)]">{selectedNetworkLabel}</div>
                          <div className="mt-4 border-t border-[var(--border)] pt-3">
                            <div className="text-2xl font-extrabold tabular-nums text-[var(--accent)]">{threshold}/{signerCount}</div>
                            <div className="mt-1 text-xs leading-5 text-[var(--muted)]">
                              {t("createWallet.walletReadyWhen", { threshold: String(threshold) })}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="relative z-10 space-y-3">
                        {signerSlots.map((id, index) => {
                          const signer = availableSigners.find((item) => item.id === id);
                          const address = formData.chain === "BTC"
                            ? signer?.public_key || "-"
                            : signer?.address || "-";
                          const deviceInfo = signer ? SOURCE_ICON_MAP[signer.device_type] : undefined;
                          const required = index < threshold;
                          return (
                            <div
                              key={`review-signer-${index}`}
                              data-review-signer
                              className={`relative rounded-xl border p-3 ${
                                required
                                  ? "border-[var(--accent)]/35 bg-[var(--accent-soft)]"
                                  : "border-[var(--border)] bg-[var(--panel)]"
                              }`}
                            >
                              {formData.chain === "BTC" && (
                                <span className={`absolute -left-5 top-1/2 h-px w-5 -translate-y-1/2 md:hidden ${required ? "multisig-mobile-connector" : "bg-[var(--border)]"}`} aria-hidden="true" />
                              )}
                              <div className="flex items-start gap-3">
                                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold ${
                                  required ? "bg-[var(--accent)] text-[var(--panel)]" : "bg-[var(--row-head-bg)] text-[var(--muted)]"
                                }`}>
                                  {index + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    {deviceInfo && <img src={deviceInfo.icon} alt={deviceInfo.label} className="h-5 w-5 object-contain" />}
                                    <span className="font-extrabold text-[var(--text)]">{signer?.name || "-"}</span>
                                    {deviceInfo && <span className="text-xs font-semibold text-[var(--muted)]">{deviceInfo.label}</span>}
                                    <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                      required ? "bg-[var(--accent)] text-[var(--panel)]" : "bg-[var(--row-head-bg)] text-[var(--muted)]"
                                    }`}>
                                      {required ? t("createWallet.requiredPath") : t("createWallet.standbyPath")}
                                    </span>
                                  </div>
                                  <div className="mt-2 break-all font-mono text-xs leading-5 text-[var(--muted)]">{address}</div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted)]">{t("walletModal.summaryName")}</span>
                  <span className="font-semibold">{formData.name || "-"}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted)]">{t("walletModal.summaryChain")}</span>
                  <span className="font-semibold">{selectedNetworkLabel}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted)]">{t("walletModal.walletTypeLabel")}</span>
                  <span className="font-semibold">{walletTypeLabel}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted)]">{t("walletModal.summaryThreshold")}</span>
                  <span className="font-semibold">{threshold} / {signerCount}</span>
                </div>
                <div className="text-sm text-[var(--muted)]">{t("walletModal.signerAddressesTitle")}</div>
                <div className="space-y-2">
                  {signerSlots.map((id, index) => {
                    const signer = availableSigners.find((item) => item.id === id);
                    const address = formData.chain === "BTC"
                      ? signer?.public_key || "-"
                      : signer?.address || "-";
                    const deviceInfo = signer ? SOURCE_ICON_MAP[signer.device_type] : undefined;
                    return (
                      <div key={`summary-signer-${index}`} className="rounded-xl border border-[var(--border)] bg-[var(--row-head-bg)] px-3 py-2">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          {deviceInfo && <img src={deviceInfo.icon} alt={deviceInfo.label} className="w-4 h-4 object-contain" />}
                          <span>{signer?.name || t("walletModal.signerAddressPlaceholder")}</span>
                          {deviceInfo && <span className="text-xs text-[var(--muted)] font-normal">{deviceInfo.label}</span>}
                        </div>
                        <div className="text-xs text-[var(--muted)] font-mono break-all mt-1">{address}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              {createdWallet ? null : (
                <>
                  <Button variant="ghost" onClick={() => setCreateStep(2)} className="w-full justify-center sm:w-auto">
                    {t("common.back")}
                  </Button>
                  <Button variant="primary" onClick={handleCreate} disabled={creating} className="w-full justify-center sm:min-w-[128px] sm:w-auto">
                    {creating ? t("walletModal.creating") : t("common.create")}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Card>

      <Modal
        isOpen={importSignerSlot !== null}
        onClose={closeSignerImport}
        title={t("createWallet.addSignerAddress")}
        maxWidth="70rem"
        height="min(54rem, 92dvh)"
        showCloseButton
      >
        {importSignerSlot !== null && (
          <ImportSignatureAddressForm
            key={`wallet-signer-import-${importSignerSlot}-${formData.chain}-${selectedBtcNetworkName}-${btcScriptType}`}
            className="max-w-none"
            modalLayout
            initialChainOption={
              formData.chain === "EVM"
                ? "EVM"
                : btcNetworksAll.find((network) => network.id === formData.networkId)?.is_testnet
                ? "BTC_TESTNET"
                : "BTC_MAINNET"
            }
            initialBtcNetwork={selectedBtcNetworkName ?? undefined}
            initialBtcScriptType={btcScriptType}
            lockWalletContext
            completedSecondaryLabel={t("createWallet.continueConfiguring")}
            completedPrimaryLabel={t("createWallet.useThisSigner")}
            onCancel={closeSignerImport}
            onCompleted={useImportedSigner}
          />
        )}
      </Modal>
    </PageShell>
  );
};
