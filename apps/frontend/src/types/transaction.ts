export type TransactionStatus =
  | 'PENDING_SIGN'
  | 'PARTIALLY_SIGNED'
  | 'SIGNED'
  | 'BROADCAST'
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'FAILED'
  | 'CANCELLED';

export type TransactionType = 'TRANSFER' | 'TOKEN_TRANSFER' | 'CONTRACT_CALL' | 'SAFE_DEPLOY' | 'CANCELLATION' | 'SAFE_POLICY_CHANGE';

export interface SignatureInfo {
  id: string;
  signer_id: string;
  signer_name: string | null;
  signature_type: number | null;
  verified: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  wallet_id: string;
  tx_type: TransactionType;
  direction?: "INCOMING" | "OUTGOING";
  description: string | null;
  to_address: string;
  from_address?: string | null;
  amount: string;
  token_address: string | null;
  token_symbol: string | null;
  token_decimals: number | null;
  fee_amount: string | null;
  fee_rate: number | null;
  payload: string | null;
  payload_hash: string | null;
  threshold: number;
  signature_count: number;
  signatures: SignatureInfo[];
  status: TransactionStatus;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  tx_hash: string | null;
  block_number: number | null;
  error_message: string | null;
  safe_nonce: number | null;
  safe_replaces_tx_id: string | null;
  can_broadcast: boolean | null;
  blocking_reason: string | null;
  extra?: Record<string, unknown> | null;
}

export interface NonceQueueTransaction {
  id: string;
  safe_nonce: number;
  status: TransactionStatus;
  to_address: string;
  amount: string;
  created_at: string;
  can_broadcast: boolean;
  blocking_reason: string | null;
}

export interface NonceQueueInfo {
  on_chain_nonce: number;
  next_allocatable_nonce: number;
  pending_transactions: NonceQueueTransaction[];
}

export interface TransactionCreate {
  to_address: string;
  amount: string;
  token_address?: string;
  description?: string;
  fee_rate?: number;
  selected_utxos?: UtxoSelection[];
  /** When true, skip coin selection and force ALL candidate UTXOs as inputs. BTC only. */
  use_all_inputs?: boolean;
  /** Send maximum amount (no change). Backend computes the actual amount. BTC only. */
  send_max?: boolean;
}

export interface UtxoSelection {
  txid: string;
  vout: number;
}

export interface TransactionExecution {
  safe_address: string;
  exec_transaction_data: string;
  signatures_count: number;
  estimated_gas: number | null;
}

export interface BtcExecution {
  transaction_id: string;
  signed_psbt: string;
  raw_tx: string;
}

export interface BTCSignerPolicyInfo {
  signer_id: string;
  signer_name: string | null;
  derivation_path: string | null;
  master_fingerprint: string | null;
  xpub: string | null;
  ledger_policy_hmac: string | null;
  order_index: number;
}

export interface BTCSigningInfo {
  transaction_id: string;
  wallet_id: string;
  psbt_base64: string;
  threshold: number;
  signer_count: number;
  wallet_policy_type: string;
  script_type?: string;
  signers: BTCSignerPolicyInfo[];
}

export interface BtcTxInput {
  txid: string;
  vout: number;
  value: number | null;
  address: string | null;
}

export interface BtcTxOutput {
  index: number;
  value: number;
  address: string | null;
  is_change: boolean | null;
}

export interface BtcDecodedTx {
  transaction_id: string;
  txid: string | null;
  version: number;
  size: number | null;
  vsize: number | null;
  fee: number | null;
  inputs: BtcTxInput[];
  outputs: BtcTxOutput[];
  status: string;
  confirmations: number | null;
}
