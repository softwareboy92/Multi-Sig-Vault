/**
 * Parse and build Electrum-style endpoint URLs (ssl:// or tcp://).
 *
 * Backend stores BTC Electrum node addresses as a single endpoint_url string:
 *   "ssl://electrum.example.com:50002"
 *   "tcp://electrum.example.com:50001"
 *
 * The frontend needs to decompose this for display and re-compose when
 * creating/updating nodes.
 */

export interface ElectrumParts {
  host: string;
  port: number;
  ssl: boolean;
}

const ELECTRUM_RE = /^(ssl|tcp):\/\/([^:/?#]+):(\d+)$/i;

/**
 * Decompose an endpoint_url like "ssl://host:port" into its parts.
 * Returns null if the URL does not match the expected pattern.
 */
export function parseElectrumUrl(url: string): ElectrumParts | null {
  const m = ELECTRUM_RE.exec(url.trim());
  if (!m) return null;
  return {
    ssl: m[1].toLowerCase() === 'ssl',
    host: m[2],
    port: parseInt(m[3], 10),
  };
}

/**
 * Build an endpoint_url from host/port/ssl parts.
 */
export function buildElectrumUrl(parts: ElectrumParts): string {
  const scheme = parts.ssl ? 'ssl' : 'tcp';
  return `${scheme}://${parts.host}:${parts.port}`;
}

/**
 * Format an endpoint_url for human-readable display.
 * For Electrum URLs: "host:port (SSL)" or "host:port"
 * For other URLs: return as-is.
 */
export function formatElectrumUrl(url: string): string {
  const parsed = parseElectrumUrl(url);
  if (!parsed) return url;
  const suffix = parsed.ssl ? ' (SSL)' : '';
  return `${parsed.host}:${parsed.port}${suffix}`;
}
