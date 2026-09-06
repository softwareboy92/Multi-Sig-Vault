import { useCallback, useMemo, useReducer, useState } from "react";
import { useTranslation } from "./useTranslation";
import { useWalletConnection } from "./useWalletConnection";
import { useToastStore } from "../stores/useToastStore";
import { usePendingStore } from "../stores/usePendingStore";
import { useNetworkStore } from "../stores/useNetworkStore";
import { buildAddChainParams } from "../utils/evm";
import { savePendingOp, removePendingOp } from "./usePendingOperation";
import {
  activateWallet,
  getWalletDeployment,
} from "../api";
import type { DeviceType, Wallet, WalletDeployment } from "../types";

// ---------------------------------------------------------------------------
// State & Actions
// ---------------------------------------------------------------------------

export interface DeployState {
  step: 1 | 2 | 3;
  device: DeviceType | null;
  address: string | null;
  txHash: string | null;
  error: string | null;
  connecting: boolean;
  fetching: boolean;
  sending: boolean;
  confirming: boolean;
  activationFailed: boolean;
  deployment: WalletDeployment | null;
}

const INITIAL_STATE: DeployState = {
  step: 1,
  device: null,
  address: null,
  txHash: null,
  error: null,
  connecting: false,
  fetching: false,
  sending: false,
  confirming: false,
  activationFailed: false,
  deployment: null,
};

type DeployAction =
  | { type: "RESET" }
  | { type: "SET_DEVICE"; device: DeviceType }
  | { type: "CONNECT_START" }
  | { type: "CONNECT_SUCCESS"; address: string }
  | { type: "CONNECT_FAIL"; error: string }
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; deployment: WalletDeployment }
  | { type: "FETCH_FAIL"; error: string }
  | { type: "SEND_START" }
  | { type: "SEND_SUCCESS"; txHash: string }
  | { type: "SEND_FAIL"; error: string }
  | { type: "CONFIRM_START" }
  | { type: "CONFIRM_SUCCESS" }
  | { type: "CONFIRM_FAIL"; error: string }
  | { type: "ACTIVATE_FAIL"; error: string }
  | { type: "BACK" };

function deployReducer(state: DeployState, action: DeployAction): DeployState {
  switch (action.type) {
    case "RESET":
      return INITIAL_STATE;
    case "SET_DEVICE":
      return { ...state, device: action.device };
    case "CONNECT_START":
      return { ...state, connecting: true, error: null };
    case "CONNECT_SUCCESS":
      return { ...state, connecting: false, address: action.address, step: 2 };
    case "CONNECT_FAIL":
      return { ...state, connecting: false, error: action.error, step: 1 };
    case "FETCH_START":
      return { ...state, fetching: true };
    case "FETCH_SUCCESS":
      return { ...state, fetching: false, deployment: action.deployment };
    case "FETCH_FAIL":
      return { ...state, fetching: false, error: action.error, step: 1 };
    case "SEND_START":
      return { ...state, sending: true, error: null };
    case "SEND_SUCCESS":
      return { ...state, sending: false, txHash: action.txHash, step: 3 };
    case "SEND_FAIL":
      return { ...state, sending: false, error: action.error, step: 2 };
    case "CONFIRM_START":
      return { ...state, confirming: true };
    case "CONFIRM_SUCCESS":
      return { ...state, confirming: false };
    case "CONFIRM_FAIL":
      return { ...state, confirming: false, error: action.error, step: 2 };
    case "ACTIVATE_FAIL":
      return { ...state, confirming: false, activationFailed: true, error: action.error, step: 3 };
    case "BACK":
      return {
        ...state,
        step: state.step > 1 ? ((state.step - 1) as 1 | 2 | 3) : state.step,
        error: null,
      };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseDeployFlowReturn {
  state: DeployState;
  isOpen: boolean;
  canClose: boolean;
  open: () => void;
  close: () => void;
  setDevice: (device: DeviceType) => void;
  back: () => void;
  connectAndPrepare: () => Promise<void>;
  confirmDeploy: () => Promise<void>;
  retryActivation: () => Promise<void>;
}

export function useDeployFlow(
  wallet: Wallet | null,
  walletId: string | undefined,
  evmNetworks: Map<string, { name: string; chain_id: number | null }>,
  onSuccess: () => Promise<void>,
): UseDeployFlowReturn {
  const { t } = useTranslation();
  const { connect, getEip1193Provider } = useWalletConnection();
  const { showToast } = useToastStore();
  const { requestRefresh } = usePendingStore();

  const [deployState, dispatch] = useReducer(deployReducer, INITIAL_STATE);
  const [isOpen, setIsOpen] = useState(false);

  const canClose = useMemo(
    () => !deployState.connecting && !deployState.fetching && !deployState.sending && !deployState.confirming,
    [deployState.connecting, deployState.fetching, deployState.sending, deployState.confirming],
  );

  const open = useCallback(() => {
    dispatch({ type: "RESET" });
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    if (canClose) setIsOpen(false);
  }, [canClose]);

  const setDevice = useCallback((device: DeviceType) => {
    dispatch({ type: "SET_DEVICE", device });
  }, []);

  const back = useCallback(() => {
    dispatch({ type: "BACK" });
  }, []);

  // Helper
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const getAddChainParams = useCallback(async () => {
    if (!wallet?.network_id || wallet.chain_type !== "EVM") return undefined;

    const store = useNetworkStore.getState();
    let evmList = store.networks.EVM ?? [];
    if (evmList.length === 0) {
      try {
        await store.fetchNetworks("EVM");
        evmList = useNetworkStore.getState().networks.EVM ?? [];
      } catch {
        return undefined;
      }
    }

    const network = evmList.find((n) => n.id === wallet.network_id);
    if (!network) return undefined;

    let nodes = useNetworkStore.getState().nodes[wallet.network_id] ?? [];
    if (nodes.length === 0) {
      try {
        await useNetworkStore.getState().fetchNodes("EVM", wallet.network_id);
        nodes = useNetworkStore.getState().nodes[wallet.network_id] ?? [];
      } catch {
        return undefined;
      }
    }

    return buildAddChainParams(network, nodes);
  }, [wallet]);

  const isRpcEndpointBackoffError = useCallback((err: unknown) => {
    const error = err as { code?: number; message?: string };
    const message = (error.message ?? "").toLowerCase();
    return (
      error.code === -32002 &&
      (message.includes("rpc endpoint returned too many errors") ||
        message.includes("consider using a different rpc endpoint"))
    );
  }, []);

  const formatDeployError = useCallback((err: unknown) => {
    if (isRpcEndpointBackoffError(err)) {
      return t("wallet.deployRpcBackoff");
    }
    return err instanceof Error ? err.message : String(err);
  }, [isRpcEndpointBackoffError, t]);

  const waitForReceipt = useCallback(async (txHash: string, timeoutMs = 120_000) => {
    const provider = getEip1193Provider();
    if (!provider) throw new Error(t("wallet.deployProviderMissing"));
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const receipt = await provider.request({
        method: "eth_getTransactionReceipt",
        params: [txHash],
      });
      if (receipt) {
        const status = (receipt as any).status;
        if (status === "0x0" || status === 0) {
          throw new Error(t("wallet.deployFailed"));
        }
        return receipt;
      }
      await sleep(2000);
    }
    throw new Error(t("wallet.deployTimeout"));
  }, [getEip1193Provider, t]);

  const connectAndPrepare = useCallback(async () => {
    if (!wallet || !walletId || !deployState.device) return;

    dispatch({ type: "CONNECT_START" });
    try {
      const connected = await connect({
        chainType: wallet.chain_type,
        deviceType: deployState.device,
        evmChainId: wallet.network_id
          ? evmNetworks.get(wallet.network_id)?.chain_id ?? undefined
          : undefined,
      });
      dispatch({ type: "CONNECT_SUCCESS", address: connected.address });

      dispatch({ type: "FETCH_START" });
      const deploymentData = await getWalletDeployment(walletId);
      dispatch({ type: "FETCH_SUCCESS", deployment: deploymentData });
    } catch (err) {
      const message = formatDeployError(err);
      dispatch({ type: "CONNECT_FAIL", error: message });
    }
  }, [wallet, walletId, deployState.device, connect, evmNetworks, formatDeployError]);

  const confirmDeploy = useCallback(async () => {
    if (!wallet || !walletId || !deployState.deployment || !deployState.address) return;

    dispatch({ type: "SEND_START" });
    try {
      const deployTx = deployState.deployment.deployment_tx;
      if (!deployTx) throw new Error(t("wallet.deployDataMissing"));

      const provider = getEip1193Provider();
      if (!provider) throw new Error(t("wallet.deployProviderMissing"));

      const targetChainId = `0x${deployState.deployment.chain_id.toString(16)}`;
      const currentChainId = await provider.request({ method: "eth_chainId" });
      const addChainParams = await getAddChainParams();

      if (currentChainId !== targetChainId) {
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: targetChainId }],
          });
        } catch (switchErr) {
          const switchCode = (switchErr as { code?: number }).code;
          if (switchCode === 4902 && addChainParams) {
            await provider.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: targetChainId,
                chainName: addChainParams.chainName,
                nativeCurrency: addChainParams.nativeCurrency,
                rpcUrls: addChainParams.rpcUrls,
                blockExplorerUrls: addChainParams.blockExplorerUrls ?? [],
              }],
            });
            await provider.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: targetChainId }],
            });
          } else {
            throw switchErr;
          }
        }
      }

      const txParams = {
        from: deployState.address,
        to: deployTx.to,
        data: deployTx.data,
        value: `0x${Number(deployTx.value).toString(16)}`,
      };

      let txHash: string;
      try {
        txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [txParams],
        });
      } catch (sendErr) {
        if (!isRpcEndpointBackoffError(sendErr) || !addChainParams) {
          throw sendErr;
        }

        showToast(t("wallet.deployRefreshingRpc"), "warning", 6000);

        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: targetChainId,
            chainName: addChainParams.chainName,
            nativeCurrency: addChainParams.nativeCurrency,
            rpcUrls: addChainParams.rpcUrls,
            blockExplorerUrls: addChainParams.blockExplorerUrls ?? [],
          }],
        });
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: targetChainId }],
        });

        txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [txParams],
        });
      }

      dispatch({ type: "SEND_SUCCESS", txHash });
      dispatch({ type: "CONFIRM_START" });

      await waitForReceipt(txHash);

      // Persist for post-refresh recovery (txHash + activation params)
      savePendingOp({
        type: "activation",
        walletId: walletId!,
        txHash,
        params: {
          address: deployState.deployment.predicted_address,
          salt: String(deployState.deployment.salt_nonce),
          factory_address: deployState.deployment.factory_address,
        },
      });

      // Transaction confirmed on-chain — now activate in backend
      try {
        await activateWallet(walletId, {
          address: deployState.deployment.predicted_address,
          tx_hash: txHash,
          salt: String(deployState.deployment.salt_nonce),
          factory_address: deployState.deployment.factory_address,
        });
        removePendingOp("activation", walletId!);
      } catch (activateErr) {
        // Tx is on-chain but backend activation failed
        const activateMsg = activateErr instanceof Error ? activateErr.message : String(activateErr);
        dispatch({ type: "ACTIVATE_FAIL", error: activateMsg });
        showToast(t("deploy.activationFailed"), "warning", 15000);
        return;
      }

      dispatch({ type: "CONFIRM_SUCCESS" });
      showToast(t("wallet.deploySuccess"), "success");
      setIsOpen(false);
      requestRefresh();
      await onSuccess();
    } catch (err) {
      const message = formatDeployError(err);
      dispatch({ type: "SEND_FAIL", error: message });
    }
  }, [
    wallet, walletId, deployState.deployment, deployState.address,
    getAddChainParams, getEip1193Provider, isRpcEndpointBackoffError,
    waitForReceipt, showToast, t, requestRefresh, onSuccess, formatDeployError,
  ]);

  const retryActivation = useCallback(async () => {
    if (!walletId || !deployState.deployment || !deployState.txHash) return;

    dispatch({ type: "CONFIRM_START" });
    try {
      await activateWallet(walletId, {
        address: deployState.deployment.predicted_address,
        tx_hash: deployState.txHash,
        salt: String(deployState.deployment.salt_nonce),
        factory_address: deployState.deployment.factory_address,
      });
      removePendingOp("activation", walletId!);
      dispatch({ type: "CONFIRM_SUCCESS" });
      showToast(t("wallet.deploySuccess"), "success");
      setIsOpen(false);
      requestRefresh();
      await onSuccess();
    } catch (err) {
      const message = formatDeployError(err);
      dispatch({ type: "ACTIVATE_FAIL", error: message });
    }
  }, [walletId, deployState.deployment, deployState.txHash, showToast, t, requestRefresh, onSuccess, formatDeployError]);

  return {
    state: deployState,
    isOpen,
    canClose,
    open,
    close,
    setDevice,
    back,
    connectAndPrepare,
    confirmDeploy,
    retryActivation,
  };
}
