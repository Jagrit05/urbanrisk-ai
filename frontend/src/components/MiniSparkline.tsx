import { useMemo } from "react";

export interface HistoryPoint {
  score: number;
}

/**
 * Keeps the last `max` per-zone urban risk readings the frontend has actually
 * received (SSE frames or fallback polls). Nothing here is synthesized: if the
 * stream has only sent one frame so far, the sparkline shows that single point.
 */
export function useZoneHistory(zones: { zone_id: string; urban_risk_score: number }[], max = 40) {
  const store = useMemo(() => new Map<string, number[]>(), []);
  const seen = useMemo(() => new Map<string, string>(), []);
  return { store, seen, max };
}

export default function MiniSparkline({
  values,
  color = "#38bdf8",
  width = 96,
  height = 28,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
}) {
  const vals = values.length ? values : [];
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 100);
  const range = max - min || 1;
  const step = vals.length > 1 ? width / (vals.length - 1) : 0;
  const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * (height - 4) - 2).toFixed(1)}`).join(" ");
  const last = vals.length ? vals[vals.length - 1] : null;

  return (
    <svg width={width} height={height} className="overflow-visible">
      {vals.length > 1 && (
        <>
          <polyline
            points={pts}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.9}
          />
          <circle cx={(vals.length - 1) * step} cy={height - ((last! - min) / range) * (height - 4) - 2} r={2.5} fill={color} />
        </>
      )}
      {vals.length <= 1 && (
        <circle cx={width / 2} cy={height / 2} r={2.5} fill={color} opacity={0.9} />
      )}
    </svg>
  );
}
