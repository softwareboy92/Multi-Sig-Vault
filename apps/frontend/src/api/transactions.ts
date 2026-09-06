import {
  apiGet,
  apiPost,
  extractData,
  transformPaginatedResponse,
} from './client';
import type {
  BtcDecodedTx,
  BtcExecution,
  BTCSigningInfo,
  PaginatedResponse,
  Transaction,
  TransactionCreate,
  TransactionExecution,
} from '@/types';

export async function getWalletTransactions(
  walletId: string,
  params?: { page?: number; pageSize?: number },
): Promise<PaginatedResponse<Transaction>> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('page_size', String(params.pageSize));
  const queryString = query.toString();
  return withInFlight(`wallet:${walletId}:transactions:${queryString}`, async () => {
    const response = await apiGet<{
      success: boolean;
      data: Transaction[];
      pagination?: { page: number; page_size: number; total: number; total_pages: number };
    }>(`/wallets/${walletId}/transactions${queryString ? `?${queryString}` : ''}`);
    return transformPaginatedResponse(response);
  });
}

const inFlight = new Map<string, Promise<unknown>>();

function withInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = fn().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

export async function createTransaction(
  walletId: string,
  data: TransactionCreate
): Promise<Transaction> {
  const response = await apiPost<{ success: boolean; data: Transaction }>(
    `/wallets/${walletId}/transactions`,
    data
  );
  return extractData(response);
}

export async function getTransaction(id: string, checkBroadcast = true): Promise<Transaction> {
  const params = checkBroadcast ? '' : '?check_broadcast=false';
  const response = await apiGet<{ success: boolean; data: Transaction }>(
    `/transactions/${id}${params}`
  );
  return extractData(response);
}

export async function submitSignature(
  id: string,
  signerId: string,
  signatureData: string,
  signatureType?: number
): Promise<Transaction> {
  const response = await apiPost<{ success: boolean; data: Transaction }>(
    `/transactions/${id}/sign?signer_id=${signerId}`,
    {
      signature_data: signatureData,
      signature_type: signatureType,
    }
  );
  return extractData(response);
}

export async function getExecution(
  id: string
): Promise<TransactionExecution> {
  const response = await apiGet<{ success: boolean; data: TransactionExecution }>(
    `/transactions/${id}/execution`
  );
  return extractData(response);
}

export async function broadcastTransaction(
  id: string,
  txHash: string
): Promise<Transaction> {
  const response = await apiPost<{ success: boolean; data: Transaction }>(
    `/transactions/${id}/broadcast?tx_hash=${encodeURIComponent(txHash)}`
  );
  return extractData(response);
}

export async function getBtcExecution(id: string): Promise<BtcExecution> {
  const response = await apiGet<{ success: boolean; data: BtcExecution }>(
    `/transactions/${id}/btc-execution`
  );
  return extractData(response);
}

export async function getBtcSigningInfo(id: string): Promise<BTCSigningInfo> {
  const response = await apiGet<{ success: boolean; data: BTCSigningInfo }>(
    `/transactions/${id}/btc-signing-info`
  );
  return extractData(response);
}

export async function broadcastBtcTransaction(
  id: string
): Promise<{ tx_hash: string; success: boolean; error?: string }> {
  const response = await apiPost<{
    success: boolean;
    data: { tx_hash: string; success: boolean; error?: string };
  }>(`/transactions/${id}/btc-broadcast`);
  const data = extractData(response);
  if (!data.success) {
    throw new BroadcastError(data.error || "Broadcast rejected by network");
  }
  return data;
}

/**
 * Thrown when a BTC broadcast is rejected by the network node.
 * Carries the raw RPC error string from the Electrum server.
 */
export class BroadcastError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BroadcastError";
  }
}

export async function getBtcDecodedTx(id: string): Promise<BtcDecodedTx> {
  const response = await apiGet<{ success: boolean; data: BtcDecodedTx }>(
    `/transactions/${id}/btc-decoded`
  );
  return extractData(response);
}

export interface CancelOptions {
  can_cancel_offchain: boolean;
  can_cancel_onchain: boolean;
  is_latest_nonce: boolean;
  reason: string;
}

export async function getCancelOptions(id: string): Promise<CancelOptions> {
  const response = await apiGet<{ success: boolean; data: CancelOptions }>(
    `/transactions/${id}/cancel-options`
  );
  return extractData(response);
}

export async function cancelTransaction(
  id: string,
  options?: { onChain?: boolean; reason?: string }
): Promise<Transaction> {
  const params = new URLSearchParams();
  if (options?.onChain !== undefined) {
    params.append('on_chain', String(options.onChain));
  }
  if (options?.reason) {
    params.append('reason', options.reason);
  }
  const queryString = params.toString();
  const url = queryString 
    ? `/transactions/${id}/cancel?${queryString}`
    : `/transactions/${id}/cancel`;
  
  const response = await apiPost<{ success: boolean; data: Transaction }>(url);
  return extractData(response);
}
