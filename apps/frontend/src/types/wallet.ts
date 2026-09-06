import type { ChainType } from './signer';

export type WalletStatus = 'PENDING_DEPLOY' | 'ACTIVE' | 'ARCHIVED';

export interface WalletSigner {
  id: string;
  name: string;
  device_type: string;
  status: string | null;
  address: string | null;
  public_key: string | null;
  derivation_path: string | null;
  master_fingerprint: string | null;
  xpub: string | null;
  ledger_policy_hmac: string | null;
  order_index: number;
}

export interface WalletUtxo {
  txid: string;
  vout: number;
  value: number;
  height?: number;
  locked?: boolean;
}

export interface Wallet {
  id: string;
  name: string;
  chain_type: ChainType;
  threshold: number;
  signer_count: number;
  verified_signer_count: number;
  address: string | null;
  status: WalletStatus;
  source?: 'CREATED' | 'IMPORTED' | null;
  deployed_at: string | null;
  deployment_tx_hash?: string | null;
  network_id: string;
  created_at: string;
  updated_at: string;
  signers: WalletSigner[];
  extra?: {
    utxos?: WalletUtxo[];
    utxos_synced_at?: string;
    [key: string]: unknown;
  } | null;
}

export interface WalletCreate {
  name: string;
  chain_type: ChainType;
  threshold: number;
  signer_ids: string[];
  network_id: string;
}

export interface WalletImport {
  name: string;
  chain_type: ChainType;
  network_id: string;
  safe_address?: string;
  safe_owners?: string[];
  safe_threshold?: number;
  address?: string;
  threshold?: number;
  public_keys?: string[];
  tx_id?: string;
}

export interface WalletDeployment {
  wallet_id: string;
  predicted_address: string;
  owners: string[];
  threshold: number;
  salt_nonce: number;
  factory_address: string;
  singleton_address: string;
  fallback_handler: string;
  is_deployed: boolean;
  chain_id: number;
  deployment_tx: {
    to: string;
    data: string;
    value: number | string;
  } | null;
}

export interface Asset {
  id: string;
  wallet_id: string;
  token_address: string | null;
  symbol: string;
  decimals: number;
  balance: string;
  is_native: boolean;
  last_synced_at: string | null;
}

export type PolicyAction = 'add_owner' | 'remove_owner' | 'swap_owner' | 'change_threshold';

export interface PolicyChangeCreate {
  action: PolicyAction;
  new_owner?: string;
  removed_owner?: string;
  new_threshold?: number;
  description?: string;
}
