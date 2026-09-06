import React, { memo, useState } from "react";
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

// ---------------------------------------------------------------------------
// Row component (memoized)
// ---------------------------------------------------------------------------

interface WalletAssetRowProps {
  asset: Asset;
}

const WalletAssetRow = memo(function WalletAssetRow({
  asset,
}: WalletAssetRowProps) {
  const displayBalance = formatBalance(asset.balance, asset.decimals, 8);

  return (
    <TableRow>
      {/* Asset */}
      <TableCell>
        <span className="font-semibold">{asset.symbol}</span>
      </TableCell>

      {/* Balance */}
      <TableCell align="right">
        <span className="font-mono">{displayBalance}</span>
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
}) => {
  const { t } = useTranslation();
  const { showToast } = useToastStore();
  const navigate = useNavigate();

  const [showImportModal, setShowImportModal] = useState(false);
  const [tokenAddress, setTokenAddress] = useState("");
  const [importing, setImporting] = useState(false);

  const displayAssets = assets.slice(0, maxDisplay);
  const showViewAll = assets.length > maxDisplay;

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
          <h3 className="text-lg font-extrabold">{t("wallet.assets")}</h3>
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
                <TableHead className="w-[60%]">{t("common.asset")}</TableHead>
                <TableHead align="right" className="w-[40%]">{t("wallet.balance")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayAssets.map((asset) => (
                <WalletAssetRow
                  key={`${asset.id}-${asset.token_address || asset.symbol}`}
                  asset={asset}
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
