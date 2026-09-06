export const queryKeys = {
  wallets: {
    all: ["wallets"] as const,
    list: (params?: Record<string, unknown>) =>
      ["wallets", "list", params] as const,
    detail: (id: string) => ["wallets", "detail", id] as const,
    assets: (id: string) => ["wallets", "detail", id, "assets"] as const,
    transactions: (id: string) =>
      ["wallets", "detail", id, "transactions"] as const,
    nonceQueue: (id: string) =>
      ["wallets", "detail", id, "nonce-queue"] as const,
  },
  signers: {
    all: ["signers"] as const,
    list: () => ["signers", "list"] as const,
    detail: (id: string) => ["signers", "detail", id] as const,
  },
  assets: {
    all: ["assets"] as const,
    list: () => ["assets", "list"] as const,
    detail: (groupKey: string) => ["assets", "detail", groupKey] as const,
  },
  transactions: {
    all: ["transactions"] as const,
    list: (walletId?: string) =>
      ["transactions", "list", walletId] as const,
    detail: (id: string) => ["transactions", "detail", id] as const,
  },
  networks: {
    all: ["networks"] as const,
    byChain: (chain: string) => ["networks", chain] as const,
  },
} as const;
