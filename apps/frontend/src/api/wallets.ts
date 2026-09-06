import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  extractData,
  transformPaginatedResponse,
} from './client';
import type {
  Asset,
  NonceQueueInfo,
  PaginatedResponse,
  PolicyChangeCreate,
  Wallet,
  WalletCreate,
  WalletDeployment,
  WalletImport,
} from '@/types';
import type { Transaction } from '@/types/transaction';

export async function getWallets(params?: {
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResponse<Wallet>> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('page_size', String(params.pageSize));
  const queryString = query.toString();
  const response = await apiGet<{
    success: boolean;
    data: Wallet[];
    pagination?: { page: number; page_size: number; total: number; total_pages: number };
  }>(`/wallets${queryString ? `?${queryString}` : ''}`);
  return transformPaginatedResponse(response);
}

export async function getWallet(id: string): Promise<Wallet> {
  return withInFlight(`wallet:${id}`, async () => {
    const response = await apiGet<{ success: boolean; data: Wallet }>(
      `/wallets/${id}`
    );
    return extractData(response);
  });
}

export async function createWallet(data: WalletCreate): Promise<Wallet> {
  const response = await apiPost<{ success: boolean; data: Wallet }>(
    '/wallets',
    data
  );
  return extractData(response);
}

export async function importWallet(data: WalletImport): Promise<Wallet> {
  const response = await apiPost<{ success: boolean; data: Wallet }>(
    '/wallets/import',
    data
  );
  return extractData(response);
}

export interface SafeInfoPreview {
  address: string;
  owners: string[];
  threshold: number;
  nonce: number;
  is_deployed: boolean;
}

export interface BtcPreviewResult {
  mode: 'manual' | 'auto';
  address: string;
  threshold: number;
  public_keys: string[];
  signer_count: number;
  witness_script: string;
  address_match: boolean;
}

export async function getSafeInfo(
  address: string,
  networkId: string,
): Promise<SafeInfoPreview> {
  const params = new URLSearchParams({ address, network_id: networkId });
  const response = await apiGet<{ success: boolean; data: SafeInfoPreview }>(
    `/wallets/safe-info?${params.toString()}`
  );
  return extractData(response);
}

export interface BtcPreviewRequest {
  network_id: string;
  address: string;
  public_keys?: string[];
  threshold?: number;
  tx_id?: string;
}

export async function getBtcPreview(
  data: BtcPreviewRequest,
): Promise<BtcPreviewResult> {
  const response = await apiPost<{ success: boolean; data: BtcPreviewResult }>(
    '/wallets/btc-preview',
    data
  );
  return extractData(response);
}

export async function deleteWallet(id: string): Promise<void> {
  return apiDelete(`/wallets/${id}`);
}

export async function renameWallet(id: string, name: string): Promise<Wallet> {
  const response = await apiPatch<{ success: boolean; data: Wallet }>(
    `/wallets/${id}`,
    { name }
  );
  return extractData(response);
}

export async function getWalletDeployment(
  id: string
): Promise<WalletDeployment> {
  const response = await apiGet<{ success: boolean; data: WalletDeployment }>(
    `/wallets/${id}/deployment`
  );
  return extractData(response);
}

export interface ActivateWalletParams {
  address: string;
  tx_hash?: string;
  salt?: string;
  factory_address?: string;
}

export async function activateWallet(
  id: string,
  params?: ActivateWalletParams
): Promise<Wallet> {
  const response = await apiPost<{ success: boolean; data: Wallet }>(
    `/wallets/${id}/activate`,
    params || {}
  );
  return extractData(response);
}

export async function archiveWallet(id: string): Promise<Wallet> {
  const response = await apiPatch<{ success: boolean; data: Wallet }>(
    `/wallets/${id}`,
    { status: "ARCHIVED" }
  );
  return extractData(response);
}

export async function getWalletAssets(id: string): Promise<Asset[]> {
  return withInFlight(`wallet:${id}:assets`, async () => {
    const response = await apiGet<{ success: boolean; data: Asset[] }>(
      `/wallets/${id}/assets`
    );
    return extractData(response);
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

export async function syncWalletAssets(id: string): Promise<void> {
  return apiPost(`/wallets/${id}/assets/sync`);
}

export async function importToken(
  walletId: string,
  contractAddress: string
): Promise<Asset> {
  const response = await apiPost<{ success: boolean; data: Asset }>(
    `/wallets/${walletId}/assets`,
    { contract_address: contractAddress }
  );
  return extractData(response);
}

export async function getWalletNonceQueue(
  walletId: string
): Promise<NonceQueueInfo> {
  return withInFlight(`wallet:${walletId}:nonce-queue`, async () => {
    const response = await apiGet<{ success: boolean; data: NonceQueueInfo }>(
      `/wallets/${walletId}/nonce-queue`
    );
    return extractData(response);
  });
}

export async function createPolicyTransaction(
  walletId: string,
  data: PolicyChangeCreate,
): Promise<Transaction> {
  const response = await apiPost<{ success: boolean; data: Transaction }>(
    `/wallets/${walletId}/policy-changes`,
    data,
  );
  return extractData(response);
}

export async function syncWalletPolicy(walletId: string): Promise<void> {
  await apiPost(`/wallets/${walletId}/sync-policy`);
}
