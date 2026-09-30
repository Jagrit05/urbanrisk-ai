import { useEffect, useState, type ChangeEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { api, ApiError } from "../api/client";
import type { ExplainResponse, RiskMapPoint } from "../api/types";

export default function ExplainPage() {
  const [zones, setZones] = useState<RiskMapPoint[]>([]);
  const [zoneId, setZoneId] = useState<string>("");
  const [horizon, setHorizon] = useState<6 | 12 | 24>(6);
  const [data, setData] = useState<ExplainResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    api.getRiskMap().then((r) => {
      setZones(r.points);
      const fromUrl = params.get("zone");
      if (r.points.length) setZoneId(fromUrl && r.points.some((p) => p.zone_id === fromUrl) ? fromUrl : r.points[0].zone_id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!zoneId) return;
    setLoading(true);
    setError(null);
    setData(null);
    api
      .getExplain(zoneId, horizon)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load explanation"))
      .finally(() => setLoading(false));
  }, [zoneId, horizon]);

  const pushingUp = data?.top_factors
    .filter((f) => f.shap_contribution > 0)
    .sort((a, b) => b.shap_contribution - a.shap_contribution)
    .slice(0, 3);
  const pushingDown = data?.top_factors
    .filter((f) => f.shap_contribution < 0)
    .sort((a, b) => a.shap_contribution - b.shap_contribution)
    .slice(0, 3);

  const chartData = data?.top_factors
    .slice()
    .sort((a, b) => a.shap_contribution - b.shap_contribution)
    .map((f) => ({ ...f, feature: f.feature.length > 24 ? f.feature.slice(0, 24) + "…" : f.feature }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-white">Why does the AI expect this?</h1>
        <p className="text-xs text-slate-500">Real SHAP output from the live-loaded AQI model — plain language first, technical detail on demand.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={zoneId}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setZoneId(e.target.value)}
          className="rounded-lg border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-sky-400/60"
        >
          {zones.map((z) => (
            <option key={z.zone_id} value={z.zone_id}>{z.zone_name}</option>
          ))}
        </select>
        <select
          value={horizon}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setHorizon(Number(e.target.value) as 6 | 12 | 24)}
          className="rounded-lg border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-sky-400/60"
        >
          <option value={6}>+6h forecast</option>
          <option value={12}>+12h forecast</option>
          <option value={24}>+24h forecast</option>
        </select>
      </div>

      {loading && <div className="breathe text-sm text-slate-400">Loading explanation…</div>}
      {error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-300">{error}</div>
      )}

      {data && (
        <div className="space-y-4">
          <div className="glass sweep-line flex flex-col items-center px-6 py-6 text-center">
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Predicted air quality (+{data.horizon_hours}h)</div>
            <div className="mt-1 text-5xl font-bold text-white tabular-nums">{data.predicted_aqi}</div>
            <div className="mt-1 text-xs text-slate-500">AQI index — higher means worse air</div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FactorList title="What's pushing it up?" factors={pushingUp ?? []} color="#fb7185" emptyLabel="Nothing pushing it up." />
            <FactorList title="What's pushing it down?" factors={pushingDown ?? []} color="#38bdf8" emptyLabel="Nothing pushing it down." />
          </div>

          <button
            onClick={() => setShowTechnical((v) => !v)}
            className="text-[11px] font-medium text-sky-400 transition-colors hover:text-sky-300"
          >
            {showTechnical ? "▾ Hide technical SHAP details" : "▸ View technical SHAP details"}
          </button>

          {showTechnical && chartData && (
            <div className="glass space-y-2 p-4">
              <div className="h-[420px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ left: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
                    <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="feature" type="category" width={160} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: "rgba(5,11,22,0.95)", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 10, fontSize: 11 }}
                      formatter={(v: number) => v.toFixed(3)}
                    />
                    <Bar dataKey="shap_contribution" radius={3}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.shap_contribution >= 0 ? "#fb7185" : "#38bdf8"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-slate-500">
                Red bars push the AQI prediction up; blue bars pull it down — real TreeExplainer values, not a simplified approximation.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FactorList({
  title,
  factors,
  color,
  emptyLabel,
}: {
  title: string;
  factors: { feature: string; value: number | null; shap_contribution: number }[];
  color: string;
  emptyLabel: string;
}) {
  return (
    <div className="glass p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-200">{title}</h3>
      {factors.length === 0 ? (
        <p className="text-xs text-slate-500">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {factors.map((f) => (
            <li key={f.feature} className="flex items-center gap-2 text-sm" title={f.value !== null ? `Observed value: ${f.value}` : undefined}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}88` }} />
              <span className="text-slate-300">{f.feature}</span>
              {f.value !== null && <span className="ml-auto text-xs tabular-nums text-slate-500">{f.value.toFixed(1)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
