// ═══════════════════════════════════════════════════════════════════════════
// Chain Registry Service — chainid.network auto-fill for NetworkForm
// ═══════════════════════════════════════════════════════════════════════════

const CHAINS_URL = 'https://chainid.network/chains.json';

export interface ChainInfo {
  chainId: number;
  name: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpc?: string[];
  explorers?: {
    name: string;
    url: string;
    standard: string;
  }[];
}

let cache: Map<number, ChainInfo> | null = null;

/**
 * Lookup chain metadata from chainid.network registry.
 * Fetches the full registry on first call and caches in memory.
 * Returns null on fetch failure or if chain not found.
 */
export async function lookupChain(chainId: number): Promise<ChainInfo | null> {
  if (!cache) {
    try {
      const resp = await fetch(CHAINS_URL);
      if (!resp.ok) return null;
      const chains: ChainInfo[] = await resp.json();
      cache = new Map(chains.map((c) => [c.chainId, c]));
    } catch {
      return null;
    }
  }
  return cache.get(chainId) ?? null;
}

/**
 * Get all chains from the registry (fetches on first call).
 * Returns empty array on failure.
 */
export async function getAllChains(): Promise<ChainInfo[]> {
  if (!cache) {
    // Trigger cache population via lookupChain
    await lookupChain(1);
  }
  return cache ? Array.from(cache.values()) : [];
}

// Safe v1.4.1 deterministic singleton address (identical across all chains)
const SAFE_V141_SINGLETON = '0x41675C099F32341bf84BFc5382aF534df5C7461a';

export type SafeDeploymentStatus = 'deployed' | 'not-deployed' | 'unknown';

/**
 * Check whether Safe v1.4.1 contracts are deployed on a given chain
 * by calling eth_getCode on the singleton address via public RPCs
 * from the chainid.network registry.
 */
export async function checkSafeDeployment(
  chainId: number,
  signal?: AbortSignal,
): Promise<SafeDeploymentStatus> {
  const chain = await lookupChain(chainId);
  const rpcs = chain?.rpc?.filter(
    (u) => u.startsWith('https://') && !u.includes('${'),
  );
  if (!rpcs?.length) return 'unknown';

  // Try up to 3 public RPCs
  for (const rpc of rpcs.slice(0, 3)) {
    try {
      const resp = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getCode',
          params: [SAFE_V141_SINGLETON, 'latest'],
          id: 1,
        }),
        signal: signal ?? AbortSignal.timeout(8000),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data?.error) continue;
      const code = data?.result;
      if (typeof code !== 'string') continue;
      if (code === '0x' || code === '0x0') return 'not-deployed';
      return 'deployed';
    } catch {
      continue;
    }
  }
  return 'unknown';
}

/**
 * Normalize an RPC URL for dedup comparison:
 * lowercase hostname, strip default ports, strip trailing root slash.
 */
export function normalizeRpcUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.toLowerCase();
    if ((u.protocol === 'https:' && u.port === '443') ||
        (u.protocol === 'http:' && u.port === '80')) {
      u.port = '';
    }
    if (u.pathname === '/') u.pathname = '';
    return u.toString();
  } catch {
    return url.toLowerCase();
  }
}

// Well-known free RPC providers, ordered by reliability.
const RPC_PROVIDER_PRIORITY: string[] = [
  'publicnode.com',
  '1rpc.io',
  'ankr.com',
  'llamarpc.com',
  'drpc.org',
];

/**
 * Get filtered and ranked public RPC URLs for a given chain.
 * Reads from the in-memory cache (call lookupChain first to warm it).
 * Returns at most 5 URLs. Returns [] if cache not loaded or no matches.
 */
export function getPublicRpcs(chainId: number): string[] {
  if (!cache) return [];
  const chain = cache.get(chainId);
  if (!chain?.rpc) return [];

  const filtered = chain.rpc.filter((url) => {
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
    if (url.includes('${')) return false;
    if (url.toUpperCase().includes('API_KEY')) return false;
    return true;
  });

  // Sort: known providers first (by priority index), then original order.
  const sorted = [...filtered].sort((a, b) => {
    const aIdx = RPC_PROVIDER_PRIORITY.findIndex((p) => a.includes(p));
    const bIdx = RPC_PROVIDER_PRIORITY.findIndex((p) => b.includes(p));
    const aPri = aIdx === -1 ? RPC_PROVIDER_PRIORITY.length : aIdx;
    const bPri = bIdx === -1 ? RPC_PROVIDER_PRIORITY.length : bIdx;
    return aPri - bPri;
  });

  return sorted.slice(0, 5);
}
