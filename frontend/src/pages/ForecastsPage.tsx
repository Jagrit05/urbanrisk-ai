import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Tooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { api, ApiError } from "../api/client";
import { useDashboardStreamContext } from "../api/DashboardStreamContext";
import type { ForecastResponse, PredictionResult, RiskMapPoint } from "../api/types";
import ForecastTimeline from "../components/ForecastTimeline";
import LiveStatusBadge from "../components/LiveStatusBadge";
import { scoreColor } from "../components/RiskBadge";
import { useZoneHistory } from "../lib/zoneHistory";

export default function ForecastsPage() {
  const [zones, setZones] = useState<RiskMapPoint[]>([]);
  const [zoneId, setZoneId] = useState<string>("");
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { data: streamData } = useDashboardStreamContext();
  const [params, setParams] = useSearchParams();

  const { history } = useZoneHistory(streamData?.zones ?? []);

  useEffect(() => {
    api.getRiskMap().then((r) => {
      setZones(r.points);
      const fromUrl = params.get("zone");
      setZoneId(fromUrl && r.points.some((p) => p.zone_id === fromUrl) ? fromUrl : r.points[0]?.zone_id ?? "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!zoneId) return;
    setLoading(true);
    setError(null);
    setForecast(null);
    api
      .getForecast(zoneId)
      .then(setForecast)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load forecast"))
      .finally(() => setLoading(false));
  }, [zoneId]);

  const nowResult = streamData?.zones.find((z) => z.zone_id === zoneId) ?? null;

  // City-average line built only from frames this browser actually received.
  const cityHistory = useMemo(() => {
    if (!streamData || streamData.zones.length === 0) return [];
    const perZone = [...history.values()];
    const len = Math.max(0, ...perZone.map((a) => a.length));
    const out: { step: string; avg: number | null }[] = [];
    for (let i = 0; i < len; i++) {
      const vals = perZone.map((a) => a[i]).filter((v): v is number => typeof v === "number");
      if (vals.length) out.push({ step: `#${i + 1}`, avg: vals.reduce((a, b) => a + b, 0) / vals.length });
    }
    return out;
  }, [streamData, history]);

  const chartData = forecast?.forecasts.map((f) => ({
    horizonLabel: `+${f.aqi_horizon_hours}h`,
    "Urban risk": f.urban_risk_score,
    "AQI risk": f.aqi_risk,
    "Flood risk": f.flood_risk,
    "Traffic risk": f.traffic_risk,
    predicted_aqi: f.predicted_aqi,
    flood_probability: f.flood_probability,
    traffic_probability: f.traffic_probability,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">What happens next?</h1>
          <p className="text-xs text-slate-500">Real predictions from the live-loaded AQI / flood / traffic models.</p>
        </div>
        {nowResult && <LiveStatusBadge status={nowResult.status} ageMinutes={nowResult.age_minutes} />}
      </div>

      {/* zone picker chips */}
      <div className="flex flex-wrap gap-1.5">
        {zones.map((z) => (
          <button
            key={z.zone_id}
            onClick={() => {
              setZoneId(z.zone_id);
              const next = new URLSearchParams(params);
              next.set("zone", z.zone_id);
              setParams(next, { replace: true });
            }}
            className={`rounded-full border px-3 py-1 text-[11px] transition-all ${
              zoneId === z.zone_id
                ? "border-sky-400/50 bg-sky-500/10 text-sky-200"
                : "border-slate-800/70 bg-slate-900/40 text-slate-400 hover:border-slate-600 hover:text-slate-200"
            }`}
          >
            {z.zone_name}
          </button>
        ))}
      </div>

      {loading && <div className="breathe text-sm text-slate-400">Loading forecast…</div>}
      {error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-300">{error}</div>
      )}

      {zoneId && <ForecastTimeline now={nowResult} forecasts={forecast?.forecasts ?? []} height={200} />}

      {chartData && (
        <div className="glass p-4">
          <div className="mb-2">
            <h2 className="text-sm font-semibold text-slate-200">Forecast detail</h2>
            <p className="text-[11px] text-slate-500">Hover a bar for the real predicted AQI / flood / traffic probabilities behind it.</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" vertical={false} />
                <XAxis dataKey="horizonLabel" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={{ stroke: "rgba(148,163,184,0.2)" }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip content={<FriendlyTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
                <Bar dataKey="AQI risk" fill="#38bdf8" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Flood risk" fill="#818cf8" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Traffic risk" fill="#fb923c" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Urban risk" radius={[3, 3, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={scoreColor(d["Urban risk"])} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* live chart: city-wide average of received live frames */}
      <div className="glass p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">City risk — live trend</h2>
            <p className="text-[11px] text-slate-500">Average urban risk across reporting zones, one point per update received this session.</p>
          </div>
          <span className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> RECEIVING
          </span>
        </div>
        <div className="h-40">
          {cityHistory.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cityHistory} margin={{ top: 6, right: 12, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" vertical={false} />
                <XAxis dataKey="step" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "rgba(5,11,22,0.95)", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 10, fontSize: 11 }}
                  labelStyle={{ color: "#94a3b8" }}
                />
                <Line type="monotone" dataKey="avg" name="City avg urban risk" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3, fill: "#38bdf8" }} isAnimationActive />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-500 breathe">
              Waiting for more live updates — one point is recorded per SSE frame received.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FriendlyTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-[11px] text-slate-300 shadow-xl">
      <div className="mb-1 font-semibold text-slate-100">{d.horizonLabel}</div>
      <div>Urban risk: {d["Urban risk"].toFixed(1)}</div>
      <div>Air quality (predicted AQI): {d.predicted_aqi.toFixed(1)}</div>
      <div>Flood risk: {(d.flood_probability * 100).toFixed(1)}%</div>
      <div>Traffic pressure: {(d.traffic_probability * 100).toFixed(1)}%</div>
    </div>
  );
}
