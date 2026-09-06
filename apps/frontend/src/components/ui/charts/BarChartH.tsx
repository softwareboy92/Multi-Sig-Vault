import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const formatValue = (value: number) => new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
}).format(value);

export interface BarItem {
  name: string;
  value: number;
}

interface BarChartHProps {
  data: BarItem[];
  /** Chart height in px. Default 200. */
  height?: number;
  /** Bar color. Default indigo-500. */
  color?: string;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <div className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white shadow-lg dark:bg-gray-700">
      <p className="font-medium">{name}</p>
      <p>{formatValue(value)}</p>
    </div>
  );
}

export function BarChartH({ data, height = 200, color = '#6366f1' }: BarChartHProps) {
  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center text-sm text-gray-400"
        style={{ height }}
      >
        No data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickFormatter={(v: number) => formatValue(v)} fontSize={12} />
        <YAxis
          type="category"
          dataKey="name"
          width={100}
          fontSize={12}
          tickLine={false}
        />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
