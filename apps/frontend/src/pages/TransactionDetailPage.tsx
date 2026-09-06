import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Breadcrumb,
  Button,
  Card,
  CardSkeleton,
  PageShell,
} from "../components/ui";
import {
  TransactionSummaryCard,
  TransactionActionBar,
  TransactionDetailsCard,
  UtxoDetailsPanel,
  DeviceSelectModal,
  CancelTransactionModal,
  SigningProgressModal,
  ExecutionProgressModal,
} from "../components/Transaction";
import { useTransactionDetail } from "../hooks/useTransactionDetail";
import { useTransactionActions } from "../hooks/useTransactionActions";
import { useTranslation } from "../hooks/useTranslation";
import { truncateAddress } from "../utils/address";
import { CopyButton } from "../components/ui/CopyButton";
import { SimulationSection } from "../components/Transaction/SimulationSection";
import { useSimulation } from "../hooks/useSimulation";
import { getPolicyActionLabel } from "../utils/policy";

export const TransactionDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const {
    state,
    error: detailError,
    transaction,
    wallet,
    btcDecodedTx,
    btcNetwork,
    networkExplorerUrl,
    evmChainId,
    statusConfig,
    signedSignerIds,
    broadcastCheckLoading,
    silentReload,
    setTransaction,
  } = useTransactionDetail(id);

  const actions = useTransactionActions(
    transaction,
    wallet,
    id,
    setTransaction,
    silentReload,
  );

  const { state: simState, simulation, error: simError, simulate } = useSimulation(
    id,
    wallet?.chain_type,
  );

  const breadcrumbs = (
    <Breadcrumb
      items={[
        { label: t("transactions.breadcrumbTransactions"), href: "/transactions" },
        { label: t("transactions.breadcrumbDetails") },
      ]}
    />
  );

  // --- Loading ---
  if (state === "loading") {
    return (
      <PageShell
        title={t("transactions.detailTitle")}
        breadcrumbs={breadcrumbs}
      >
        <CardSkeleton count={3} />
      </PageShell>
    );
  }

  // --- Error / Not Found ---
  if (state === "error" || !transaction || !wallet) {
    return (
      <PageShell
        title={t("transactions.detailTitle")}
        breadcrumbs={breadcrumbs}
      >
        <Card className="p-6">
          <div className="text-center py-8">
            <p className="text-[var(--danger)] mb-4">
              {detailError || t("transactions.notFound")}
            </p>
            <Button onClick={() => navigate("/wallet")}>
              {t("common.back")}
            </Button>
          </div>
        </Card>
      </PageShell>
    );
  }

  // --- Derived values ---
  const error = detailError || actions.error;
  const showActions =
    transaction.direction !== "INCOMING" &&
    ["PENDING_SIGN", "PARTIALLY_SIGNED", "SIGNED"].includes(
      transaction.status,
    );
  const canSign =
    (transaction.status === "PENDING_SIGN" ||
      transaction.status === "PARTIALLY_SIGNED") &&
    transaction.signature_count < transaction.threshold;
  const canExecute =
    transaction.status === "SIGNED" &&
    transaction.can_broadcast !== false;
  const canCancel = ["PENDING_SIGN", "PARTIALLY_SIGNED", "SIGNED"].includes(
    transaction.status,
  );
  const signingSigner =
    wallet.signers.find((signer) => signer.id === actions.signingSignerId) || null;

  // --- Ready ---
  // Layout wraps pages in a flex-1 + overflow-auto container.
  // We use h-full so this page fills that container exactly, then give
  // the card area its own overflow-auto so ActionBar stays pinned at the
  // browser viewport bottom — like a bottom drawer.
  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumbs — not scrollable */}
      <div className="shrink-0 text-sm text-[var(--muted)] mb-4">{breadcrumbs}</div>

      {/* Mobile: keep the primary signing controls inside the first viewport. */}
      {showActions && (
        <div className="mb-3 shrink-0 lg:hidden">
          <TransactionActionBar
            transaction={transaction}
            wallet={wallet}
            signedSignerIds={signedSignerIds}
            actionLoading={actions.actionLoading}
            broadcastCheckLoading={broadcastCheckLoading}
            canSign={canSign}
            canExecute={canExecute}
            canCancel={canCancel}
            signingSignerId={actions.signingSignerId}
            onSignerSign={actions.signWithSigner}
            onExecute={actions.handleExecute}
            onCancel={actions.handleCancelClick}
          />
        </div>
      )}

      {/* Scrollable card area */}
      <div className="flex-1 min-h-0 overflow-auto space-y-4 pb-2">
        {error && (
          <Card className="bg-[var(--danger)]/10 border-[var(--danger)]">
            <p className="text-[var(--danger)] text-sm">{error}</p>
          </Card>
        )}

        {/* Recovery banners */}
        {actions.pendingSignatureData && !actions.actionLoading && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {t("transactions.recoverSignature")}
            </p>
            <button
              onClick={actions.retrySubmitSignature}
              className="mt-2 text-sm font-medium text-amber-700 underline hover:text-amber-900 dark:text-amber-300"
            >
              {t("transactions.recoverSignatureAction")}
            </button>
          </div>
        )}
        {actions.broadcastTxHash && !actions.actionLoading && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {t("transactions.recoverBroadcast", {
                hash: truncateAddress(actions.broadcastTxHash),
              })}
            </p>
            <button
              onClick={actions.retryBroadcast}
              className="mt-2 text-sm font-medium text-amber-700 underline hover:text-amber-900 dark:text-amber-300"
            >
              {t("transactions.recoverBroadcastAction")}
            </button>
          </div>
        )}

        <TransactionSummaryCard
          transaction={transaction}
          wallet={wallet}
          statusConfig={statusConfig}
          evmChainId={evmChainId}
        />

        {/* Policy change detail card */}
        {transaction.tx_type === "SAFE_POLICY_CHANGE" && transaction.extra && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-extrabold text-[var(--text)]">
                {t("transactions.policyChangeTransaction")}
              </h3>
              <Badge variant="info">
                {getPolicyActionLabel(transaction.extra.policy_action as string, t)}
              </Badge>
            </div>
            <div className="space-y-2 text-sm">
              {transaction.extra.new_owner && (
                <div className="flex items-center gap-2">
                  <span className="text-[var(--muted)]">{t("wallet.policyNewOwnerAddress")}:</span>
                  <span className="font-mono text-xs" title={String(transaction.extra.new_owner)}>
                    {truncateAddress(String(transaction.extra.new_owner))}
                  </span>
                  <CopyButton value={String(transaction.extra.new_owner)} />
                </div>
              )}
              {transaction.extra.removed_owner && (
                <div className="flex items-center gap-2">
                  <span className="text-[var(--muted)]">{t("wallet.policyRemoveOwner")}:</span>
                  <span className="font-mono text-xs" title={String(transaction.extra.removed_owner)}>
                    {truncateAddress(String(transaction.extra.removed_owner))}
                  </span>
                  <CopyButton value={String(transaction.extra.removed_owner)} />
                </div>
              )}
              {(transaction.extra.old_threshold != null || transaction.extra.new_threshold != null) && (
                <div className="flex items-center gap-2">
                  <span className="text-[var(--muted)]">{t("wallet.policyThresholdChange")}:</span>
                  <span>
                    {transaction.extra.old_threshold ?? "?"} → {transaction.extra.new_threshold ?? "?"}
                  </span>
                </div>
              )}
            </div>
          </Card>
        )}

        <TransactionDetailsCard
          transaction={transaction}
          wallet={wallet}
          networkExplorerUrl={networkExplorerUrl}
          btcNetwork={btcNetwork}
          showActions={showActions}
        />

        {/* Simulation (EVM only, actionable statuses only) */}
        {wallet.chain_type === "EVM" && showActions && (
          <SimulationSection
            state={simState}
            simulation={simulation}
            error={simError}
            walletAddress={wallet.address!}
            onSimulate={simulate}
          />
        )}

        {btcDecodedTx && <UtxoDetailsPanel decodedTx={btcDecodedTx} />}
      </div>

      {/* ActionBar — pinned at bottom, outside scroll container */}
      {showActions && (
        <div className="hidden shrink-0 lg:block">
          <TransactionActionBar
            transaction={transaction}
            wallet={wallet}
            signedSignerIds={signedSignerIds}
            actionLoading={actions.actionLoading}
            broadcastCheckLoading={broadcastCheckLoading}
            canSign={canSign}
            canExecute={canExecute}
            canCancel={canCancel}
            signingSignerId={actions.signingSignerId}
            onSignerSign={actions.signWithSigner}
            onExecute={actions.handleExecute}
            onCancel={actions.handleCancelClick}
          />
        </div>
      )}

      {/* Modals */}
      <SigningProgressModal signer={signingSigner} />
      <ExecutionProgressModal deviceType={actions.executingDeviceType} />
      {showActions && (
        <>
          <DeviceSelectModal
            isOpen={actions.showExecuteModal}
            onClose={() => actions.setShowExecuteModal(false)}
            onSelect={actions.executeWithDevice}
          />
          <CancelTransactionModal
            isOpen={actions.showCancelModal}
            onClose={() => actions.setShowCancelModal(false)}
            transaction={transaction}
            wallet={wallet}
            cancelOptions={actions.cancelOptions}
            cancelReason={actions.cancelReason}
            onCancelReasonChange={actions.setCancelReason}
            onConfirm={actions.handleCancelConfirm}
            loading={actions.actionLoading}
          />
        </>
      )}
    </div>
  );
};
