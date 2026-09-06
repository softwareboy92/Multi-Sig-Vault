import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  extractData,
  transformPaginatedResponse,
} from './client';
import type {
  ChainType,
  ChallengeRequest,
  ChallengeResponse,
  PaginatedResponse,
  Signer,
  SignerCreate,
} from '@/types';

export interface SignerVerify {
  challenge: string;
  signature: string;
  device_type?: string;
  derivation_path?: string;
  master_fingerprint?: string;
  xpub?: string;
}

export async function getSigners(chainType?: ChainType): Promise<PaginatedResponse<Signer>> {
  const query = chainType
    ? `?chain_type=${encodeURIComponent(chainType)}&page_size=100`
    : '';
  const response = await apiGet<{
    success: boolean;
    data: Signer[];
    pagination?: { page: number; page_size: number; total: number; total_pages: number };
  }>(`/signers${query}`);
  return transformPaginatedResponse(response);
}

export async function getSigner(id: string): Promise<Signer> {
  const response = await apiGet<{ success: boolean; data: Signer }>(
    `/signers/${id}`
  );
  return extractData(response);
}

export async function createChallenge(
  data: ChallengeRequest
): Promise<ChallengeResponse> {
  const response = await apiPost<{ success: boolean; data: ChallengeResponse }>(
    '/signers/challenge',
    data
  );
  return extractData(response);
}

export async function createSigner(data: SignerCreate): Promise<Signer> {
  const response = await apiPost<{ success: boolean; data: Signer }>(
    '/signers',
    data
  );
  return extractData(response);
}

export async function verifySigner(
  signerId: string,
  data: SignerVerify
): Promise<Signer> {
  const response = await apiPost<{ success: boolean; data: Signer }>(
    `/signers/${signerId}/verify`,
    data
  );
  return extractData(response);
}

export async function deleteSigner(id: string): Promise<void> {
  return apiDelete(`/signers/${id}`);
}

export async function renameSigner(id: string, name: string): Promise<Signer> {
  const response = await apiPatch<{ success: boolean; data: Signer }>(
    `/signers/${id}`,
    { name }
  );
  return extractData(response);
}
