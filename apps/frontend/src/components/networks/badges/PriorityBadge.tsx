interface PriorityBadgeProps {
  priority: number;
  size?: 'sm' | 'md';
}

export function PriorityBadge({ priority, size = 'md' }: PriorityBadgeProps) {
  const sizeClasses = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';

  let colorClasses = 'bg-[var(--row-head-bg)] text-[var(--muted)]';
  if (priority >= 800) {
    colorClasses = 'bg-[var(--accent)]/10 text-[var(--accent)]';
  } else if (priority >= 600) {
    colorClasses = 'bg-[var(--info)]/10 text-[var(--info)]';
  } else if (priority >= 400) {
    colorClasses = 'bg-[var(--success)]/10 text-[var(--success)]';
  } else if (priority >= 200) {
    colorClasses = 'bg-[var(--warning)]/10 text-[var(--warning)]';
  }

  return (
    <span className={`inline-flex items-center rounded-full font-medium ${sizeClasses} ${colorClasses}`}>
      Priority: {priority}
    </span>
  );
}
