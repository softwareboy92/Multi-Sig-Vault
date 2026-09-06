/** Simulation status from backend. */
export type SimulationStatus = 'SUCCESS' | 'FAILURE' | 'ERROR';

/** A single asset change from EVM simulation. */
export interface AssetChange {
  from_address: string;
  to_address: string;
  token_symbol: string;
  token_address: string;
  token_decimals: number;
  type: 'Transfer' | 'Approve';
  direction: 'Sent' | 'Received';
  raw_amount: string;
  formatted_amount: string;
  dollar_value: string;
}

/** ETH balance change for an address. */
export interface BalanceChange {
  address: string;
  before: string;
  after: string;
  diff: string;
}

/** Structured EVM simulation result. */
export interface EvmSimulationResult {
  asset_changes: AssetChange[];
  eth_balance_changes: BalanceChange[];
  gas_estimate: number;
  revert_reason: string | null;
}

/** Full simulation response from backend. */
export interface SimulationResult {
  id: string;
  transaction_id: string;
  status: SimulationStatus;
  chain_type: string;
  result: EvmSimulationResult;
  error_message: string | null;
  gas_used: number | null;
  created_at: string;
  updated_at: string;
}

/** Simulation configuration status. */
export interface SimulationConfig {
  configured: boolean;
  enabled: boolean;
  source: 'settings' | 'environment' | 'none';
  access_key_set: boolean;
  account_slug: string;
  project_slug: string;
}

export interface SimulationConfigUpdate {
  enabled: boolean;
  access_key?: string;
  account_slug: string;
  project_slug: string;
}
