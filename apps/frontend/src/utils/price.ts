export function formatUsd(value: number, language?: string): string {
  return new Intl.NumberFormat(language || undefined, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: value > 0 && value < 1 ? 2 : 2,
    maximumFractionDigits: value > 0 && value < 1 ? 6 : 2,
  }).format(value);
}

export function atomicToNumber(value: string, decimals: number): number {
  if (!value) return 0;
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals || undefined) || "0";
  const fraction = decimals ? padded.slice(-decimals) : "";
  const result = Number(`${whole}${fraction ? `.${fraction}` : ""}`);
  return negative ? -result : result;
}
