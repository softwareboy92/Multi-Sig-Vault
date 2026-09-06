import { apiDelete, apiGet, apiPost, apiPut, extractData, type BackendResponse } from './client';
import type {
  ChainTypeNetwork,
  NetworkConfig,
  NetworkCreate,
  NetworkUpdate,
  NetworkTestRequest,
  NetworkTestResponse,
  NodeConfig,
  NodeCreate,
  NodeUpdate,
  NodeTestResponse,
  SetDefaultNodeRequest,
} from '../types';

// ============================================================================
// Network APIs — parameterized by chain_type
// ============================================================================

export async function getNetworks(chainType: ChainTypeNetwork): Promise<NetworkConfig[]> {
  const ct = chainType.toLowerCase();
  const response = await apiGet<BackendResponse<NetworkConfig[]>>(`/networks/${ct}`);
  return extractData(response);
}

export async function getNetwork(chainType: ChainTypeNetwork, networkId: string): Promise<NetworkConfig> {
  const ct = chainType.toLowerCase();
  const response = await apiGet<BackendResponse<NetworkConfig>>(`/networks/${ct}/${networkId}`);
  return extractData(response);
}

export async function createNetwork(chainType: ChainTypeNetwork, payload: Omit<NetworkCreate, 'chain_type'>): Promise<NetworkConfig> {
  const ct = chainType.toLowerCase();
  const body: NetworkCreate = { ...payload, chain_type: chainType };
  const response = await apiPost<BackendResponse<NetworkConfig>, NetworkCreate>(`/networks/${ct}`, body);
  return extractData(response);
}

export async function updateNetwork(chainType: ChainTypeNetwork, networkId: string, payload: NetworkUpdate): Promise<NetworkConfig> {
  const ct = chainType.toLowerCase();
  const response = await apiPut<BackendResponse<NetworkConfig>, NetworkUpdate>(`/networks/${ct}/${networkId}`, payload);
  return extractData(response);
}

export async function deleteNetwork(chainType: ChainTypeNetwork, networkId: string): Promise<void> {
  const ct = chainType.toLowerCase();
  await apiDelete(`/networks/${ct}/${networkId}`);
}

export async function testNetwork(chainType: ChainTypeNetwork, payload: Omit<NetworkTestRequest, 'chain_type'>): Promise<NetworkTestResponse> {
  const ct = chainType.toLowerCase();
  const body: NetworkTestRequest = { ...payload, chain_type: chainType };
  const response = await apiPost<BackendResponse<NetworkTestResponse>, NetworkTestRequest>(
    `/networks/${ct}/test`,
    body
  );
  return extractData(response);
}

// ============================================================================
// Node APIs — parameterized by chain_type / network_id
// ============================================================================

export async function getNodes(chainType: ChainTypeNetwork, networkId: string): Promise<NodeConfig[]> {
  const ct = chainType.toLowerCase();
  const response = await apiGet<BackendResponse<NodeConfig[]>>(`/networks/${ct}/${networkId}/nodes`);
  return extractData(response);
}

export async function createNode(chainType: ChainTypeNetwork, networkId: string, payload: NodeCreate): Promise<NodeConfig> {
  const ct = chainType.toLowerCase();
  const response = await apiPost<BackendResponse<NodeConfig>, NodeCreate>(
    `/networks/${ct}/${networkId}/nodes`,
    payload
  );
  return extractData(response);
}

export async function getNode(nodeId: string): Promise<NodeConfig> {
  const response = await apiGet<BackendResponse<NodeConfig>>(`/networks/nodes/${nodeId}`);
  return extractData(response);
}

export async function updateNode(nodeId: string, payload: NodeUpdate): Promise<NodeConfig> {
  const response = await apiPut<BackendResponse<NodeConfig>, NodeUpdate>(
    `/networks/nodes/${nodeId}`,
    payload
  );
  return extractData(response);
}

export async function deleteNode(nodeId: string): Promise<void> {
  await apiDelete(`/networks/nodes/${nodeId}`);
}

export async function setDefaultNode(chainType: ChainTypeNetwork, networkId: string, payload: SetDefaultNodeRequest): Promise<void> {
  const ct = chainType.toLowerCase();
  await apiPost<void, SetDefaultNodeRequest>(
    `/networks/${ct}/${networkId}/default-node`,
    payload
  );
}

export async function testNode(nodeId: string): Promise<NodeTestResponse> {
  const response = await apiPost<BackendResponse<NodeTestResponse>, Record<string, never>>(
    `/networks/nodes/${nodeId}/test`,
    {}
  );
  return extractData(response);
}
