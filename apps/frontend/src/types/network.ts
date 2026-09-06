// ============================================================================
// Chain & Node Type Constants
// ============================================================================

/** Supported chain types (matches backend SUPPORTED_CHAIN_TYPES). */
export type ChainTypeNetwork = "EVM" | "BTC" | "TRON" | "SOL";

/** Node connection type (matches backend node_type enum). */
export type NodeType = "JSON_RPC" | "ELECTRUM" | "GRPC" | "WEBSOCKET";

// ============================================================================
// Unified Network Types
// ============================================================================

/** Network detail — returned by GET /networks/{chain_type}[/{id}]. */
export interface NetworkConfig {
  id: string;
  chain_type: ChainTypeNetwork;
  name: string;
  explorer_url: string | null;
  enabled: boolean;
  is_testnet: boolean;
  default_node_id: string | null;
  extra: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  // Convenience fields extracted from extra by the backend
  chain_id: number | null;
  btc_network: string | null;
}

/** POST /networks/{chain_type} body. */
export interface NetworkCreate {
  chain_type: ChainTypeNetwork;
  name: string;
  explorer_url?: string | null;
  enabled?: boolean;
  is_testnet?: boolean;
  extra?: Record<string, unknown> | null;
}

/** PUT /networks/{chain_type}/{network_id} body. */
export interface NetworkUpdate {
  name?: string;
  explorer_url?: string | null;
  enabled?: boolean;
  is_testnet?: boolean;
  extra?: Record<string, unknown> | null;
}

// ============================================================================
// Unified Node Types
// ============================================================================

/** Node detail — returned by GET /networks/{chain_type}/{id}/nodes. */
export interface NodeConfig {
  id: string;
  network_id: string;
  node_type: NodeType;
  endpoint_url: string;
  priority: number;
  enabled: boolean;
  is_healthy: boolean;
  last_health_check: string | null;
  extra: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** POST /networks/{chain_type}/{network_id}/nodes body. */
export interface NodeCreate {
  node_type: NodeType;
  endpoint_url: string;
  priority?: number;
  enabled?: boolean;
  extra?: Record<string, unknown> | null;
}

/** PUT /networks/nodes/{node_id} body. */
export interface NodeUpdate {
  endpoint_url: string;
  priority?: number;
  enabled?: boolean;
  extra?: Record<string, unknown> | null;
}

// ============================================================================
// Network / Node Test Types
// ============================================================================

/** POST /networks/{chain_type}/test body. */
export interface NetworkTestRequest {
  chain_type: ChainTypeNetwork;
  endpoint_url: string;
  node_type?: NodeType;
  extra?: Record<string, unknown> | null;
}

/** POST /networks/{chain_type}/test response. */
export interface NetworkTestResponse {
  success: boolean;
  latency_ms: number | null;
  chain_info: Record<string, unknown> | null;
}

/** POST /networks/nodes/{node_id}/test response. */
export interface NodeTestResponse {
  success: boolean;
  latency_ms: number | null;
}

// ============================================================================
// Common Types
// ============================================================================

export interface SetDefaultNodeRequest {
  node_id: string;
}
