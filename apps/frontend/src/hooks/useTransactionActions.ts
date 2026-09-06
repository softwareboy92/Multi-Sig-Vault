import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  broadcastBtcTransaction,
  broadcastTransaction,
  cancelTransaction,
  getBtcSigningInfo,
  getCancelOptions,
  getExecution,
  getTransaction,
  submitSignature,
} from "../api";
import type { CancelOptions } from "../api";
import { useWalletConnection } from "./useWalletConnection";
import { useTranslation } from "./useTranslation";
import { getKeyvaultSigningPayload } from "../api/keyvault";
import { truncateAddress } from "../utils/address";
import { usePendingStore } from "../stores/usePendingStore";
import { useToastStore } from "../stores/useToastStore";
import { savePendingOp, removePendingOp, getPendingOpsByTxId } from "./usePendingOperation";
import type { DeviceType, Transaction, Wallet, WalletSigner } from "../types";
import type { SignPayload, WalletPolicy } from "@multivault/wallet-connector";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { getErrorMessage } from "../utils/errorUtils";
import { toAccountLevelPath } from "../utils/derivationPath";

function normalizeBtcAccountPath(path?: string | null): string | undefined {
  if (!path) return undefined;
  const normalized = path.startsWith("m/") ? path : `m/${path}`;
  return toAccountLevelPath(normalized);
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UseTransactionActionsReturn {
  actionLoading: boolean;
  error: string | null;
  // Sign
  signWithSigner: (signer: WalletSigner) => Promise<void>;
  signingSignerId: string | null;
  // Execute
  handleExecute: () => Promise<void>;
  executeWithDevice: (deviceType: DeviceType) => Promise<void>;
  executingDeviceType: DeviceType | null;
  showExecuteModal: boolean;
  setShowExecuteModal: (v: boolean) => void;
  // Cancel
  handleCancelClick: () => Promise<void>;
  handleCancelConfirm: (onChain: boolean) => Promise<void>;
  showCancelModal: boolean;
  setShowCancelModal: (v: boolean) => void;
  cancelOptions: CancelOptions | null;
  cancelReason: string;
  setCancelReason: (v: string) => void;
  // Broadcast retry
  broadcastTxHash: string | null;
  retryBroadcast: () => Promise<void>;
  // Signature retry
  pendingSignatureData: { txId: string; signerId: string; signature: string; version?: number } | null;
  retrySubmitSignature: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTransactionActions(
  transaction: Transaction | null,
  wallet: Wallet | null,
  txId: string | undefined,
  setTransaction: React.Dispatch<React.SetStateAction<Transaction | null>>,
  silentReload: () => Promise<void>,
): UseTransactionActionsReturn {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const walletConnection = useWalletConnection();
  const { requestRefresh } = usePendingStore();
  const { showToast } = useToastStore();

  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [signingSignerId, setSigningSignerId] = useState<string | null>(null);
  const [executingDeviceType, setExecutingDeviceType] = useState<DeviceType | null>(null);
  const [showExecuteModal, setShowExecuteModal] = useState(false);

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelOptions, setCancelOptions] = useState<CancelOptions | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // Broadcast retry state
  const [broadcastTxHash, setBroadcastTxHash] = useState<string | null>(null);
  const [broadcastRetryTxId, setBroadcastRetryTxId] = useState<string | null>(null);

  // Signature retry state
  const [pendingSignatureData, setPendingSignatureData] = useState<{
    txId: string;
    signerId: string;
    signature: string;
    version?: number;
  } | null>(null);

  // Recovery: restore pending ops from localStorage on mount
  useEffect(() => {
    if (!txId) return;
    const ops = getPendingOpsByTxId(txId);
    if (ops.length === 0) return;

    getTransaction(txId)
      .then((freshTx) => {
        for (const op of ops) {
          if (op.type === "signature") {
            const terminal = ["SIGNED", "BROADCAST", "CONFIRMED", "FAILED", "CANCELLED"];
            if (terminal.includes(freshTx.status) || freshTx.signature_count > (transaction?.signature_count ?? 0)) {
              removePendingOp("signature", txId);
            } else {
              setPendingSignatureData({
                txId: op.txId,
                signerId: op.data.signerId,
                signature: op.data.signature,
                version: 2,
              });
            }
          } else if (op.type === "broadcast") {
            const done = ["BROADCAST", "CONFIRMED", "FAILED"];
            if (done.includes(freshTx.status)) {
              removePendingOp("broadcast", txId);
            } else {
              setBroadcastTxHash(op.txHash);
              setBroadcastRetryTxId(op.txId);
            }
          }
        }
      })
      .catch(() => {
        // If fetch fails, leave ops in localStorage for next load
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txId]);

  // -----------------------------------------------------------------------
  // Cancel
  // -----------------------------------------------------------------------

  const handleCancelClick = async () => {
    if (!txId) return;

    setActionLoading(true);
    setError(null);

    try {
      const options = await getCancelOptions(txId);
      setCancelOptions(options);

      // Always open modal — if both options unavailable, modal shows explanation
      setShowCancelModal(true);
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelConfirm = async (onChain: boolean) => {
    if (!txId) return;

    setActionLoading(true);
    setError(null);
    setShowCancelModal(false);

    try {
      const updated = await cancelTransaction(txId, {
        onChain,
        reason: cancelReason.trim() || undefined,
      });

      // If onchain cancellation, navigate to the new CANCELLATION transaction
      if (updated.tx_type === "CANCELLATION") {
        navigate(`/transactions/${updated.id}`);
        showToast(t("transactions.cancellationCreated"), "success");
      } else {
        // Offchain cancellation, refresh current transaction
        setTransaction(updated);
        showToast(t("transactions.cancelled"), "success");
      }

      requestRefresh();
      setCancelReason("");
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setActionLoading(false);
    }
  };

  // -----------------------------------------------------------------------
  // Sign
  // -----------------------------------------------------------------------

  const signWithSigner = useCallback(
    async (signer: WalletSigner) => {
      if (!txId || !transaction || !wallet) return;

      setActionLoading(true);
      setSigningSignerId(signer.id);
      setError(null);

      try {
        if (signer.device_type === "KEYVAULT") {
          // Connect with KeyVaultProvider
          await walletConnection.connect({
            chainType: wallet.chain_type,
            deviceType: "KEYVAULT",
            address: signer.address || "",
          });

          // Get signing payload from backend
          const signingPayload = await getKeyvaultSigningPayload(txId, signer.id);

          // Create KeyVault payload (chain-agnostic: backend encodes chain info)
          const kvPayload: SignPayload = {
            type: "keyvault" as const,
            payloadJson: signingPayload.payload_json,
            signerId: signer.id,
          };

          // Sign via SDK (KeyVaultProvider handles QR Modal internally)
          const signature = await walletConnection.signTransaction(kvPayload);

          // Submit signature
          const signatureType = wallet.chain_type === "EVM" ? 2 : undefined;

          setPendingSignatureData({ txId, signerId: signer.id, signature, version: signatureType });
          // Persist to localStorage for post-refresh recovery
          savePendingOp({
            type: "signature",
            txId,
            data: { signature, signerId: signer.id, signerIndex: signer.index },
          });
          const updated = await submitSignature(txId, signer.id, signature, signatureType);
          setPendingSignatureData(null);
          removePendingOp("signature", txId);

          setTransaction(updated);
          requestRefresh();
          await silentReload();
          showToast(t("transactions.signSuccess"), "success");
          setActionLoading(false);
          return;
        }

        const deviceType: DeviceType =
          signer.device_type === "METAMASK" || signer.device_type === "HOT"
            ? "METAMASK"
            : signer.device_type === "WALLETCONNECT"
            ? "WALLETCONNECT"
            : "LEDGER";

        const isBtcLedger = wallet.chain_type === "BTC" && deviceType === "LEDGER";
        const signerPath = deviceType === "LEDGER"
          ? (isBtcLedger
              ? normalizeBtcAccountPath(signer.derivation_path)
              : signer.derivation_path ?? undefined)
          : undefined;
        const btcNetwork =
          isBtcLedger && (signerPath?.startsWith("m/48'/1'") || signerPath?.startsWith("m/84'/1'")) ? "testnet" : undefined;

        // For EVM, extract chainId before connecting
        let targetChainId: number | undefined;
        if (wallet.chain_type === "EVM") {
          const payload = transaction.payload;
          const payloadHash = transaction.payload_hash;
          if (!payload || !payloadHash) {
            throw new Error(t("transactions.errorMissingPayload"));
          }

          try {
            const typedData = JSON.parse(payload);
            targetChainId = typedData.domain?.chainId;
          } catch {
            throw new Error(t("transactions.errorInvalidPayload"));
          }
        }

        const connectionResult = await walletConnection.connect({
          chainType: wallet.chain_type,
          deviceType,
          derivationPath: signerPath,
          btcNetwork,
          evmChainId: targetChainId, // Pass chainId to connect
        });

        if (wallet.chain_type === "EVM") {
          const connectedAddr = connectionResult.address.toLowerCase();
          const signerAddr = signer.address?.toLowerCase();
          if (signerAddr && connectedAddr !== signerAddr) {
            throw new Error(t("transactions.errorAddressMismatch"));
          }
        } else {
          const connectedPubkey = connectionResult.publicKey?.toLowerCase();
          const signerPubkey = signer.public_key?.toLowerCase();
          if (connectedPubkey && signerPubkey && connectedPubkey !== signerPubkey) {
            throw new Error(t("transactions.errorPubkeyMismatch"));
          }
        }

        if (wallet.chain_type === "EVM") {
          const payload = transaction.payload;
          const payloadHash = transaction.payload_hash;
          if (!payload || !payloadHash) {
            throw new Error(t("transactions.errorMissingPayload"));
          }

          let typedData: any;
          try {
            typedData = JSON.parse(payload);
          } catch {
            throw new Error(t("transactions.errorInvalidPayload"));
          }

          const normalizeSafeTypedData = (data: any) => {
            if (!data || typeof data !== "object") return data;
            if (data.message && typeof data.message === "object") {
              const numericKeys = [
                "value",
                "safeTxGas",
                "baseGas",
                "gasPrice",
                "nonce",
                "operation",
              ];
              for (const key of numericKeys) {
                if (
                  key in data.message &&
                  data.message[key] !== undefined &&
                  data.message[key] !== null
                ) {
                  data.message[key] = String(data.message[key]);
                }
              }
            }
            return data;
          };

          typedData = normalizeSafeTypedData(typedData);

          // Chain already switched during connect
          const evmPayload: SignPayload = {
            type: "evm",
            typedData,
            safeTxHash: payloadHash,
          };

          const signature = await walletConnection.signTransaction(evmPayload);

          // Save signature data for retry if API call fails
          setPendingSignatureData({ txId, signerId: signer.id, signature, version: 2 });

          const updated = await submitSignature(txId, signer.id, signature, 2);

          // Clear on success
          setPendingSignatureData(null);
          setTransaction(updated);
          requestRefresh();
          await silentReload();
          showToast(t("transactions.signSuccess"), "success");
        } else {
          const signingInfo = await getBtcSigningInfo(txId);
          const signerPolicyInfo = signingInfo.signers.find(
            (s) => s.signer_id === signer.id,
          );
          if (!signerPolicyInfo) {
            throw new Error(t("transactions.errorMissingPolicy"));
          }

          const isNested = signingInfo.script_type === "p2sh-p2wsh";

          const defaultBtcPath = signingInfo.signers.some((s) =>
            (s.derivation_path || "").startsWith("m/48'/1'") ||
            (s.derivation_path || "").startsWith("m/84'/1'"),
          )
            ? isNested ? "m/48'/1'/0'/1'" : "m/48'/1'/0'/2'"
            : isNested ? "m/48'/0'/0'/1'" : "m/48'/0'/0'/2'";

          const signerWithPubkeys = signingInfo.signers
            .map((s) => ({
              ...s,
              derivation_path:
                normalizeBtcAccountPath(s.derivation_path) || defaultBtcPath,
            }))
            .filter((s) => s && s.xpub);

          const keys = signerWithPubkeys.map((s) => {
            const fp = s.master_fingerprint || "00000000";
            // Use account-level path (all hardened segments) for key origin
            const path = (s.derivation_path || defaultBtcPath).replace("m/", "");
            return `[${fp}/${path}]${s.xpub}`;
          });

          const innerDescriptor = `sortedmulti(${signingInfo.threshold},${keys
              .map((_, i) => `@${i}/**`)
              .join(",")})`;
          const walletPolicy: WalletPolicy = {
            name: `BTC ${signingInfo.threshold}-of-${signingInfo.signer_count}`,
            descriptorTemplate: isNested
              ? `sh(wsh(${innerDescriptor}))`
              : `wsh(${innerDescriptor})`,
            keys,
          };

          const walletHmac = signerPolicyInfo.ledger_policy_hmac
            ? signerPolicyInfo.ledger_policy_hmac
            : await walletConnection.registerBtcWalletPolicy(walletPolicy);

          const btcPayload: SignPayload = {
            type: "btc",
            psbt: signingInfo.psbt_base64,
            txType: isNested ? "nested-segwit" : "native-segwit",
            isMultisig: true,
            walletPolicy,
            walletHmac,
          };

          const signature = await walletConnection.signTransaction(btcPayload);
          if (signature.trim() === "[]") {
            throw new Error(t("transactions.errorEmptySignature"));
          }

          let signatureData = signature;
          try {
            const parsed = JSON.parse(signature) as Array<
              [number, { pubkey: string; signature: string }]
            >;
            const targetPubkey = (signer.public_key || "").toLowerCase();
            const filtered = parsed.filter((item) => {
              const pubkey = item?.[1]?.pubkey || "";
              return pubkey.toLowerCase() === targetPubkey;
            });
            if (filtered.length > 0) {
              signatureData = JSON.stringify(filtered);
            }
          } catch {
            // keep original signature data
          }

          // Save signature data for retry if API call fails
          setPendingSignatureData({ txId, signerId: signer.id, signature: signatureData });

          const updated = await submitSignature(txId, signer.id, signatureData);

          // Clear on success
          setPendingSignatureData(null);

          setTransaction(updated);
          requestRefresh();
          await silentReload();
          showToast(t("transactions.signSuccess"), "success");
        }
      } catch (err) {
        // Clear potentially dead provider on sign failure
        try { walletConnection.forceDisconnect?.(); } catch { /* ignore */ }
        setError(getErrorMessage(err, t));
      } finally {
        setActionLoading(false);
        setSigningSignerId(null);
      }
    },
    [txId, transaction, wallet, walletConnection],
  );

  // -----------------------------------------------------------------------
  // Execute
  // -----------------------------------------------------------------------

  const handleExecute = async () => {
    if (!txId || !transaction || !wallet) return;
    if (wallet.chain_type === "EVM") {
      setShowExecuteModal(true);
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      const result = await broadcastBtcTransaction(txId);
      requestRefresh();
      await silentReload();
      showToast(
        t("transactions.broadcasted", {
          hash: truncateAddress(result.tx_hash, 10, 8),
        }),
        "success",
      );
    } catch (err) {
      const msg = getErrorMessage(err, t);
      showToast(
        t("transactions.broadcastFailed", { detail: msg }),
        "error",
      );
      setError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const executeWithDevice = async (deviceType: DeviceType) => {
    if (!txId || !transaction || !wallet) return;
    setShowExecuteModal(false);
    setExecutingDeviceType(deviceType);
    setActionLoading(true);
    setError(null);

    try {
      if (deviceType === "LEDGER") {
        throw new Error(t("transactions.errorLedgerExecuteNotSupported"));
      }

      const execution = await getExecution(txId);

      // Extract target chainId before connecting
      let targetChainId: number | null = null;
      if (transaction.payload) {
        try {
          const typedData = JSON.parse(transaction.payload);
          targetChainId = typedData.domain?.chainId;
        } catch {
          targetChainId = null;
        }
      }

      const connectionResult = await walletConnection.connect({
        chainType: "EVM",
        deviceType,
        evmChainId: targetChainId || undefined, // Pass chainId to connect
      });

      const eip1193 = walletConnection.getEip1193Provider();
      if (!eip1193) {
        throw new Error(t("transactions.errorNoProvider"));
      }

      // Chain already switched during connect, no need to switch again

      const txHash = await eip1193.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: connectionResult.address,
            to: execution.safe_address,
            data: execution.exec_transaction_data,
            value: "0x0",
          },
        ],
      });

      // txHash is now on-chain — save it immediately for recovery
      setBroadcastTxHash(txHash);
      setBroadcastRetryTxId(txId);
      // Persist to localStorage for post-refresh recovery
      savePendingOp({ type: "broadcast", txId, txHash });

      try {
        await broadcastTransaction(txId, txHash);
        // Clear retry state on success
        setBroadcastTxHash(null);
        setBroadcastRetryTxId(null);
        removePendingOp("broadcast", txId);
        requestRefresh();
        await silentReload();
        showToast(t("transactions.executeSuccess"), "success");
      } catch (apiErr) {
        // Transaction is ON-CHAIN but API recording failed
        showToast(
          t("broadcast.txHashSaved", { hash: txHash.slice(0, 10) + "..." + txHash.slice(-8) }),
          "warning",
          0,
        );
        setError(getErrorMessage(apiErr, t));
        return;
      }
    } catch (err) {
      // Clear potentially dead provider on execute failure
      try { await walletConnection.forceDisconnect?.(); } catch { /* best-effort */ }
      const msg = getErrorMessage(err, t);
      showToast(
        t("transactions.executeFailed", { detail: msg }),
        "error",
      );
      setError(msg);
    } finally {
      setActionLoading(false);
      setExecutingDeviceType(null);
    }
  };

  const retryBroadcast = useCallback(async () => {
    if (!broadcastTxHash || !broadcastRetryTxId) return;
    setActionLoading(true);
    setError(null);
    try {
      await broadcastTransaction(broadcastRetryTxId, broadcastTxHash);
      setBroadcastTxHash(null);
      setBroadcastRetryTxId(null);
      removePendingOp("broadcast", broadcastRetryTxId);
      requestRefresh();
      await silentReload();
      showToast(t("common.success"), "success");
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setActionLoading(false);
    }
  }, [broadcastTxHash, broadcastRetryTxId, requestRefresh, silentReload, showToast, t]);

  const retrySubmitSignature = useCallback(async () => {
    if (!pendingSignatureData) return;
    setActionLoading(true);
    setError(null);
    try {
      const { txId: sigTxId, signerId, signature, version } = pendingSignatureData;
      const updated = await submitSignature(sigTxId, signerId, signature, version);
      setPendingSignatureData(null);
      removePendingOp("signature", sigTxId);
      setTransaction(updated);
      requestRefresh();
      await silentReload();
      showToast(t("common.success"), "success");
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setActionLoading(false);
    }
  }, [pendingSignatureData, setTransaction, requestRefresh, silentReload, showToast, t]);

  return {
    actionLoading,
    error,
    // Sign
    signWithSigner,
    signingSignerId,
    // Execute
    handleExecute,
    executeWithDevice,
    executingDeviceType,
    showExecuteModal,
    setShowExecuteModal,
    // Cancel
    handleCancelClick,
    handleCancelConfirm,
    showCancelModal,
    setShowCancelModal,
    cancelOptions,
    cancelReason,
    setCancelReason,
    // Broadcast retry
    broadcastTxHash,
    retryBroadcast,
    // Signature retry
    pendingSignatureData,
    retrySubmitSignature,
  };
}
