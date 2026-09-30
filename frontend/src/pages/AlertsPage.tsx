import { useEffect, useState, type ChangeEvent } from "react";
import { api, ApiError } from "../api/client";
import type { AlertsResponse, RiskCategory } from "../api/types";
import RiskBadge from "../components/RiskBadge";
import { scoreColor } from "../components/RiskBadge";
import { zoneWatchReason } from "../lib/riskStory";

const CATEGORIES: RiskCategory[] = ["Low", "Moderate", "Elevated", "High", "Critical"];
const CATEGORY_ICON: Record<RiskCategory, string> = {
  Low: "✓",
  Moderate: "ℹ️",
  Elevated: "⚠️",
  High: "⚠️",
  Critical: "🚨",
};

export default function AlertsPage() {
  const [minCategory, setMinCategory] = useState<RiskCategory>("High");
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getAlerts(minCategory)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load alerts"))
      .finally(() => setLoading(false));
  }, [minCategory]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Today's Urban Alerts</h1>
          <p className="max-w-2xl text-xs text-slate-500">
            Zones currently at or above the selected risk category. This calls the alerts endpoint fresh each time —
            the API doesn't return per-alert timestamps, so this shows currently-triggered alerts rather than an
            invented time-ordered log.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Minimum category
          <select
            value={minCategory}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setMinCategory(e.target.value as RiskCategory)}
            className="rounded-lg border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-sky-400/60"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      {loading && <div className="breathe text-sm text-slate-400">Loading alerts…</div>}
      {error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-300">{error}</div>
      )}

      {data && data.alerts.length === 0 && (
        <div className="glass flex flex-col items-center px-6 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-950/40 text-2xl">✓</div>
          <div className="mt-3 font-medium text-emerald-300">No active alerts</div>
          <p className="mt-1 max-w-md text-sm text-emerald-500/80">
            Current monitored conditions are within the {minCategory}+ threshold across all reporting zones.
          </p>
        </div>
      )}

      {data && data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map((a) => {
            const color = scoreColor(a.urban_risk_score);
            return (
              <div
                key={a.zone_id}
                className="glass glass-hover flex items-start gap-3 px-4 py-3"
                style={{ borderLeft: `3px solid ${color}` }}
              >
                <span className="mt-0.5 text-lg" aria-hidden>{CATEGORY_ICON[a.risk_category]}</span>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-slate-200">{a.zone_name}</span>
                    <RiskBadge category={a.risk_category} score={a.urban_risk_score} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{zoneWatchReason(a)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
