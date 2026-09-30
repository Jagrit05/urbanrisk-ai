import { useState } from "react";
import { Link } from "react-router-dom";
import type { DashboardZone } from "../api/types";
import RadialGauge from "./RadialGauge";
import RiskBadge, { scoreColor } from "./RiskBadge";
import LiveStatusBadge from "./LiveStatusBadge";
import MiniSparkline from "./MiniSparkline";
import { contributors, zoneWatchReason } from "../lib/riskStory";

const SIGNAL_META = [
  { key: "aqi", label: "Air quality", accent: "#38bdf8", suffix: "" },
  { key: "flood", label: "Flood", accent: "#818cf8", suffix: "%" },
  { key: "traffic", label: "Traffic", accent: "#fb923c", suffix: "%" },
] as const;

export default function RiskDetailPanel({
  zone,
  history,
  onClose,
}: {
  zone: DashboardZone;
  history: number[];
  onClose: () => void;
}) {
  const [showTech, setShowTech] = useState(false);
  const contribs = contributors(zone);

  return (
    <aside
      className="glass absolute right-3 top-3 z-[600] flex max-h-[calc(100%-1.5rem)] w-[320px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden"
      role="dialog"
      aria-label={`${zone.zone_name} risk detail`}
    >
      <div className="flex items-start justify-between border-b border-slate-800/70 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">{zone.zone_name}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-500">{zone.zone_id}</div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="rounded-md border border-slate-700/60 px-1.5 text-slate-400 transition-colors hover:border-sky-400/50 hover:text-sky-300"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="flex items-center gap-4">
          <RadialGauge score={zone.urban_risk_score} category={zone.risk_category} size={110} />
          <div className="min-w-0 flex-1 space-y-2">
            <RiskBadge category={zone.risk_category} score={zone.urban_risk_score} />
            <LiveStatusBadge status={zone.status} ageMinutes={zone.age_minutes} />
            <div className="text-[11px] text-slate-500">
              Updated {new Date(zone.observed_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST
            </div>
          </div>
        </div>

        <p className="rounded-lg border border-slate-800/70 bg-slate-900/40 px-3 py-2 text-xs leading-relaxed text-slate-300">
          {zoneWatchReason(zone)}
        </p>

        {/* three animated gauges */}
        <div className="grid grid-cols-3 gap-2">
          {SIGNAL_META.map((s) => {
            const v = s.key === "aqi" ? zone.aqi_risk : s.key === "flood" ? zone.flood_risk : zone.traffic_risk;
            return (
              <div key={s.key} className="flex flex-col items-center rounded-lg border border-slate-800/60 bg-slate-900/40 py-2" title={`${s.label} risk: ${v.toFixed(1)}${s.suffix}`}>
                <RadialGauge score={v} size={64} accent={s.accent} suffix={s.suffix} />
                <span className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">{s.label}</span>
              </div>
            );
          })}
        </div>

        {/* contribution bars — straight from aqi/flood/traffic risk values */}
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">What's driving it</div>
          {contribs.map((c, i) => (
            <div key={c.signal} className="group">
              <div className="mb-0.5 flex items-center justify-between text-[11px]">
                <span className={i === 0 ? "font-semibold text-slate-200" : "text-slate-400"}>
                  {c.icon} {c.label}
                  {i === 0 && <span className="ml-1.5 rounded bg-sky-500/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-sky-300">main</span>}
                </span>
                <span className="tabular-nums text-slate-400">{c.value.toFixed(1)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-800/80">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${Math.min(100, c.value)}%`, background: `linear-gradient(90deg, ${scoreColor(c.value)}88, ${scoreColor(c.value)})` }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* live history as received by this browser session */}
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Recent readings (this session)</div>
          <div className="rounded-lg border border-slate-800/60 bg-slate-900/40 px-3 py-2">
            <MiniSparkline values={history} color={scoreColor(zone.urban_risk_score)} width={260} height={40} />
            <div className="text-[10px] text-slate-600">
              {history.length > 1 ? `${history.length} live updates received` : "Waiting for the next live update…"}
            </div>
          </div>
        </div>

        {/* progressive disclosure: technical detail */}
        <button
          onClick={() => setShowTech((v) => !v)}
          className="text-[11px] font-medium text-sky-400 transition-colors hover:text-sky-300"
        >
          {showTech ? "▾ Hide technical details" : "▸ Show technical details"}
        </button>
        {showTech && (
          <div className="space-y-1.5 rounded-lg border border-slate-800/70 bg-slate-950/60 p-3 text-[11px] text-slate-400">
            <Row k="Predicted AQI" v={zone.predicted_aqi.toFixed(1)} />
            <Row k="Flood probability" v={`${(zone.flood_probability * 100).toFixed(1)}%`} />
            <Row k="Traffic probability" v={`${(zone.traffic_probability * 100).toFixed(1)}%`} />
            <Row k="Flood model" v={zone.flood_model_used} />
            <Row k="Traffic model" v={zone.traffic_model_used} />
            <Row k="AQI horizon" v={`+${zone.aqi_horizon_hours}h`} />
            <Row k="Flood horizon" v={`+${zone.flood_horizon_hours}h`} />
            <Row k="Traffic horizon" v={`+${zone.traffic_horizon_hours}h`} />
          </div>
        )}

        <div className="flex gap-2 pb-1">
          <Link
            to={`/forecasts?zone=${zone.zone_id}`}
            className="flex-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-center text-[11px] font-medium text-sky-300 transition-colors hover:bg-sky-500/20"
          >
            Forecast →
          </Link>
          <Link
            to={`/explain?zone=${zone.zone_id}`}
            className="flex-1 rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-center text-[11px] font-medium text-slate-300 transition-colors hover:border-sky-400/40 hover:text-sky-300"
          >
            Why? →
          </Link>
        </div>
      </div>
    </aside>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{k}</span>
      <span className="tabular-nums text-slate-300">{v}</span>
    </div>
  );
}
