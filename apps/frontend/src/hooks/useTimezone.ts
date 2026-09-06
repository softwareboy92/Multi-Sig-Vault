import { usePreferenceStore } from "../stores/usePreferenceStore";
import { resolveTimezone } from "../utils/time";

/**
 * Returns the resolved IANA timezone string (or undefined for browser-local).
 * Components that display formatted times should use this hook.
 */
export function useTimezone(): string | undefined {
  const timezone = usePreferenceStore((s) => s.timezone);
  return resolveTimezone(timezone);
}
