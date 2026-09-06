/**
 * Ensure an ISO-8601 date string is interpreted as UTC.
 * Backend returns naive UTC timestamps (e.g. "2026-02-14T10:11:04")
 * without a trailing "Z". Per ECMAScript spec, `new Date()` treats
 * these as **local time**, which silently shifts the value.
 * This helper appends "Z" when no timezone indicator is present.
 */
function ensureUtcString(s: string): string {
  // Already has timezone info: Z, +HH:MM, -HH:MM
  if (/Z|[+-]\d{2}:\d{2}$/.test(s)) return s;
  return s + "Z";
}

/**
 * Format a timestamp into a locale-aware absolute date-time string.
 * Uses Intl.DateTimeFormat so the output respects the user's locale and
 * an optional explicit timezone.
 */
export function formatAbsoluteTime(
  timestamp: string | Date,
  locale: string = "en",
  timeZone?: string,
): string {
  if (!timestamp) return "-";
  const date =
    typeof timestamp === "string"
      ? new Date(ensureUtcString(timestamp))
      : timestamp;
  if (Number.isNaN(date.getTime())) return "-";
  const intlLocale = locale === "zh-CN" ? "zh-CN" : "en";
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  };

  return new Intl.DateTimeFormat(intlLocale, opts).format(date);
}

/**
 * Format a timestamp into a human-readable relative time string.
 * Uses Intl.RelativeTimeFormat for locale-aware output.
 */
export function formatRelativeTime(
  timestamp: string,
  locale: string = "en"
): string {
  if (!timestamp) return "-";
  const date = new Date(ensureUtcString(timestamp));
  if (Number.isNaN(date.getTime())) return "-";

  const now = Date.now();
  const diffSeconds = Math.round((now - date.getTime()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat(
    locale === "zh-CN" ? "zh-CN" : "en",
    { numeric: "auto" }
  );

  if (absSeconds < 60) return rtf.format(-diffSeconds, "second");
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return rtf.format(-diffMinutes, "minute");
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(-diffHours, "hour");
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) return rtf.format(-diffDays, "day");
  const diffWeeks = Math.round(diffDays / 7);
  if (Math.abs(diffWeeks) < 4) return rtf.format(-diffWeeks, "week");
  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) return rtf.format(-diffMonths, "month");
  const diffYears = Math.round(diffDays / 365);
  return rtf.format(-diffYears, "year");
}

/**
 * Curated list of IANA timezones for the UI picker.
 * value: "auto" means browser-local; others are IANA identifiers.
 */
export const TIMEZONE_OPTIONS = [
  { value: "auto", labelKey: "settings.timezoneAuto" },
  { value: "UTC", label: "UTC (±0)" },
  { value: "America/New_York", label: "UTC-5 New York" },
  { value: "America/Chicago", label: "UTC-6 Chicago" },
  { value: "America/Denver", label: "UTC-7 Denver" },
  { value: "America/Los_Angeles", label: "UTC-8 Los Angeles" },
  { value: "America/Anchorage", label: "UTC-9 Anchorage" },
  { value: "Pacific/Honolulu", label: "UTC-10 Honolulu" },
  { value: "Europe/London", label: "UTC+0 London" },
  { value: "Europe/Berlin", label: "UTC+1 Berlin" },
  { value: "Europe/Moscow", label: "UTC+3 Moscow" },
  { value: "Asia/Dubai", label: "UTC+4 Dubai" },
  { value: "Asia/Kolkata", label: "UTC+5:30 Mumbai" },
  { value: "Asia/Bangkok", label: "UTC+7 Bangkok" },
  { value: "Asia/Shanghai", label: "UTC+8 Shanghai" },
  { value: "Asia/Tokyo", label: "UTC+9 Tokyo" },
  { value: "Australia/Sydney", label: "UTC+11 Sydney" },
  { value: "Pacific/Auckland", label: "UTC+12 Auckland" },
] as const;

/**
 * Resolve "auto" to undefined (let Intl use browser default),
 * or return the IANA string directly.
 */
export function resolveTimezone(tz: string): string | undefined {
  return tz === "auto" ? undefined : tz;
}
