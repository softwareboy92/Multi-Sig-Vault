import { apiPost, extractData } from "./client";
import type { PriceProvider } from "../stores/usePreferenceStore";

export interface AssetPriceRequest {
  chain_type: "EVM" | "BTC";
  chain_id?: number | null;
  token_address?: string | null;
  symbol: string;
}

export interface PriceInfo {
  usd: number;
  confidence?: number | null;
  updated_at?: string | null;
}

export interface BatchPriceResponse {
  prices: Record<string, PriceInfo>;
  currency: "USD";
  stale: boolean;
  provider: PriceProvider;
}

export async function getBatchPrices(
  assets: AssetPriceRequest[],
  provider: PriceProvider,
): Promise<BatchPriceResponse> {
  if (assets.length === 0) {
    return { prices: {}, currency: "USD", stale: false, provider };
  }
  const response = await apiPost<{ success: boolean; data: BatchPriceResponse }>(
    "/prices/batch",
    { assets, provider },
  );
  return extractData(response);
}
