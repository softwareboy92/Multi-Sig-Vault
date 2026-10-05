import React, { memo, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui";
import { useTranslation } from "@/hooks/useTranslation";
import { useToastStore } from "@/stores/useToastStore";
import { isValidEvmAddress } from "@/utils/address";
import { formatBalance } from "@/utils/format";
import type { Asset, Wallet } from "@/types";
import { useAssetPrices } from "@/hooks/useAssetPrices";
import { atomicToNumber, formatUsd } from "@/utils/price";
import { formatAbsoluteTime } from "@/utils/time";
import { useTimezone } from "@/hooks/useTimezone";

// ---------------------------------------------------------------------------
// Row component (memoized)
// ---------------------------------------------------------------------------

interface WalletAssetRowProps {
  asset: Asset;
  price?: number;
  language: string;
}

const WalletAssetRow = memo(function WalletAssetRow({
  asset,
  price,
  language,
}: WalletAssetRowProps) {
  const displayBalance = formatBalance(asset.balance, asset.decimals, 8);
  const fiatValue = price == null ? null : atomicToNumber(asset.balance, asset.decimals) * price;

  return (
    <TableRow>
      {/* Asset */}
      <TableCell>
        <span className="font-semibold">{asset.symbol}</span>
      </TableCell>

      <TableCell align="right">
        <span className="font-mono tabular-nums">
          {price == null ? "—" : formatUsd(price, language)}
        </span>
      </TableCell>

      {/* Balance */}
      <TableCell align="right">
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-mono">{displayBalance} {asset.symbol}</span>
          <span className="text-xs tabular-nums text-[var(--muted)]">
            {fiatValue == null ? "—" : `≈ ${formatUsd(fiatValue, language)}`}
          </span>
        </div>
      </TableCell>

    </TableRow>
  );
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface WalletAssetTableProps {
  walletId: string;
  wallet: Wallet;
  assets: Asset[];
  isSyncing: boolean;
  onSync: () => void;
  onImportToken: (contractAddress: string) => Promise<void>;
  maxDisplay?: number;
  chainId?: number | null;
}

/**
 * Asset table for wallet detail page.
 * Asset balance table for the wallet detail page.
 */
export const WalletAssetTable: React.FC<WalletAssetTableProps> = ({
  walletId,
  wallet,
  assets,
  isSyncing,
  onSync,
  onImportToken,
  maxDisplay = 10,
  chainId = null,
}) => {
  const { t, language } = useTranslation();
  const timeZone = useTimezone();
  const { showToast } = useToastStore();
  const navigate = useNavigate();

  const [showImportModal, setShowImportModal] = useState(false);
  const [tokenAddress, setTokenAddress] = useState("");
  const [importing, setImporting] = useState(false);

  const displayAssets = assets.slice(0, maxDisplay);
  const showViewAll = assets.length > maxDisplay;
  const priceRequests = useMemo(() => assets.map((asset) => ({
    chain_type: wallet.chain_type,
    chain_id: chainId,
    token_address: asset.token_address,
    symbol: asset.symbol,
  })), [assets, wallet.chain_type, chainId]);
  const { prices, provider } = useAssetPrices(priceRequests);
  const assetSyncedAt = useMemo(() => {
    const timestamps = assets.map((asset) => asset.last_synced_at).filter((value): value is string => Boolean(value));
    return timestamps.sort().at(-1) ?? null;
  }, [assets]);
  const priceUpdatedAt = useMemo(() => {
    const timestamps = Object.values(prices).map((price) => price.updated_at).filter((value): value is string => Boolean(value));
    const latest = timestamps.sort().at(-1);
    if (!latest) return null;
    return /^\d+$/.test(latest) ? new Date(Number(latest) * 1000) : latest;
  }, [prices]);

  const handleImport = async () => {
    if (!tokenAddress.trim()) {
      showToast(t("wallet.tokenAddressRequired"), "error");
      return;
    }
    if (!isValidEvmAddress(tokenAddress)) {
      showToast(t("address.invalidEvmAddress"), "error");
      return;
    }
    setImporting(true);
    try {
      await onImportToken(tokenAddress);
      setTokenAddress("");
      setShowImportModal(false);
      showToast(t("wallet.tokenImported"), "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`${t("wallet.importFailed")}: ${message}`, "error");
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Card>
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4 min-h-[44px] gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-extrabold">{t("wallet.assets")}</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              {t("wallet.assetSyncedAt")}: {assetSyncedAt ? formatAbsoluteTime(assetSyncedAt, language, timeZone) : t("wallet.neverSynced")}
              {" · "}{t("wallet.priceUpdatedAt")}: {priceUpdatedAt ? formatAbsoluteTime(priceUpdatedAt, language, timeZone) : t("wallet.neverSynced")} ({provider === "defillama" ? "DeFiLlama" : provider === "gateio" ? "Gate.io" : provider === "coinmarketcap" ? "CoinMarketCap" : provider.toUpperCase()})
            </p>
          </div>
          <div className="flex items-center gap-3">
            {wallet.chain_type === "EVM" && (
              <Button
                variant="primary"
                onClick={() => setShowImportModal(true)}
                disabled={isSyncing}
              >
                {t("wallet.importToken")}
              </Button>
            )}
            {showViewAll && (
              <Button
                variant="ghost"
                onClick={() => navigate(`/wallet/${walletId}/assets`)}
              >
                {t("common.viewAll")}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={onSync}
              disabled={isSyncing}
              className="p-0 flex items-center justify-center border-transparent bg-transparent hover:bg-transparent rounded-none"
              aria-label={isSyncing ? t("wallet.syncing") : t("wallet.manualSync")}
              title={isSyncing ? t("wallet.syncing") : t("wallet.manualSync")}
            >
              <img
                src="/brand/icon_refe.svg"
                alt=""
                className={`w-5 h-5 refresh-icon ${isSyncing ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        </div>

        {/* Table */}
        {assets.length === 0 ? (
          <EmptyState title={t("common.noData")} />
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[34%]">{t("common.asset")}</TableHead>
                <TableHead align="right" className="w-[26%]">{t("wallet.unitPrice")}</TableHead>
                <TableHead align="right" className="w-[40%]">{t("wallet.balanceAndValue")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayAssets.map((asset) => (
                <WalletAssetRow
                  key={`${asset.id}-${asset.token_address || asset.symbol}`}
                  asset={asset}
                  price={prices[asset.symbol.toUpperCase()]?.usd}
                  language={language}
                />
              ))}
            </TableBody>
          </Table>
        )}

        {/* Footer view all (when table shown but items exceed max) */}
        {showViewAll && assets.length > 0 && (
          <div className="mt-4 text-center border-t border-[var(--border)] pt-4">
            <Button
              variant="ghost"
              className="text-sm"
              onClick={() => navigate(`/wallet/${walletId}/assets`)}
            >
              {t("common.viewAll")} ({assets.length})
            </Button>
          </div>
        )}
      </Card>

      {/* Import Token Modal */}
      <Modal
        isOpen={showImportModal}
        onClose={() => {
          if (!importing) {
            setShowImportModal(false);
            setTokenAddress("");
          }
        }}
        title={t("wallet.importToken")}
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm font-bold text-[var(--text)] mb-2 block">
              {t("wallet.tokenContractAddress")}
            </label>
            <Input
              placeholder={t("wallet.tokenContractPlaceholder")}
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
              disabled={importing}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              onClick={() => {
                setShowImportModal(false);
                setTokenAddress("");
              }}
              disabled={importing}
            >
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={handleImport} disabled={importing}>
              {importing ? t("wallet.importing") : t("common.add")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
