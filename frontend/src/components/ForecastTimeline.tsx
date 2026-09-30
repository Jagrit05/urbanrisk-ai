import { useEffect, useState } from "react";
import type { PredictionResult } from "../api/types";
import { scoreColor } from "./RiskBadge";
import { contributors } from "../lib/riskStory";

const LABELS: Record<number, string> = { 0: "NOW", 6: "+6h", 12: "+12h", 24: "+24h" };

interface Step {
  label: string;
  hours: number;
  result: PredictionResult | null;
}

/**
 * Playback-style visualization of the real 6/12/24h model forecasts (the NOW
 * point is the zone's current SSE reading). Auto-play walks the timeline so a
 * viewer literally watches how risk is expected to move.
 */
export default function ForecastTimeline({
  now,
  forecasts,
  height = 180,
}: {
  now: PredictionResult | null;
  forecasts: PredictionResult[];
  height?: number;
}) {
  const steps: Step[] = [
    { label: LABELS[0], hours: 0, result: now },
    ...forecasts.map((f) => ({ label: LABELS[f.aqi_horizon_hours] ?? `+${f.aqi_horizon_hours}h`, hours: f.aqi_horizon_hours, result: f })),
  ];
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => setIdx(0), [now?.zone_id]);

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      setIdx((i) => {
        if (i >= steps.length - 1) return 0;
        return i + 1;
      });
    }, 1600);
    return () => window.clearInterval(t);
  }, [playing, steps.length]);

  const current = steps[idx]?.result ?? null;
  const next = steps[Math.min(idx + 1, steps.length - 1)]?.result ?? null;
  const trendUp = current && next ? next.urban_risk_score > current.urban_risk_score + 0.05 : false;
  const trendDown = current && next ? next.urban_risk_score < current.urban_risk_score - 0.05 : false;

  return (
    <div className="glass p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">What happens next</h3>
          <p className="text-[11px] text-slate-500">Real model forecasts for the next 24 hours</p>
        </div>
        <button
          onClick={() => setPlaying((p) => !p)}
          className={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold tracking-wide transition-colors ${
            playing
              ? "border-sky-400/50 bg-sky-500/15 text-sky-200"
              : "border-slate-700/70 bg-slate-900/60 text-slate-300 hover:border-sky-400/40 hover:text-sky-300"
          }`}
        >
          {playing ? "⏸ Pause" : "▶ Play forecast"}
        </button>
      </div>

      {/* animated rail */}
      <div className="relative mx-2 mb-4 h-1.5 rounded-full bg-slate-800/80">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${(idx / Math.max(1, steps.length - 1)) * 100}%`,
            background: current ? `linear-gradient(90deg, ${scoreColor(steps[0].result?.urban_risk_score ?? 0)}, ${scoreColor(current.urban_risk_score)})` : "#334155",
          }}
        />
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950 shadow-lg transition-all duration-500"
          style={{
            left: `${(idx / Math.max(1, steps.length - 1)) * 100}%`,
            background: current ? scoreColor(current.urban_risk_score) : "#334155",
          }}
        />
      </div>

      {/* step cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((s, i) => {
          const active = i === idx;
          const score = s.result?.urban_risk_score ?? null;
          return (
            <button
              key={s.label}
              onClick={() => { setIdx(i); setPlaying(false); }}
              className={`rounded-xl border px-3 py-2.5 text-left transition-all duration-300 ${
                active ? "border-sky-400/50 bg-sky-500/10 shadow-[0_0_24px_-8px_rgba(56,189,248,0.5)]" : "border-slate-800/70 bg-slate-900/40 hover:border-slate-600"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-bold tracking-[0.14em] ${active ? "text-sky-300" : "text-slate-500"}`}>{s.label}</span>
                {score !== null && (
                  <span className="h-2 w-2 rounded-full" style={{ background: scoreColor(score), boxShadow: `0 0 8px ${scoreColor(score)}88` }} />
                )}
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-xl font-bold tabular-nums" style={{ color: score !== null ? scoreColor(score) : "#475569" }}>
                  {score !== null ? score.toFixed(1) : "—"}
                </span>
                {s.result && <span className="text-[10px] text-slate-500">{s.result.risk_category}</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* current step detail */}
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-xl border border-slate-800/70 bg-slate-950/50 px-4 py-2.5 text-[11px]">
        {current ? (
          <>
            <span className="font-semibold text-slate-200">{steps[idx].label}</span>
            <span className="text-slate-400">Urban risk <b className="tabular-nums text-slate-100">{current.urban_risk_score.toFixed(1)}</b> ({current.risk_category})</span>
            <span className="text-slate-400">AQI <b className="tabular-nums text-slate-100">{current.predicted_aqi.toFixed(0)}</b></span>
            <span className="text-slate-400">Flood <b className="tabular-nums text-slate-100">{(current.flood_probability * 100).toFixed(0)}%</b></span>
            <span className="text-slate-400">Traffic <b className="tabular-nums text-slate-100">{(current.traffic_probability * 100).toFixed(0)}%</b></span>
            {idx < steps.length - 1 && (trendUp || trendDown) && (
              <span className={trendUp ? "font-semibold text-red-300" : "font-semibold text-emerald-300"}>
                {trendUp ? "↗ risk rising" : "↘ risk easing"}
              </span>
            )}
            {current !== now && (
              <span className="text-slate-600">
                main driver: {contributors(current)[0].icon} {contributors(current)[0].label.toLowerCase()}
              </span>
            )}
          </>
        ) : (
          <span className="text-slate-500">No live observation for this zone yet — forecasts are unavailable until data arrives.</span>
        )}
      </div>
    </div>
  );
}
