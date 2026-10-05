import { useEffect, useMemo, useState } from "react";
import { getBatchPrices, type AssetPriceRequest, type PriceInfo } from "../api/prices";
import { usePreferenceStore } from "../stores/usePreferenceStore";

export function useAssetPrices(assets: AssetPriceRequest[]) {
  const provider = usePreferenceStore((state) => state.priceProvider);
  const [prices, setPrices] = useState<Record<string, PriceInfo>>({});
  const [stale, setStale] = useState(false);
  const [resolvedRequest, setResolvedRequest] = useState("");
  const key = useMemo(
    () => JSON.stringify(assets.map((asset) => ({ ...asset, symbol: asset.symbol.toUpperCase() }))),
    [assets],
  );

  useEffect(() => {
    const normalized = JSON.parse(key) as AssetPriceRequest[];
    if (!normalized.length) {
      return;
    }
    let cancelled = false;
    void getBatchPrices(normalized, provider)
      .then((result) => {
        if (!cancelled) {
          setPrices(result.prices);
          setStale(result.stale);
          setResolvedRequest(`${provider}:${key}`);
        }
      })
      .catch(() => {
        if (!cancelled) setPrices({});
      })
    return () => { cancelled = true; };
  }, [key, provider]);

  const isCurrent = resolvedRequest === `${provider}:${key}`;
  return { prices: assets.length && isCurrent ? prices : {}, stale: isCurrent && stale, provider };
}
