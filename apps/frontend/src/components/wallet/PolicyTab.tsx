import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSafeInfo, syncWalletPolicy } from "@/api/wallets";
import { useTranslation } from "@/hooks/useTranslation";
import { truncateAddress } from "@/utils/address";
import { SOURCE_ICON_MAP } from "@/utils/signer";
import type { Transaction } from "@/types/transaction";
import type { Wallet } from "@/types/wallet";
import { TX_STATUS_VARIANT } from "@/utils/status-variants";
import { Badge, Button, Card } from "../ui";
import { AddOwnerModal } from "./AddOwnerModal";
import { ChangeThresholdModal } from "./ChangeThresholdModal";
import { RemoveOwnerModal } from "./RemoveOwnerModal";
import { SwapOwnerModal } from "./SwapOwnerModal";

interface PolicyTabProps {
  wallet: Wallet;
  transactions: Transaction[];
  onRefresh: () => void;
}

const POLICY_ACTION_LABELS: Record<string, string> = {
  add_owner: "policyActionAddOwner",
  remove_owner: "policyActionRemoveOwner",
  swap_owner: "policyActionSwapOwner",
  change_threshold: "policyActionChangeThreshold",
};

/** Infer action from extra fields when policy_action is absent. */
function inferPolicyAction(
  extra: Record<string, unknown>,
): string | undefined {
  if (extra.new_owner && extra.removed_owner) return "swap_owner";
  if (extra.new_owner) return "add_owner";
  if (extra.removed_owner) return "remove_owner";
  if (extra.new_threshold != null) return "change_threshold";
  return undefined;
}

export const PolicyTab: React.FC<PolicyTabProps> = ({
  wallet,
  transactions,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [addOwnerOpen, setAddOwnerOpen] = useState(false);
  const [changeThresholdOpen, setChangeThresholdOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [swapTarget, setSwapTarget] = useState<string | null>(null);
  const [chainDrift, setChainDrift] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Filter policy change transactions
  const policyTxs = transactions.filter(
    (tx) => tx.tx_type === "SAFE_POLICY_CHANGE"
  );

  const statusLabelMap: Record<string, string> = {
    PENDING_SIGN: t("transactions.statusPendingSign"),
    PARTIALLY_SIGNED: t("transactions.statusPartiallySigned"),
    SIGNED: t("transactions.statusSigned"),
    BROADCAST: t("transactions.statusBroadcast"),
    PENDING_CONFIRMATION: t("transactions.statusPendingConfirmation"),
    CONFIRMED: t("transactions.statusConfirmed"),
    FAILED: t("transactions.statusFailed"),
    CANCELLED: t("transactions.statusCancelled"),
  };

  // Check for chain drift on mount
  useEffect(() => {
    let cancelled = false;
    async function checkDrift() {
      try {
        const info = await getSafeInfo(wallet.address!, wallet.network_id);
        if (cancelled) return;
        const chainOwners = info.owners
          .map((o: string) => o.toLowerCase())
          .sort();
        const localOwners = wallet.signers
          .map((s) => s.address?.toLowerCase())
          .filter(Boolean)
          .sort();
        const drifted =
          info.threshold !== wallet.threshold ||
          JSON.stringify(chainOwners) !== JSON.stringify(localOwners);
        setChainDrift(drifted);
      } catch {
        // Ignore — best effort check
      }
    }
    if (wallet.address) checkDrift();
    return () => {
      cancelled = true;
    };
  }, [wallet.id, wallet.threshold, wallet.signer_count]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncWalletPolicy(wallet.id);
      onRefresh();
      setChainDrift(false);
    } catch {
      // Sync failed — keep drift warning visible
    } finally {
      setSyncing(false);
    }
  };

  const owners = wallet.signers || [];

  return (
    <div className="space-y-6">
      {/* Drift Warning */}
      {chainDrift && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
          <svg
            className="h-5 w-5 text-yellow-500 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <span className="flex-1 text-sm text-[var(--text)]">
            {t("wallet.policyDriftWarning")}
          </span>
          <Button
            variant="secondary"
            onClick={handleSync}
            disabled={syncing}
          >
            {t("wallet.policySyncFromChain")}
          </Button>
        </div>
      )}

      {/* Threshold Section */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-[var(--text)]">
            {t("wallet.policyCurrentThreshold")}
          </h3>
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-sm"
            onClick={() => setChangeThresholdOpen(true)}
            disabled={owners.length <= 1}
          >
            {t("wallet.policyChangeThreshold")}
          </Button>
        </div>
        <span className="text-xl font-bold text-[var(--text)]">
          {wallet.threshold} / {wallet.signer_count}
        </span>
      </Card>

      {/* Owners Section */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-[var(--text)]">
            {t("wallet.policyOwners")}
          </h3>
          <Button
            variant="primary"
            className="px-3 py-1.5 text-sm"
            onClick={() => setAddOwnerOpen(true)}
          >
            {t("wallet.policyAddShort")}
          </Button>
        </div>
        <div className="space-y-2">
          {owners.map((signer, idx) => {
            const iconInfo = SOURCE_ICON_MAP[signer.device_type];
            return (
              <div
                key={signer.id ?? signer.address}
                className="group flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {iconInfo ? (
                    <img src={iconInfo.icon} alt={iconInfo.label} className="w-5 h-5 object-contain shrink-0" />
                  ) : (
                    <span className="w-5 h-5 rounded-md bg-[var(--row-head-bg)] border border-[var(--border)] flex items-center justify-center text-xs text-[var(--muted)] shrink-0">?</span>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text)]">
                      #{idx + 1} {signer.name || "Unknown Signer"}
                    </div>
                    <div className="text-xs text-[var(--muted)] font-mono">
                      {truncateAddress(signer.address || signer.public_key || "")}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="secondary"
                    className="px-3 py-1 text-xs"
                    onClick={() => setSwapTarget(signer.address ?? "")}
                  >
                    {t("wallet.policySwapShort")}
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-3 py-1 text-xs text-[var(--danger)] border-[var(--danger)]"
                    onClick={() => setRemoveTarget(signer.address ?? "")}
                    disabled={owners.length <= 1}
                  >
                    {t("wallet.policyRemoveShort")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Policy Change History */}
      <Card>
        <h3 className="text-base font-bold text-[var(--text)] mb-3">
          {t("wallet.policyChangeHistory")}
        </h3>
        {policyTxs.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            {t("wallet.policyNoChanges")}
          </p>
        ) : (
          <div className="space-y-2">
            {policyTxs.map((tx) => {
              const extra: Record<string, unknown> =
                tx.extra && typeof tx.extra === "object" ? tx.extra : {};
              const rawAction =
                (extra.policy_action as string | undefined) ||
                inferPolicyAction(extra);
              const actionKey = rawAction
                ? POLICY_ACTION_LABELS[rawAction] || rawAction
                : "policyActionUnknown";
              return (
                <div
                  key={tx.id}
                  className="flex cursor-pointer items-center justify-between rounded-lg border border-[var(--border)] p-3 hover:bg-[var(--row-head-bg)] transition-colors"
                  onClick={() => navigate(`/transactions/${tx.id}`)}
                >
                  <div>
                    <div className="text-sm font-bold text-[var(--text)]">
                      {t(`transactions.${actionKey}`)}
                    </div>
                    {extra.new_owner && (
                      <div className="text-xs text-[var(--muted)] font-mono">
                        {truncateAddress(extra.new_owner as string)}
                      </div>
                    )}
                    {extra.removed_owner && (
                      <div className="text-xs text-[var(--muted)] font-mono">
                        {truncateAddress(extra.removed_owner as string)}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {extra.new_threshold != null && (
                      <span className="text-xs text-[var(--muted)]">
                        {extra.old_threshold as number} →{" "}
                        {extra.new_threshold as number}
                      </span>
                    )}
                    <Badge
                      variant={
                        TX_STATUS_VARIANT[tx.status] || "default"
                      }
                    >
                      {statusLabelMap[tx.status] || tx.status}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Modals */}
      <AddOwnerModal
        isOpen={addOwnerOpen}
        onClose={() => setAddOwnerOpen(false)}
        wallet={wallet}
        onCreated={onRefresh}
      />
      <ChangeThresholdModal
        isOpen={changeThresholdOpen}
        onClose={() => setChangeThresholdOpen(false)}
        wallet={wallet}
        onCreated={onRefresh}
      />
      {removeTarget && (
        <RemoveOwnerModal
          isOpen={!!removeTarget}
          onClose={() => setRemoveTarget(null)}
          wallet={wallet}
          ownerAddress={removeTarget}
          onCreated={onRefresh}
        />
      )}
      {swapTarget && (
        <SwapOwnerModal
          isOpen={!!swapTarget}
          onClose={() => setSwapTarget(null)}
          wallet={wallet}
          oldOwnerAddress={swapTarget}
          onCreated={onRefresh}
        />
      )}
    </div>
  );
};
