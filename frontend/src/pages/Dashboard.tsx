import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, ApiError } from "../api/client";
import { useDashboardStreamContext } from "../api/DashboardStreamContext";
import type { DashboardZone, ForecastResponse, RiskMapPoint } from "../api/types";
import ZoneMap, { type MapDimension, type MapPoint } from "../components/ZoneMap";
import RiskDetailPanel from "../components/RiskDetailPanel";
import CitySummaryGauges from "../components/CitySummaryGauges";
import ForecastTimeline from "../components/ForecastTimeline";
import RiskBadge from "../components/RiskBadge";
import LiveStatusBadge from "../components/LiveStatusBadge";
import StreamStatusIndicator from "../components/StreamStatusIndicator";
import LiveClock from "../components/LiveClock";
import MiniSparkline from "../components/MiniSparkline";
import { scoreColor } from "../components/RiskBadge";
import { categoryRank, contributors } from "../lib/riskStory";
import { useZoneHistory } from "../lib/zoneHistory";

const FILTERS: { key: MapDimension; label: string; hint: string }[] = [
  { key: "overall", label: "Overall Risk", hint: "Combined urban risk score" },
  { key: "aqi", label: "AQI", hint: "Air-quality risk from live PM2.5/PM10 + weather" },
  { key: "flood", label: "Flood", hint: "Flood risk from live rainfall vs IMD thresholds" },
  { key: "traffic", label: "Traffic", hint: "Traffic risk from congestion patterns" },
];

export default function Dashboard() {
  const { data, status, error } = useDashboardStreamContext();
  const [params, setParams] = useSearchParams();
  const [mapPoints, setMapPoints] = useState<RiskMapPoint[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const [dimension, setDimension] = useState<MapDimension>("overall");

  // One-time static geometry (lat/lng per zone) — /api/risk-map is unchanged.
  useEffect(() => {
    api
      .getRiskMap()
      .then((r) => setMapPoints(r.points))
      .catch((e) => setMapError(e instanceof ApiError ? e.message : "Failed to load map zones"));
  }, []);

  // Selection lives in the URL (?zone=CHN_XYZ) so map clicks, watchlist clicks
  // and drill-downs all stay deep-linkable.
  const selectedZoneId = params.get("zone");
  const setSelectedZoneId = (z: string | null) => {
    const next = new URLSearchParams(params);
    if (z) next.set("zone", z);
    else next.delete("zone");
    setParams(next, { replace: true });
  };

  const zones = useMemo(() => data?.zones ?? [], [data]);
  const { history } = useZoneHistory(zones);

  // Merge static geometry with the live SSE breakdown; /api/risk-map only
  // carries score+category, so per-signal values come from the shared stream.
  const points: MapPoint[] = useMemo(() => {
    const liveByZone = new Map(zones.map((z) => [z.zone_id, z] as const));
    return mapPoints.map((p) => {
      const live = liveByZone.get(p.zone_id);
      return {
        zone_id: p.zone_id,
        zone_name: p.zone_name,
        latitude: p.latitude,
        longitude: p.longitude,
        score: live ? live.urban_risk_score : p.urban_risk_score,
        category: live ? live.risk_category : p.risk_category,
        has_live_data: !!live || p.has_live_data,
        status: live ? live.status : p.status,
      };
    });
  }, [mapPoints, zones]);

  const selected = zones.find((z) => z.zone_id === selectedZoneId) ?? null;

  const missing = data?.zones_missing_live_data ?? [];
  const watchlist = useMemo(
    () =>
      [...zones]
        .sort((a, b) => categoryRank(b.risk_category) - categoryRank(a.risk_category) || b.urban_risk_score - a.urban_risk_score)
        .slice(0, 5),
    [zones]
  );

  // One frame ago per zone (for the top-movers chart): derived strictly from
  // received SSE history, never fabricated.
  const movers = useMemo(() => {
    return zones
      .map((z) => {
        const h = history.get(z.zone_id) ?? [];
        const prev = h.length > 1 ? h[h.length - 2] : null;
        return { zone: z, prev, delta: prev === null ? 0 : z.urban_risk_score - prev };
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .filter((m) => m.prev !== null)
      .slice(0, 6);
  }, [zones, history]);

  const loading = !data && status === "connecting";

  // No live frame received yet — never render zeros, they'd read as real data.
  if (!data) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-white">Chennai Urban Intelligence — Command Center</h1>
          <div className="flex items-center gap-4">
            <StreamStatusIndicator status={status} />
            <LiveClock />
          </div>
        </div>
        <div className="glass flex h-[60vh] flex-col items-center justify-center gap-3 text-sm text-slate-400">
          <span className="breathe">{loading ? "Establishing live connection…" : "Waiting for the first live update…"}</span>
          {error && <span className="text-xs text-amber-300">{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── top bar: story headline + live status + clock ─────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Chennai Urban Intelligence — Command Center</h1>
          <p className="text-xs text-slate-500">
            What is happening · where · why · what happens next — live from {zones.length} reporting zones
            {missing.length > 0 && ` · ${missing.length} awaiting data`}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <StreamStatusIndicator status={status} />
          <LiveClock />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-300">
          Live updates interrupted: {error}. Showing last known data.
        </div>
      )}
      {data.note && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-300">{data.note}</div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[240px_minmax(0,1fr)_300px]">
          {/* ── left rail: gauges + filters ─────────────────────────────── */}
          <div className="space-y-4">
            <CitySummaryGauges zones={zones} />
            <div className="glass p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Map filter</div>
              <div className="space-y-1.5">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    title={f.hint}
                    onClick={() => setDimension(f.key)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-all ${
                      dimension === f.key
                        ? "border-sky-400/50 bg-sky-500/10 text-sky-200 shadow-[0_0_20px_-8px_rgba(56,189,248,0.6)]"
                        : "border-slate-800/70 bg-slate-900/40 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── center: the hero map ────────────────────────────────────── */}
          <div className="relative order-first min-h-[60vh] xl:order-none xl:min-h-[78vh]">
            {mapError ? (
              <div className="glass flex h-[70vh] items-center justify-center text-sm text-red-300">{mapError}</div>
            ) : (
              <ZoneMap
                points={points}
                selectedZoneId={selectedZoneId}
                onSelect={setSelectedZoneId}
                dimension={dimension}
                className="h-[60vh] xl:h-[78vh]"
              />
            )}
            {selected && <RiskDetailPanel zone={selected} history={history.get(selected.zone_id) ?? []} onClose={() => setSelectedZoneId(null)} />}
          </div>

          {/* ── right rail: watchlist + top movers ─────────────────────── */}
          <div className="space-y-4">
            <div className="glass p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Areas to watch</div>
                <span className="text-[10px] text-slate-600">click a zone ↓</span>
              </div>
              <div className="space-y-1.5">
                {watchlist.map((z) => (
                  <ZoneRow key={z.zone_id} zone={z} selected={selectedZoneId === z.zone_id} onSelect={() => setSelectedZoneId(z.zone_id)} history={history.get(z.zone_id) ?? []} />
                ))}
                {watchlist.length === 0 && <div className="py-3 text-center text-xs text-slate-500">No zones reporting yet.</div>}
              </div>
            </div>

            <div className="glass p-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Top movers (live)</div>
              <p className="mb-2 text-[10px] text-slate-600">Change between the last two received updates</p>
              {movers.length === 0 ? (
                <div className="py-3 text-center text-xs text-slate-500">Waiting for a second update to compare…</div>
                ) : (
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={movers} layout="vertical" margin={{ left: 8, right: 12 }}>
                      <XAxis type="number" hide domain={["dataMin", "dataMax"]} />
                      <YAxis type="category" dataKey="zone.zone_name" width={86} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                      <Tooltip
                        cursor={{ fill: "rgba(148,163,184,0.06)" }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const m = payload[0].payload as (typeof movers)[number];
                          return (
                            <div className="rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-[11px] text-slate-300 shadow-xl">
                              <div className="font-semibold text-slate-100">{m.zone.zone_name}</div>
                              <div>{m.prev!.toFixed(1)} → {m.zone.urban_risk_score.toFixed(1)}</div>
                              <div className={m.delta >= 0 ? "text-red-300" : "text-emerald-300"}>
                                {m.delta >= 0 ? "+" : ""}{m.delta.toFixed(2)} between live updates
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="delta" radius={3} barSize={12}>
                        {movers.map((m) => (
                          <Cell key={m.zone.zone_id} fill={m.delta >= 0 ? "#fb7185" : "#34d399"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
      </div>

      {/* ── WHAT HAPPENS NEXT: playback timeline for the selected zone ── */}
      {selected && <ForecastDrilldown zone={selected} />}
    </div>
  );
}

function ZoneRow({
  zone,
  selected,
  onSelect,
  history,
}: {
  zone: DashboardZone;
  selected: boolean;
  onSelect: () => void;
  history: number[];
}) {
  const color = scoreColor(zone.urban_risk_score);
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-lg border px-2.5 py-2 text-left transition-all ${
        selected ? "border-sky-400/50 bg-sky-500/10" : "border-slate-800/70 bg-slate-900/40 hover:border-slate-600"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-slate-200">{zone.zone_name}</span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}99` }} />
          <span className="text-xs font-semibold tabular-nums" style={{ color }}>{zone.urban_risk_score.toFixed(1)}</span>
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[10px] text-slate-500">
          {contributors(zone)[0].icon} {contributors(zone)[0].label}
        </span>
        <MiniSparkline values={history} color={color} width={64} height={16} />
      </div>
    </button>
  );
}

function ForecastDrilldown({ zone }: { zone: DashboardZone }) {
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setForecast(null);
    setErr(null);
    api
      .getForecast(zone.zone_id)
      .then((f) => !cancelled && setForecast(f))
      .catch((e) => !cancelled && setErr(e instanceof ApiError ? e.message : "Failed to load forecast"));
    return () => {
      cancelled = true;
    };
  }, [zone.zone_id]);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">
          24-hour outlook — <span className="text-sky-300">{zone.zone_name}</span>
        </h2>
        {err && <span className="text-xs text-amber-300">{err}</span>}
      </div>
      <ForecastTimeline now={zone} forecasts={forecast?.forecasts ?? []} />
    </section>
  );
}
