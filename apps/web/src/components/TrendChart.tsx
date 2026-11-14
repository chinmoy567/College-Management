'use client';

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface TrendPoint { label: string; you: number | null; section: number | null }

/** Loaded lazily (next/dynamic) so Recharts stays out of the main bundle. Animation is off. */
export default function TrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="h-64 w-full" data-testid="trend-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
          <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="you" name="You" stroke="#4f46e5" strokeWidth={2} dot isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="section" name="Section average" stroke="#64748b" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
