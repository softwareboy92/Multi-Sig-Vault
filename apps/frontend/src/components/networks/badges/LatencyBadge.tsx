interface LatencyBadgeProps {
  latencyMs: number;
  size?: 'sm' | 'md';
}

/**
 * Displays network latency with color-coded severity:
 * - green (success): < 200ms
 * - yellow (warning): 200–500ms
 * - red (danger): > 500ms
 */
export function LatencyBadge({ latencyMs, size = 'md' }: LatencyBadgeProps) {
  const sizeClasses = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';
  const iconSize = size === 'sm' ? 10 : 12;

  let colorVar: string;
  if (latencyMs < 200) {
    colorVar = '--success';
  } else if (latencyMs < 500) {
    colorVar = '--warning';
  } else {
    colorVar = '--danger';
  }

  const formatted = latencyMs < 1000
    ? `${Math.round(latencyMs)} ms`
    : `${(latencyMs / 1000).toFixed(1)} s`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${sizeClasses}`}
      style={{
        backgroundColor: `color-mix(in srgb, var(${colorVar}) 12%, transparent)`,
        color: `var(${colorVar})`,
      }}
      title={`Latency: ${latencyMs.toFixed(1)} ms`}
    >
      {/* Signal / Activity icon */}
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
      <span>{formatted}</span>
    </span>
  );
}
