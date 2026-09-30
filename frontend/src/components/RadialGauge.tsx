import { useEffect, useState } from "react";
import type { RiskCategory } from "../api/types";
import { riskColor } from "./RiskBadge";

/**
 * Animates the displayed number counting toward `target` rather than jumping —
 * but the target value itself is always whatever the API/SSE actually reported.
 */
export function useCountUp(target: number, durationMs = 600) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const from = value;
    let raf: number;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return value;
}

export default function RadialGauge({
  score,
  category,
  size = 180,
  label,
  accent,
  suffix,
}: {
  score: number;
  category?: RiskCategory;
  size?: number;
  label?: string;
  accent?: string;
  suffix?: string;
}) {
  const animated = useCountUp(score);
  const pct = Math.max(0, Math.min(100, animated)) / 100;
  const color = accent ?? riskColor(category);
  const numSize = Math.round(size * 0.21);

  return (
    <div className="relative inline-flex flex-col items-center" style={{ width: size }}>
      <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 180 180" className="-rotate-90">
          <circle cx={90} cy={90} r={70} fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth={10} />
          <circle
            cx={90}
            cy={90}
            r={70}
            fill="none"
            stroke={color}
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 70}
            strokeDashoffset={2 * Math.PI * 70 * (1 - pct)}
            style={{
              transition: "stroke 300ms ease, stroke-dashoffset 500ms ease",
              filter: `drop-shadow(0 0 6px ${color}66)`,
            }}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="font-bold text-white tabular-nums leading-none" style={{ fontSize: numSize }}>
            {animated.toFixed(1)}
            {suffix && <span className="ml-0.5 text-[0.5em] text-slate-400">{suffix}</span>}
          </span>
          {category && (
            <span
              className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{ color }}
            >
              {category}
            </span>
          )}
        </div>
      </div>
      {label && <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>}
    </div>
  );
}
