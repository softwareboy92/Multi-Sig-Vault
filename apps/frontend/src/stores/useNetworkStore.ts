import { create } from 'zustand';
import type {
  ChainTypeNetwork,
  NetworkConfig,
  NetworkCreate,
  NetworkUpdate,
  NodeConfig,
  NodeCreate,
  NodeUpdate,
  NodeTestResponse,
} from '../types';
import * as networkApi from '../api/networks';

interface NetworkState {
  /** Networks keyed by chain type. */
  networks: Partial<Record<ChainTypeNetwork, NetworkConfig[]>>;
  /** Nodes keyed by network ID. */
  nodes: Record<string, NodeConfig[]>;
  /** Loading flags per chain type. */
  loadingNetworks: Partial<Record<ChainTypeNetwork, boolean>>;
  /** Loading flags per network ID (for nodes). */
  loadingNodes: Record<string, boolean>;
  /** Latest test results keyed by node ID (latency_ms, success). */
  nodeTestResults: Record<string, NodeTestResponse>;

  // Network actions
  fetchNetworks: (chainType: ChainTypeNetwork) => Promise<void>;
  fetchNetwork: (chainType: ChainTypeNetwork, networkId: string) => Promise<NetworkConfig>;
  createNetwork: (chainType: ChainTypeNetwork, data: Omit<NetworkCreate, 'chain_type'>) => Promise<NetworkConfig>;
  updateNetwork: (chainType: ChainTypeNetwork, networkId: string, data: NetworkUpdate) => Promise<NetworkConfig>;
  deleteNetwork: (chainType: ChainTypeNetwork, networkId: string) => Promise<void>;

  // Node actions
  fetchNodes: (chainType: ChainTypeNetwork, networkId: string) => Promise<void>;
  createNode: (chainType: ChainTypeNetwork, networkId: string, data: NodeCreate) => Promise<NodeConfig>;
  updateNode: (nodeId: string, data: NodeUpdate) => Promise<NodeConfig>;
  deleteNode: (networkId: string, nodeId: string) => Promise<void>;
  setDefaultNode: (chainType: ChainTypeNetwork, networkId: string, nodeId: string) => Promise<void>;
  testNode: (chainType: ChainTypeNetwork, networkId: string, nodeId: string) => Promise<NodeTestResponse>;

  // Legacy convenience getters (for incremental migration)
  evmNetworks: NetworkConfig[];
  btcNetworks: NetworkConfig[];
  evmRpcNodes: Record<string, NodeConfig[]>;
  btcNodes: Record<string, NodeConfig[]>;
  loadingEvmNetworks: boolean;
  loadingBtcNetworks: boolean;
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
  // Initial state
  networks: {},
  nodes: {},
  loadingNetworks: {},
  loadingNodes: {},
  nodeTestResults: {},

  // Legacy convenience getters
  get evmNetworks() { return get().networks.EVM ?? []; },
  get btcNetworks() { return get().networks.BTC ?? []; },
  get evmRpcNodes() {
    const evmIds = new Set((get().networks.EVM ?? []).map((n) => n.id));
    const result: Record<string, NodeConfig[]> = {};
    for (const [k, v] of Object.entries(get().nodes)) {
      if (evmIds.has(k)) result[k] = v;
    }
    return result;
  },
  get btcNodes() {
    const btcIds = new Set((get().networks.BTC ?? []).map((n) => n.id));
    const result: Record<string, NodeConfig[]> = {};
    for (const [k, v] of Object.entries(get().nodes)) {
      if (btcIds.has(k)) result[k] = v;
    }
    return result;
  },
  get loadingEvmNetworks() { return get().loadingNetworks.EVM ?? false; },
  get loadingBtcNetworks() { return get().loadingNetworks.BTC ?? false; },

  // ============================================================================
  // Network Actions
  // ============================================================================

  fetchNetworks: async (chainType) => {
    set((state) => ({
      loadingNetworks: { ...state.loadingNetworks, [chainType]: true },
    }));
    try {
      const list = await networkApi.getNetworks(chainType);
      set((state) => ({
        networks: { ...state.networks, [chainType]: list },
      }));
    } finally {
      set((state) => ({
        loadingNetworks: { ...state.loadingNetworks, [chainType]: false },
      }));
    }
  },

  fetchNetwork: async (chainType, networkId) => {
    const network = await networkApi.getNetwork(chainType, networkId);
    set((state) => {
      const list = state.networks[chainType] ?? [];
      return {
        networks: {
          ...state.networks,
          [chainType]: list.map((n) => (n.id === networkId ? network : n)),
        },
      };
    });
    return network;
  },

  createNetwork: async (chainType, data) => {
    const network = await networkApi.createNetwork(chainType, data);
    set((state) => ({
      networks: {
        ...state.networks,
        [chainType]: [...(state.networks[chainType] ?? []), network],
      },
    }));
    return network;
  },

  updateNetwork: async (chainType, networkId, data) => {
    const network = await networkApi.updateNetwork(chainType, networkId, data);
    set((state) => {
      const list = state.networks[chainType] ?? [];
      return {
        networks: {
          ...state.networks,
          [chainType]: list.map((n) => (n.id === networkId ? network : n)),
        },
      };
    });
    return network;
  },

  deleteNetwork: async (chainType, networkId) => {
    await networkApi.deleteNetwork(chainType, networkId);
    set((state) => {
      const list = state.networks[chainType] ?? [];
      const newNodes = { ...state.nodes };
      delete newNodes[networkId];
      return {
        networks: {
          ...state.networks,
          [chainType]: list.filter((n) => n.id !== networkId),
        },
        nodes: newNodes,
      };
    });
  },

  // ============================================================================
  // Node Actions
  // ============================================================================

  fetchNodes: async (chainType, networkId) => {
    set((state) => ({
      loadingNodes: { ...state.loadingNodes, [networkId]: true },
    }));
    try {
      const list = await networkApi.getNodes(chainType, networkId);
      set((state) => ({
        nodes: { ...state.nodes, [networkId]: list },
      }));
    } finally {
      set((state) => ({
        loadingNodes: { ...state.loadingNodes, [networkId]: false },
      }));
    }
  },

  createNode: async (chainType, networkId, data) => {
    const node = await networkApi.createNode(chainType, networkId, data);
    set((state) => ({
      nodes: {
        ...state.nodes,
        [networkId]: [...(state.nodes[networkId] ?? []), node],
      },
    }));
    return node;
  },

  updateNode: async (nodeId, data) => {
    const node = await networkApi.updateNode(nodeId, data);
    // Update in the correct network bucket
    set((state) => {
      const newNodes = { ...state.nodes };
      for (const [nid, list] of Object.entries(newNodes)) {
        const idx = list.findIndex((n) => n.id === nodeId);
        if (idx >= 0) {
          newNodes[nid] = list.map((n) => (n.id === nodeId ? node : n));
          break;
        }
      }
      return { nodes: newNodes };
    });
    return node;
  },

  deleteNode: async (networkId, nodeId) => {
    await networkApi.deleteNode(nodeId);
    set((state) => ({
      nodes: {
        ...state.nodes,
        [networkId]: (state.nodes[networkId] ?? []).filter((n) => n.id !== nodeId),
      },
    }));
  },

  setDefaultNode: async (chainType, networkId, nodeId) => {
    await networkApi.setDefaultNode(chainType, networkId, { node_id: nodeId });
    // Refresh network to get updated default_node_id
    await get().fetchNetwork(chainType, networkId);
  },

  testNode: async (chainType, networkId, nodeId) => {
    const result = await networkApi.testNode(nodeId);
    // Persist latency result in store
    set((state) => ({
      nodeTestResults: { ...state.nodeTestResults, [nodeId]: result },
    }));
    // Refresh nodes to get updated health status
    await get().fetchNodes(chainType, networkId);
    return result;
  },
}));
