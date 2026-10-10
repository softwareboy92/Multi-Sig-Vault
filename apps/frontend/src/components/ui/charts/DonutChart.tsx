import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

const formatValue = (value: number) => new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
}).format(value);

// 8-color palette for asset slices
const COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#f97316',
  '#14b8a6',
];

export interface DonutSlice {
  name: string;
  value: number;
}

interface DonutChartProps {
  data: DonutSlice[];
  /** Optional total shown in the center. */
  total?: number;
  /** Chart size in px. Default 200. */
  size?: number;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--overlay-bg)] px-3 py-2 text-sm text-[var(--text)] shadow-lg">
      <p className="font-medium">{name}</p>
      <p>{formatValue(value)}</p>
    </div>
  );
}

export function DonutChart({ data, total, size = 200 }: DonutChartProps) {
  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center text-sm text-[var(--muted)]"
        style={{ width: size, height: size }}
      >
        No data
      </div>
    );
  }

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius="60%"
            outerRadius="85%"
            dataKey="value"
            stroke="none"
          >
            {data.map((_entry, index) => (
              <Cell key={index} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      {total != null && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xs text-[var(--muted)]">Total</span>
          <span className="text-sm font-semibold text-[var(--text)]">
            {formatValue(total)}
          </span>
        </div>
      )}
    </div>
  );
}
