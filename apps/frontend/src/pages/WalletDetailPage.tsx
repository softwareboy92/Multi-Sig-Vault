import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Breadcrumb,
  Button,
  Card,
  CardSkeleton,
  ConfirmDialog,
  PageShell,
  Tabs,
} from "../components/ui";
import {
  DeployModal,
  NonceQueuePanel,
  PolicyTab,
  ReceiveModal,
  WalletAlertBanner,
  WalletAssetTable,
  WalletHeaderCard,
  WalletSignerTable,
  WalletTransactionTable,
} from "../components/wallet";
import { useTranslation } from "../hooks/useTranslation";
import { useWalletDetail } from "../hooks/useWalletDetail";
import { useDeployFlow } from "../hooks/useDeployFlow";
import { archiveWallet, activateWallet, deleteWallet } from "../api";
import { useToastStore } from "../stores/useToastStore";
import { getPendingActivation, removePendingOp } from "../hooks/usePendingOperation";
import { truncateAddress } from "../utils/address";
import { getErrorMessage } from "../utils/errorUtils";

export const WalletDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  // -- Data -----------------------------------------------------------------
  const {
    state,
    error,
    wallet,
    assets,
    transactions,
    chainLabel,
    evmNetworks,
    btcNetworks,
    reload,
    syncAssets,
    importToken,
    isSyncing,
    isEvmPendingDeploy,
    statusLabelMap,
    setWallet,
  } = useWalletDetail(id);

  // -- Network explorer URL & chain_id ---------------------------------------
  const networkExplorerUrl = useMemo(() => {
    if (!wallet?.network_id) return null;
    if (wallet.chain_type === "EVM") {
      return evmNetworks.get(wallet.network_id)?.explorer_url ?? null;
    }
    return btcNetworks.get(wallet.network_id)?.explorer_url ?? null;
  }, [wallet, evmNetworks, btcNetworks]);

  // -- Deploy flow ----------------------------------------------------------
  const deploy = useDeployFlow(wallet, id, evmNetworks, reload);

  // -- Toast ----------------------------------------------------------------
  const { showToast } = useToastStore();

  // -- Activation recovery --------------------------------------------------
  const [pendingActivation, setPendingActivation] = useState<{
    txHash: string;
    params: { address: string; salt: string; factory_address: string };
  } | null>(null);
  const [manualTxHash, setManualTxHash] = useState("");
  const [showManualActivate, setShowManualActivate] = useState(false);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    if (!id || !wallet || wallet.status !== "PENDING_DEPLOY") return;
    const pending = getPendingActivation(id);
    if (pending) {
      setPendingActivation({ txHash: pending.txHash, params: pending.params });
    }
  }, [id, wallet?.status]);

  const handleRecoverActivation = useCallback(async () => {
    if (!id || !pendingActivation) return;
    setActivating(true);
    try {
      await activateWallet(id, {
        address: pendingActivation.params.address,
        tx_hash: pendingActivation.txHash,
        salt: pendingActivation.params.salt,
        factory_address: pendingActivation.params.factory_address,
      });
      removePendingOp("activation", id);
      setPendingActivation(null);
      showToast(t("wallet.manualActivateSuccess"), "success");
      reload();
    } catch {
      removePendingOp("activation", id);
      setPendingActivation(null);
      reload();
    } finally {
      setActivating(false);
    }
  }, [id, pendingActivation, reload, showToast, t]);

  const handleManualActivate = useCallback(async () => {
    if (!id || !wallet || !manualTxHash.trim()) return;
    setActivating(true);
    try {
      const predicted = wallet.extra?.predicted_address;
      await activateWallet(id, {
        address: (predicted as string) || wallet.address || "",
        tx_hash: manualTxHash.trim(),
        salt: wallet.extra?.salt ? String(wallet.extra.salt) : undefined,
        factory_address: wallet.extra?.factory_address as string | undefined,
      });
      showToast(t("wallet.manualActivateSuccess"), "success");
      setShowManualActivate(false);
      reload();
    } catch (err) {
      showToast(getErrorMessage(err, t), "error");
    } finally {
      setActivating(false);
    }
  }, [id, wallet, manualTxHash, reload, showToast, t]);

  // -- Modals ---------------------------------------------------------------
  const [showReceiveModal, setShowReceiveModal] = useState(false);

  // -- Delete ---------------------------------------------------------------
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // -- Tab management -------------------------------------------------------
  const activeTab = searchParams.get("tab") || "assets";
  const setActiveTab = (tab: string) => {
    setSearchParams({ tab }, { replace: true });
  };

  // -- Handlers -------------------------------------------------------------
  const handleArchive = async () => {
    if (!wallet) return;
    try {
      await archiveWallet(wallet.id);
      showToast(t("wallet.walletArchived"), "success");
      await reload();
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const handleActivate = async () => {
    if (!wallet) return;
    try {
      await activateWallet(wallet.id);
      showToast(t("wallet.walletActivated"), "success");
      await reload();
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const handleDelete = async () => {
    if (!wallet) return;
    setDeleteLoading(true);
    try {
      await deleteWallet(wallet.id);
      showToast(t("wallet.walletDeleted"), "success");
      navigate("/wallet");
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setDeleteLoading(false);
      setDeleteDialogOpen(false);
    }
  };

  // -- Derived --------------------------------------------------------------
  const breadcrumbs = (
    <Breadcrumb
      items={[
        { label: t("nav.wallets"), href: "/wallet" },
        { label: wallet?.name ?? t("wallet.details") },
      ]}
    />
  );

  // -- Early returns --------------------------------------------------------
  if (state === "loading") {
    return (
      <PageShell title={t("wallet.details")} breadcrumbs={breadcrumbs}>
        <CardSkeleton count={3} />
      </PageShell>
    );
  }

  if (state === "error") {
    return (
      <PageShell title={t("wallet.details")} breadcrumbs={breadcrumbs}>
        <Card className="p-6 text-center space-y-4">
          <p className="text-[var(--muted)]">
            {t("wallet.loadFailed")}: {error}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button variant="secondary" onClick={() => navigate("/wallet")}>
              {t("common.back")}
            </Button>
            <Button variant="primary" onClick={reload}>
              {t("common.retry")}
            </Button>
          </div>
        </Card>
      </PageShell>
    );
  }

  if (state === "not-found" || !wallet) {
    return (
      <PageShell title={t("wallet.details")} breadcrumbs={breadcrumbs}>
        <Card className="p-6 text-center space-y-4">
          <p className="text-[var(--muted)]">{t("wallet.notFound")}</p>
          <Button variant="secondary" onClick={() => navigate("/wallet")}>
            {t("common.back")}
          </Button>
        </Card>
      </PageShell>
    );
  }

  // -- Ready state derived --------------------------------------------------
  const isBtcWallet = wallet.chain_type === "BTC";
  const belowThreshold = isBtcWallet
    ? (wallet.verified_signer_count ?? 0) < wallet.signer_count
    : (wallet.verified_signer_count ?? 0) < wallet.threshold;
  const sendDisabled =
    (!isEvmPendingDeploy && wallet.status !== "ACTIVE") ||
    (!isEvmPendingDeploy && belowThreshold);

  const tabItems = isEvmPendingDeploy
    ? [
        {
          key: "signers",
          label: t("wallet.tabSigners"),
          count: wallet.signer_count,
        },
      ]
    : [
        {
          key: "assets",
          label: t("wallet.tabAssets"),
          count: assets.length,
        },
        {
          key: "transactions",
          label: t("wallet.tabTransactions"),
          count: transactions.length,
        },
        {
          key: "signers",
          label: t("wallet.tabSigners"),
          count: wallet.signer_count,
        },
        ...(wallet.chain_type === "EVM" && wallet.status === "ACTIVE"
          ? [{ key: "policy", label: t("wallet.tabPolicy") }]
          : []),
      ];

  return (
    <PageShell title={wallet.name} breadcrumbs={breadcrumbs}>
      <div className="w-full space-y-5">
          <WalletHeaderCard
            wallet={wallet}
            walletId={id!}
            assets={assets}
            chainLabel={chainLabel}
            statusLabelMap={statusLabelMap}
            networkExplorerUrl={networkExplorerUrl}
            onRenamed={(updated) => setWallet(updated)}
            transactionCount={transactions.length}
            sendDisabled={sendDisabled}
            isPendingDeploy={isEvmPendingDeploy}
            onSend={() => navigate(`/wallet/${id}/send`)}
            onReceive={() => setShowReceiveModal(true)}
            onDeploy={deploy.open}
            onArchive={wallet.status === "ACTIVE" ? handleArchive : undefined}
            onActivate={wallet.status === "ARCHIVED" ? handleActivate : undefined}
            onDelete={() => setDeleteDialogOpen(true)}
          />

          {isEvmPendingDeploy && pendingActivation && (
            <Card className="space-y-3 border-[color-mix(in_srgb,var(--warning)_40%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_10%,var(--panel))] p-4">
              <p className="text-sm text-[var(--text)]">
                {t("wallet.recoverActivation", {
                  hash: truncateAddress(pendingActivation.txHash),
                })}
              </p>
              <Button
                variant="secondary"
                onClick={handleRecoverActivation}
                disabled={activating}
                className="w-full justify-center"
              >
                {activating ? "..." : t("wallet.recoverActivationAction")}
              </Button>
            </Card>
          )}

          {isEvmPendingDeploy && !pendingActivation && (
            <Card className="space-y-3 p-4">
              {!showManualActivate ? (
                <button
                  onClick={() => setShowManualActivate(true)}
                  className="text-sm font-medium text-[var(--accent)] underline underline-offset-4"
                >
                  {t("wallet.manualActivateLink")}
                </button>
              ) : (
                <div className="space-y-3">
                  <label className="block text-sm font-medium">
                    {t("wallet.manualActivateLabel")}
                  </label>
                  <input
                    type="text"
                    value={manualTxHash}
                    onChange={(e) => setManualTxHash(e.target.value)}
                    placeholder="0x..."
                    className="w-full rounded-[var(--field-radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  />
                  <Button
                    variant="primary"
                    onClick={handleManualActivate}
                    disabled={activating || !manualTxHash.trim()}
                    className="w-full justify-center"
                  >
                    {activating ? "..." : t("wallet.manualActivateSubmit")}
                  </Button>
                </div>
              )}
            </Card>
          )}
          <WalletAlertBanner
            wallet={wallet}
            isEvmPendingDeploy={isEvmPendingDeploy}
            belowThreshold={belowThreshold}
            onDeploy={deploy.open}
            onVerify={() => setActiveTab("signers")}
          />

          <div className="space-y-4">
            <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--panel)] px-4 pt-3 shadow-[var(--card-shadow)] sm:px-5">
              <Tabs
                items={tabItems}
                activeKey={activeTab}
                onChange={setActiveTab}
              />
            </div>

            <div className="space-y-4">
              {activeTab === "assets" && !isEvmPendingDeploy && (
                <WalletAssetTable
                  walletId={id!}
                  wallet={wallet}
                  assets={assets}
                  isSyncing={isSyncing}
                  onSync={syncAssets}
                  onImportToken={importToken}
                  maxDisplay={20}
                  chainId={wallet.chain_type === "EVM" ? evmNetworks.get(wallet.network_id)?.chain_id ?? null : null}
                />
              )}

              {activeTab === "transactions" && !isEvmPendingDeploy && (
                <>
                  {wallet.chain_type === "EVM" && wallet.status === "ACTIVE" && (
                    <NonceQueuePanel wallet={wallet} />
                  )}
                  <WalletTransactionTable
                    walletId={id!}
                    wallet={wallet}
                    transactions={transactions}
                    btcNetworks={btcNetworks}
                    networkExplorerUrl={networkExplorerUrl}
                    maxDisplay={20}
                  />
                </>
              )}

              {activeTab === "signers" && <WalletSignerTable wallet={wallet} />}

              {activeTab === "policy" &&
                wallet.chain_type === "EVM" &&
                wallet.status === "ACTIVE" && (
                  <PolicyTab
                    wallet={wallet}
                    transactions={transactions}
                    onRefresh={reload}
                  />
                )}
            </div>
          </div>
      </div>

      {/* Deploy Modal — EVM pending deploy only */}
      {isEvmPendingDeploy && (
        <DeployModal
          isOpen={deploy.isOpen}
          onClose={deploy.close}
          step={deploy.state.step}
          selectedDevice={deploy.state.device}
          onSelectDevice={deploy.setDevice}
          onConnect={deploy.connectAndPrepare}
          onBack={deploy.back}
          onDeploy={deploy.confirmDeploy}
          connecting={deploy.state.connecting}
          fetchingDeployment={deploy.state.fetching}
          sending={deploy.state.sending}
          confirming={deploy.state.confirming}
          connectedAddress={deploy.state.address}
          predictedAddress={deploy.state.deployment?.predicted_address}
          deploymentInfo={deploy.state.deployment}
          txHash={deploy.state.txHash}
          error={deploy.state.error}
          networkName={
            wallet?.network_id
              ? evmNetworks.get(wallet.network_id)?.name
              : undefined
          }
          walletSigners={wallet?.signers}
          walletThreshold={wallet?.threshold}
        />
      )}

      {/* Receive Modal */}
      <ReceiveModal
        isOpen={showReceiveModal}
        onClose={() => setShowReceiveModal(false)}
        wallet={wallet}
      />

      {/* Delete Dialog */}
      <ConfirmDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        title={t("wallet.deleteWalletTitle")}
        description={t("wallet.deleteWalletMessage")}
        confirmLabel={t("common.delete")}
        variant="danger"
        loading={deleteLoading}
      />
    </PageShell>
  );
};
