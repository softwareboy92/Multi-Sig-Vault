import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Breadcrumb,
  Button,
  Card,
  Input,
  PageShell,
  SelectMenu,
  Spinner,
} from "../components/ui";
import { UtxoPicker } from "../components/wallet/UtxoPicker";
import { FeeRateSelector } from "../components/wallet/FeeRateSelector";
import { useTranslation } from "../hooks/useTranslation";
import { usePendingStore } from "../stores/usePendingStore";
import { usePreferenceStore } from "../stores/usePreferenceStore";
import { useToastStore } from "../stores/useToastStore";
import {
  createTransaction,
  getAddressBook,
  getNetworks,
  getWallet,
  getWalletAssets,
} from "../api";
import { formatBalance } from "../utils/format";
import { validateAddress } from "../utils/address";
import { isZeroAddress } from "../utils/address";
import {
  validatePositiveAmount,
  validateAmountPrecision,
  validateAmountWithinBalance,
  validateBtcTotalSpend,
  validateBtcDustChange,
  validateNotSelfTransfer,
} from "../utils/validation";
import type { AddressBookEntry, Asset, Wallet, UtxoSelection } from "../types";

type PageState = "loading" | "error" | "not-found" | "ready";

export const SendTransactionPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id: walletId } = useParams<{ id: string }>();
  const { requestRefresh } = usePendingStore();
  const { addressBookOnlyTransfers } = usePreferenceStore();
  const { showToast } = useToastStore();

  // ── Page-level data ──────────────────────────────────────────────────
  const [pageState, setPageState] = useState<PageState>("loading");
  const [pageError, setPageError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [btcNetworks, setBtcNetworks] = useState<Map<string, string>>(new Map());
  const [addressBookEntries, setAddressBookEntries] = useState<AddressBookEntry[]>([]);
  const [addressBookLoading, setAddressBookLoading] = useState(false);
  const [addressBookError, setAddressBookError] = useState<string | null>(null);

  // ── Form state ───────────────────────────────────────────────────────
  const [sendToAddress, setSendToAddress] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendDescription, setSendDescription] = useState("");
  const [sendSelectedAssetId, setSendSelectedAssetId] = useState("");
  const [useMaxAmount, setUseMaxAmount] = useState(false);
  const [selectedAddressBookId, setSelectedAddressBookId] = useState("");
  const [addressDropdownOpen, setAddressDropdownOpen] = useState(false);
  const [selectedUtxos, setSelectedUtxos] = useState<UtxoSelection[]>([]);
  const [utxoAdvancedOpen, setUtxoAdvancedOpen] = useState(false);
  const [useAllInputs, setUseAllInputs] = useState(false);
  const [feeRate, setFeeRate] = useState(10);
  const [sendCreating, setSendCreating] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendAmountError, setSendAmountError] = useState<string | null>(null);
  const [sendWarning, setSendWarning] = useState<string | null>(null);
  const [warningConfirmed, setWarningConfirmed] = useState(false);

  // ── Derived ──────────────────────────────────────────────────────────
  const isBtc = wallet?.chain_type === "BTC";

  const selectedAsset = useMemo(
    () => assets.find((a) => a.id === sendSelectedAssetId) || null,
    [assets, sendSelectedAssetId],
  );

  const btcNetwork = useMemo(() => {
    if (!wallet || wallet.chain_type !== "BTC") return undefined;
    if (wallet.network_id) return btcNetworks.get(wallet.network_id);
    return wallet.address?.startsWith("tb") || wallet.address?.startsWith("2")
      ? "testnet"
      : "mainnet";
  }, [wallet, btcNetworks]);

  const btcM = wallet?.threshold ?? 2;
  const btcN = wallet?.signer_count ?? 3;

  const walletUtxos = useMemo(() => {
    if (!isBtc || !wallet?.extra?.utxos) return [];
    return wallet.extra.utxos;
  }, [isBtc, wallet]);

  const availableUtxos = useMemo(
    () => walletUtxos.filter((u) => !u.locked),
    [walletUtxos],
  );

  const selectedUtxoTotalSats = useMemo(() => {
    if (!isBtc || selectedUtxos.length === 0) return 0;
    const set = new Set(selectedUtxos.map((s) => `${s.txid}:${s.vout}`));
    return availableUtxos
      .filter((u) => set.has(`${u.txid}:${u.vout}`))
      .reduce((sum, u) => sum + u.value, 0);
  }, [isBtc, selectedUtxos, availableUtxos]);

  const estimateBtcFee = useMemo(() => {
    if (!isBtc || selectedUtxos.length === 0) return 0;
    // P2WSH multisig witness structure sizes (bytes)
    const witnessScriptLen = 1 + btcN * 34 + 2; // OP_M + N×pubkeys(33+push) + OP_N + OP_CHECKMULTISIG
    const witnessWeight = 1 + 1 + btcM * 73 + 1 + witnessScriptLen; // items-count + sigs(DER max 73) + script
    const vbPerInput = 41 + Math.ceil((witnessWeight + 3) / 4); // 41 = non-witness input overhead
    const outputVb = useMaxAmount ? 43 : 43 + 43; // 43 = P2WSH output size; no change output when send-max
    const vsize = 11 + selectedUtxos.length * vbPerInput + outputVb; // 11 = tx overhead (version+locktime+segwit)
    return vsize * feeRate;
  }, [isBtc, selectedUtxos.length, btcM, btcN, useMaxAmount, feeRate]);

  const sendMaxAmount = useMemo(() => {
    if (isBtc) {
      const maxSats = selectedUtxoTotalSats - estimateBtcFee;
      return maxSats > 0 ? formatBalance(String(maxSats), 8, 8) : "0";
    }
    if (!selectedAsset) return undefined;
    return formatBalance(selectedAsset.balance, selectedAsset.decimals, 8);
  }, [isBtc, selectedAsset, selectedUtxoTotalSats, estimateBtcFee]);

  // ── Data fetching ────────────────────────────────────────────────────
  const [loadKey, setLoadKey] = useState(0);
  const retryLoad = useCallback(() => {
    setPageState("loading");
    setPageError(null);
    setLoadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!walletId) {
      setPageState("not-found");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [w, a] = await Promise.all([
          getWallet(walletId),
          getWalletAssets(walletId),
        ]);
        if (cancelled) return;
        if (!w) {
          setPageState("not-found");
          return;
        }
        // Redirect non-active wallets (archived, pending deploy, etc.)
        if (w.status !== "ACTIVE") {
          navigate(`/wallet/${walletId}`, { replace: true });
          return;
        }
        setWallet(w);
        setAssets(a || []);
        // Default-select native asset
        const native = (a || []).find((x) => x.is_native);
        if (native) setSendSelectedAssetId(native.id);
        setPageState("ready");
      } catch (err) {
        if (cancelled) return;
        setPageError(err instanceof Error ? err.message : String(err));
        setPageState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [walletId, loadKey, navigate]);

  // Load BTC networks (for address validation)
  useEffect(() => {
    getNetworks("BTC")
      .then((list) => {
        const map = new Map<string, string>();
        (list || []).forEach((n) => map.set(n.id, n.btc_network ?? ""));
        setBtcNetworks(map);
      })
      .catch(() => setBtcNetworks(new Map()));
  }, []);

  // Load address book
  useEffect(() => {
    if (pageState !== "ready" || !wallet) return;
    let cancelled = false;
    setAddressBookLoading(true);
    setAddressBookError(null);
    getAddressBook({
      chain_type: wallet.chain_type,
      btc_network: wallet.chain_type === "BTC" ? btcNetwork : undefined,
    })
      .then((entries) => { if (!cancelled) setAddressBookEntries(entries || []); })
      .catch((err) => {
        if (!cancelled)
          setAddressBookError(
            err instanceof Error ? err.message : t("transactions.errorLoadAddressBook"),
          );
      })
      .finally(() => { if (!cancelled) setAddressBookLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- t is stable ref, exclude to avoid refetching on locale change
  }, [pageState, wallet, btcNetwork]);

  // Auto-fill amount when max toggled or UTXO selection changes
  useEffect(() => {
    if (!useMaxAmount || !sendMaxAmount) return;
    setSendAmount(sendMaxAmount);
    setSendAmountError(null);
  }, [useMaxAmount, sendMaxAmount]);

  // Default-select all available UTXOs (only on initial load)
  const hasUserTouchedUtxos = useRef(false);
  useEffect(() => {
    if (pageState !== "ready" || availableUtxos.length === 0) return;
    if (hasUserTouchedUtxos.current) return;
    setSelectedUtxos(availableUtxos.map((u) => ({ txid: u.txid, vout: u.vout })));
  }, [pageState, availableUtxos]);

  const handleUtxoChange = useCallback((utxos: UtxoSelection[]) => {
    hasUserTouchedUtxos.current = true;
    setSelectedUtxos(utxos);
  }, []);

  // Close address dropdown on outside click
  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addressDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAddressDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [addressDropdownOpen]);

  // ── Submit handler ───────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!wallet) return;
    const isSendMaxMode = isBtc && useMaxAmount;

    // 1. Wallet status
    if (wallet.status !== "ACTIVE") {
      setSendError(t("wallet.statusPendingDeploy"));
      return;
    }

    // 2. Trim address
    const toAddr = sendToAddress.trim();
    if (!toAddr) return;

    if (
      addressBookOnlyTransfers
      && !addressBookEntries.some(
        (entry) =>
          entry.id === selectedAddressBookId
          && entry.address.toLowerCase() === toAddr.toLowerCase(),
      )
    ) {
      setSendError(t("transactions.addressBookOnlyError"));
      return;
    }

    // 3. Address format
    const validation = validateAddress(
      wallet.chain_type,
      toAddr,
      wallet.chain_type === "BTC" ? btcNetwork : undefined,
    );
    if (!validation.valid && validation.errorKey) {
      setSendError(t(validation.errorKey));
      return;
    }

    // 4. EVM zero address warning
    if (wallet.chain_type === "EVM" && isZeroAddress(toAddr)) {
      if (!warningConfirmed) {
        setSendWarning(t("transactions.zeroAddressWarning"));
        setWarningConfirmed(true);
        return;
      }
    }

    // 5. Self-transfer warning
    const selfErr = validateNotSelfTransfer(toAddr, wallet.address);
    if (selfErr && !warningConfirmed) {
      setSendWarning(t(selfErr));
      setWarningConfirmed(true);
      return;
    }

    // 6. EVM: token must be selected
    if (!isBtc && !sendSelectedAssetId) {
      setSendError(t("transactions.tokenRequired"));
      return;
    }

    // 7-9. Amount validation (skip for send-max)
    if (!isSendMaxMode) {
      const posErr = validatePositiveAmount(sendAmount);
      if (posErr) {
        setSendAmountError(t(posErr));
        return;
      }

      const decimals = isBtc ? 8 : (selectedAsset?.decimals ?? 18);
      const precErr = validateAmountPrecision(sendAmount, decimals);
      if (precErr) {
        setSendAmountError(t(precErr, { decimals: String(decimals) }));
        return;
      }

      if (sendMaxAmount) {
        const balErr = validateAmountWithinBalance(sendAmount, sendMaxAmount);
        if (balErr) {
          setSendAmountError(t(balErr, { max: sendMaxAmount }));
          return;
        }
      }
    }

    // 10. BTC: UTXO selection
    if (isBtc && selectedUtxos.length === 0) {
      setSendError(t("transactions.utxoNoneSelected"));
      return;
    }

    // 11. BTC: amount + fee <= inputs
    if (isBtc && !isSendMaxMode) {
      const amountSats = Math.round(Number.parseFloat(sendAmount) * 1e8);
      const totalErr = validateBtcTotalSpend(amountSats, estimateBtcFee, selectedUtxoTotalSats);
      if (totalErr) {
        setSendAmountError(
          t(totalErr, {
            total: String(amountSats + estimateBtcFee),
            available: String(selectedUtxoTotalSats),
          }),
        );
        return;
      }

      // 12. BTC: dust change warning
      const dustWarn = validateBtcDustChange(selectedUtxoTotalSats, amountSats, estimateBtcFee);
      if (dustWarn && !warningConfirmed) {
        const change = selectedUtxoTotalSats - amountSats - estimateBtcFee;
        setSendWarning(t(dustWarn, { change: String(change) }));
        setWarningConfirmed(true);
        return;
      }
    }

    const tokenAddress =
      selectedAsset && !selectedAsset.is_native
        ? selectedAsset.token_address || undefined
        : undefined;

    setSendCreating(true);
    try {
      const isSendMax = isBtc && useMaxAmount;
      const tx = await createTransaction(wallet.id, {
        to_address: toAddr,
        amount: isSendMax ? "0" : sendAmount,
        token_address: tokenAddress,
        description: sendDescription || undefined,
        fee_rate: isBtc ? feeRate : undefined,
        selected_utxos:
          isBtc && selectedUtxos.length > 0 && selectedUtxos.length < availableUtxos.length
            ? selectedUtxos
            : undefined,
        use_all_inputs: isBtc ? useAllInputs : undefined,
        send_max: isSendMax || undefined,
      });
      setSendError(null);
      requestRefresh();
      showToast(t("transactions.created"), "success");
      navigate(`/transactions/${tx.id}`);
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : t("transactions.errorCreate"),
      );
    } finally {
      setSendCreating(false);
    }
  };

  // ── Shared breadcrumb for non-ready states ──────────────────────────
  const fallbackBreadcrumbs = (
    <Breadcrumb
      items={[
        { label: t("nav.wallets"), href: "/wallet" },
        { label: t("transactions.createTitle") },
      ]}
    />
  );

  // ── Render: loading / error / not-found ──────────────────────────────
  if (pageState === "loading") {
    return (
      <PageShell title={t("transactions.createTitle")} breadcrumbs={fallbackBreadcrumbs}>
        <div className="flex items-center justify-center h-60">
          <Spinner size="lg" />
        </div>
      </PageShell>
    );
  }

  if (pageState === "not-found") {
    return (
      <PageShell title={t("transactions.createTitle")} breadcrumbs={fallbackBreadcrumbs}>
        <Card>
          <div className="p-6 text-center space-y-4">
            <div className="text-[var(--muted)]">{t("common.notFound")}</div>
            <Button variant="ghost" onClick={() => navigate("/wallet")}>
              {t("common.back")}
            </Button>
          </div>
        </Card>
      </PageShell>
    );
  }

  if (pageState === "error") {
    return (
      <PageShell title={t("transactions.createTitle")} breadcrumbs={fallbackBreadcrumbs}>
        <Card>
          <div className="p-6 text-center space-y-4">
            <div className="text-[var(--danger)]">
              {pageError || t("common.error")}
            </div>
            <div className="flex items-center justify-center gap-3">
              <Button variant="ghost" onClick={() => navigate("/wallet")}>
                {t("common.back")}
              </Button>
              <Button variant="primary" onClick={retryLoad}>
                {t("common.retry")}
              </Button>
            </div>
          </div>
        </Card>
      </PageShell>
    );
  }

  // ── Render: ready ────────────────────────────────────────────────────
  return (
    <PageShell
      title={t("transactions.createTitle")}
      breadcrumbs={
        <Breadcrumb
          items={[
            { label: t("nav.wallets"), href: "/wallet" },
            { label: wallet?.name || "...", href: `/wallet/${walletId}` },
            { label: t("transactions.createTitle") },
          ]}
        />
      }
    >
      <Card className="mx-auto w-full max-w-[760px]">
        <form
          className="space-y-5 p-1 sm:p-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleCreate();
          }}
        >
          {/* ── Token selector (EVM) ─────────────────────────────── */}
          {!isBtc && assets.length > 0 && (
            <div className="flex flex-col gap-2">
              <label className="field-label">
                <span className="text-[var(--danger)]">*</span>{" "}
                {t("transactions.selectToken")}
              </label>
              <SelectMenu
                value={sendSelectedAssetId}
                onChange={setSendSelectedAssetId}
                options={[
                  {
                    value: "",
                    label: t("transactions.selectTokenPlaceholder"),
                  },
                  ...assets.map((asset) => {
                    return {
                      value: asset.id,
                      label: `${asset.symbol} (${formatBalance(asset.balance, asset.decimals)})`,
                    };
                  }),
                ]}
              />
            </div>
          )}

          {/* ── Recipient ────────────────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <label className="field-label">
              <span className="text-[var(--danger)]">*</span>{" "}
              {t("transactions.recipient")}
            </label>
            {addressBookError && (
              <div className="text-xs text-[var(--danger)]">
                {addressBookError}
              </div>
            )}
            <div className="relative" ref={dropdownRef}>
              <Input
                placeholder={
                  addressBookOnlyTransfers
                    ? t("transactions.addressBookOnlyPlaceholder")
                    : t("transactions.recipientPlaceholder")
                }
                value={sendToAddress}
                readOnly={addressBookOnlyTransfers}
                aria-readonly={addressBookOnlyTransfers}
                onClick={() => {
                  if (addressBookOnlyTransfers) setAddressDropdownOpen(true);
                }}
                onChange={(e) => {
                  setSendToAddress(e.target.value);
                  if (selectedAddressBookId) setSelectedAddressBookId("");
                  if (sendError) setSendError(null);
                  if (sendWarning) { setSendWarning(null); setWarningConfirmed(false); }
                }}
                className={`pr-12 ${
                  addressBookOnlyTransfers ? "cursor-pointer bg-[var(--row-head-bg)]" : ""
                }`}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center hover:bg-[var(--row-head-bg)] transition-colors"
                onClick={() => setAddressDropdownOpen((prev) => !prev)}
                aria-label={t("transactions.recipientAddressBook")}
                aria-expanded={addressDropdownOpen}
                aria-haspopup="listbox"
                title={t("transactions.recipientAddressBook")}
                disabled={addressBookLoading}
              >
                <img
                  src={`${import.meta.env.BASE_URL}brand/icon_address.png`}
                  alt=""
                  className="w-4 h-4 object-contain"
                  aria-hidden="true"
                />
              </button>
              {addressDropdownOpen && (
                <div className="overlay-surface absolute z-50 mt-2 w-full max-h-56 overflow-x-hidden overflow-y-auto rounded-xl border border-[var(--border)] shadow-[var(--shadow-overlay)] custom-scrollbar">
                  {addressBookLoading ? (
                    <div className="px-3 py-2 text-sm text-[var(--muted)]">
                      {t("common.loading")}
                    </div>
                  ) : addressBookEntries.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-3 py-4 text-center">
                      <span className="text-sm text-[var(--muted)]">
                        {t("common.noData")}
                      </span>
                      <button
                        type="button"
                        className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
                        onClick={() => {
                          const params = new URLSearchParams({
                            add: "1",
                            chain: wallet?.chain_type || "EVM",
                          });
                          if (wallet?.chain_type === "BTC" && btcNetwork) {
                            params.set("btc_network", btcNetwork);
                          }
                          setAddressDropdownOpen(false);
                          navigate(`/address?${params.toString()}`);
                        }}
                      >
                        {t("transactions.quickAddAddress")}
                      </button>
                    </div>
                  ) : (
                    addressBookEntries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className="block w-full min-w-0 overflow-hidden px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--row-head-bg)]"
                        onClick={() => {
                          setSelectedAddressBookId(entry.id);
                          setSendToAddress(entry.address);
                          setAddressDropdownOpen(false);
                        }}
                      >
                        <div className="truncate font-semibold text-[var(--text)]">
                          {entry.name}
                        </div>
                        <div
                          className="block w-full truncate font-mono text-xs text-[var(--muted)]"
                          title={entry.address}
                        >
                          {entry.address}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {addressBookOnlyTransfers && (
              <div className="text-xs text-[var(--muted)]">
                {t("transactions.addressBookOnlyHint")}
              </div>
            )}
          </div>

          {/* ── Amount ───────────────────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="field-label">
                <span className="text-[var(--danger)]">*</span>{" "}
                {t("transactions.amountLabel")}
              </label>
              {isBtc ? (
                <label className="inline-flex items-center gap-2 text-sm text-[var(--muted)]">
                  <input
                    type="checkbox"
                    checked={useMaxAmount}
                    onChange={(e) => setUseMaxAmount(e.target.checked)}
                  />
                  {t("transactions.sendMax")}
                  {sendMaxAmount && sendMaxAmount !== "0" ? (
                    <span className="text-[var(--text)] font-semibold">
                      ≈ {sendMaxAmount} BTC
                    </span>
                  ) : null}
                </label>
              ) : (
                <label className="inline-flex items-center gap-2 text-sm text-[var(--muted)]">
                  <input
                    type="checkbox"
                    checked={useMaxAmount}
                    onChange={(e) => setUseMaxAmount(e.target.checked)}
                  />
                  {t("transactions.maxAvailable")}
                  {sendMaxAmount && selectedAsset ? (
                    <span className="text-[var(--text)] font-semibold">
                      {sendMaxAmount} {selectedAsset.symbol}
                    </span>
                  ) : null}
                </label>
              )}
            </div>
            <Input
              type="text"
              inputMode="decimal"
              pattern="[0-9.]*"
              onWheel={(e) => (e.target as HTMLElement).blur()}
              placeholder={t("transactions.amountPlaceholder")}
              value={isBtc && useMaxAmount ? (sendMaxAmount ?? "") : sendAmount}
              onChange={(e) => {
                const raw = e.target.value;
                // Reject characters that aren't digits or dots
                if (raw && !/^[0-9.]*$/.test(raw)) return;
                if (!sendMaxAmount) {
                  setSendAmount(raw);
                  setSendAmountError(null);
                  return;
                }
                const next = Number.parseFloat(raw);
                const limit = Number.parseFloat(sendMaxAmount);
                if (!Number.isFinite(next) || !Number.isFinite(limit)) {
                  setSendAmount(raw);
                  setSendAmountError(null);
                  return;
                }
                if (next > limit) {
                  setSendAmount(sendMaxAmount);
                  setSendAmountError(
                    t("transactions.amountExceeded", { amount: sendMaxAmount }),
                  );
                  return;
                }
                setSendAmount(raw);
                setSendAmountError(null);
              }}
              disabled={isBtc && useMaxAmount}
            />
            {sendAmountError && (
              <div className="text-xs text-[var(--danger)]">
                {sendAmountError}
              </div>
            )}
          </div>

          {/* ── UTXO / Fee Rate (BTC) ────────────────────────────── */}
          {isBtc && (
            <>
              <FeeRateSelector value={feeRate} onChange={setFeeRate} />
              <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--row-head-bg)]"
                  onClick={() => setUtxoAdvancedOpen((open) => !open)}
                  aria-expanded={utxoAdvancedOpen}
                  aria-controls="btc-utxo-advanced-options"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-[var(--text)]">
                      {t("transactions.advancedOptions")}
                    </span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {t("transactions.utxoAdvancedHint")}
                    </span>
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                    className={`h-4 w-4 shrink-0 text-[var(--muted)] transition-transform ${
                      utxoAdvancedOpen ? "rotate-180" : ""
                    }`}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {utxoAdvancedOpen && (
                  <div
                    id="btc-utxo-advanced-options"
                    className="border-t border-[var(--border)] p-3"
                  >
                    <UtxoPicker
                      utxos={availableUtxos}
                      selected={selectedUtxos}
                      onChange={handleUtxoChange}
                      lockedCount={walletUtxos.length - availableUtxos.length}
                      extra={
                        <label className="inline-flex items-center gap-2 text-sm text-[var(--muted)]">
                          <input
                            type="checkbox"
                            checked={useAllInputs}
                            onChange={(e) => setUseAllInputs(e.target.checked)}
                          />
                          {t("transactions.useAllInputs")}
                        </label>
                      }
                    />
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── BTC fee estimate ─────────────────────────────────── */}
          {isBtc && selectedUtxos.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-[var(--muted)]">{t("transactions.feeEstimate")}:</span>
                <span className="font-semibold">{estimateBtcFee} sats</span>
                <span className="text-[var(--muted)]">
                  ({formatBalance(String(estimateBtcFee), 8, 8)} BTC · {feeRate} sat/vB)
                </span>
              </div>
              {estimateBtcFee >= selectedUtxoTotalSats && (
                <div className="text-xs text-[var(--danger)]">
                  {t("transactions.feeExceedsBalance", {
                    fee: String(estimateBtcFee),
                    available: String(selectedUtxoTotalSats),
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Description ──────────────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <label className="field-label">
              {t("transactions.description")}
            </label>
            <textarea
              className="field-control textarea-control resize-none"
              placeholder={t("transactions.descriptionPlaceholder")}
              maxLength={500}
              value={sendDescription}
              onChange={(e) => setSendDescription(e.target.value)}
            />
          </div>

          {/* ── Warning ──────────────────────────────────────────── */}
          {sendWarning && (
            <div className="text-xs text-[var(--warning)]">{sendWarning}</div>
          )}

          {/* ── Error ────────────────────────────────────────────── */}
          {sendError && (
            <div className="text-xs text-[var(--danger)]">{sendError}</div>
          )}

          {/* ── Action bar ───────────────────────────────────────── */}
          <div className="flex flex-col-reverse gap-3 border-t border-[var(--border)] pt-5 sm:flex-row sm:items-center sm:justify-end">
            <Button variant="ghost" onClick={() => navigate(-1)} className="w-full justify-center sm:w-auto">
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="w-full justify-center sm:min-w-[144px] sm:w-auto"
              disabled={
                sendCreating ||
                !wallet ||
                wallet.status !== "ACTIVE" ||
                !sendToAddress ||
                (!isBtc && !sendSelectedAssetId) ||
                (!(isBtc && useMaxAmount) && !sendAmount) ||
                !!sendAmountError ||
                (isBtc && estimateBtcFee >= selectedUtxoTotalSats && selectedUtxos.length > 0)
              }
            >
              {sendCreating
                ? t("transactions.creating")
                : t("transactions.createTitle")}
            </Button>
          </div>
        </form>
      </Card>
    </PageShell>
  );
};
