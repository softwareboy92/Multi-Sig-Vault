export type DeviceType =
  | 'LEDGER'
  | 'TREZOR'
  | 'METAMASK'
  | 'WALLETCONNECT'
  | 'KEYVAULT'
  | 'HOT'
  | 'WATCH_ONLY'
  | 'UNKNOWN';

export type ChainType = 'BTC' | 'EVM';

export type SignerStatus = 'UNVERIFIED' | 'VERIFIED' | 'REVOKED';

/** Brief wallet info associated with a signer (from API eager-load). */
export interface SignerWalletBrief {
  wallet_id: string;
  wallet_name: string;
  network_id: string;
  network_name: string;
  is_testnet: boolean;
}

export interface Signer {
  id: string;
  name: string;
  device_type: DeviceType;
  chain_type: ChainType;
  status: SignerStatus;
  address: string | null;
  public_key: string | null;
  derivation_path: string | null;
  master_fingerprint: string | null;
  xpub: string | null;
  btc_network: string | null;
  wallets: SignerWalletBrief[];
  created_at: string;
  updated_at: string;
}

export interface ChallengeRequest {
  chain_type: ChainType;
  address?: string;
  public_key?: string;
}

export interface ChallengeResponse {
  challenge: string;
  expires_at: string;
}

export interface SignerCreate {
  name: string;
  device_type: DeviceType;
  chain_type: ChainType;
  address?: string;
  public_key?: string;
  derivation_path?: string;
  master_fingerprint?: string;
  xpub?: string;
  script_type?: string;
  btc_network?: string;
  challenge: string;
  signature: string;
}
