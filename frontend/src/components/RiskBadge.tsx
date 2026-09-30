import { useEffect, useRef, useState } from "react";
import type { RiskCategory } from "../api/types";

export const riskColor = (category: RiskCategory | null | undefined): string => {
  if (!category) return "#475569"; // slate — "no data"
  const hex: Record<RiskCategory, string> = {
    Low: "#10b981",
    Moderate: "#eab308",
    Elevated: "#f59e0b",
    High: "#fb923c",
    Critical: "#ef4444",
  };
  return hex[category];
};

/** Score → color ramp shared by map, gauges, charts (pure presentation). */
export function scoreColor(score: number): string {
  const stops: [number, [number, number, number]][] = [
    [0, [16, 185, 129]],
    [40, [234, 179, 8]],
    [60, [245, 158, 11]],
    [80, [251, 146, 60]],
    [100, [239, 68, 68]],
  ];
  const s = Math.max(0, Math.min(100, score));
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (s <= b) {
      const t = (s - a) / (b - a);
      const c = ca.map((v, j) => Math.round(v + (cb[j] - v) * t));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return "rgb(239,68,68)";
}

export const CATEGORY_HEX: Record<RiskCategory | "NO_DATA", string> = {
  Low: "#10b981",
  Moderate: "#eab308",
  Elevated: "#f59e0b",
  High: "#fb923c",
  Critical: "#ef4444",
  NO_DATA: "#475569",
};

const STYLES: Record<RiskCategory, string> = {
  Low: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  Moderate: "bg-yellow-500/15 text-yellow-300 border-yellow-500/40",
  Elevated: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  High: "bg-orange-500/15 text-orange-300 border-orange-500/40",
  Critical: "bg-red-500/15 text-red-300 border-red-500/50",
};

export default function RiskBadge({
  category,
  score,
}: {
  category: RiskCategory | null;
  score?: number | null;
}) {
  if (!category) {
    return (
      <span className="inline-flex items-center rounded-full border border-slate-600/70 bg-slate-800/60 px-2.5 py-0.5 text-xs font-medium text-slate-400">
        No data
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STYLES[category]}`}>
      {category}
      {score !== undefined && score !== null && <span className="opacity-70">· {score.toFixed(1)}</span>}
    </span>
  );
}

/** Subtle glow ring that flashes once when the incoming value changes (SSE update cue). */
export function FlashOnChange({
  value,
  children,
  className = "",
  threshold = 0.05,
}: {
  value: number;
  children: React.ReactNode;
  className?: string;
  threshold?: number;
}) {
  const prev = useRef(value);
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    if (Math.abs(value - prev.current) >= threshold) {
      prev.current = value;
      setFlashKey((k) => k + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span key={flashKey} className={`data-flash rounded-lg ${className}`} data-flash-key={flashKey}>
      {children}
    </span>
  );
}
