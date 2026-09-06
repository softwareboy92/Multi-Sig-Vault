import { formatAbsoluteTime } from "../../../utils/time";
import { useLanguageStore } from "../../../stores/useLanguageStore";
import { useTimezone } from "../../../hooks/useTimezone";

interface HealthBadgeProps {
  isHealthy: boolean;
  lastHealthCheck?: string | null;
  size?: 'sm' | 'md';
}

export function HealthBadge({ isHealthy, lastHealthCheck, size = 'md' }: HealthBadgeProps) {
  const { language } = useLanguageStore();
  const timeZone = useTimezone();
  const sizeClasses = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';
  const iconSize = size === 'sm' ? 12 : 14;

  if (isHealthy) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-[var(--success)]/10 text-[var(--success)] font-medium ${sizeClasses}`}
      >
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        <span>Healthy</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-[var(--danger)]/10 text-[var(--danger)] font-medium ${sizeClasses}`}
      title={lastHealthCheck ? `Last checked: ${formatAbsoluteTime(lastHealthCheck, language, timeZone)}` : 'Not checked'}
    >
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
      <span>Unhealthy</span>
      {lastHealthCheck && (
        <svg width={iconSize - 2} height={iconSize - 2} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-0.5 opacity-70">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      )}
    </span>
  );
}
