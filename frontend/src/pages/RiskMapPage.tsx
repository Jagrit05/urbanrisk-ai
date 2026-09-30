import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useDashboardStreamContext } from "../api/DashboardStreamContext";
import type { RiskMapPoint } from "../api/types";
import ZoneMap, { type MapDimension, type MapPoint } from "../components/ZoneMap";
import RiskDetailPanel from "../components/RiskDetailPanel";
import StreamStatusIndicator from "../components/StreamStatusIndicator";
import LiveClock from "../components/LiveClock";
import { CATEGORY_HEX } from "../components/RiskBadge";
import { useZoneHistory } from "../lib/zoneHistory";
import type { RiskCategory } from "../api/types";

const LEGEND: { key: RiskCategory | "NO_DATA"; label: string }[] = [
  { key: "Low", label: "Low" },
  { key: "Moderate", label: "Moderate" },
  { key: "Elevated", label: "Elevated" },
  { key: "High", label: "High" },
  { key: "Critical", label: "Critical" },
  { key: "NO_DATA", label: "No data" },
];

export default function RiskMapPage() {
  const [rawPoints, setRawPoints] = useState<RiskMapPoint[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const [dimension, setDimension] = useState<MapDimension>("overall");
  const [params, setParams] = useSearchParams();
  const { data: streamData, status: streamStatus } = useDashboardStreamContext();
  const zones = streamData?.zones ?? [];
  const { history } = useZoneHistory(zones);

  useEffect(() => {
    api
      .getRiskMap()
      .then((r) => setRawPoints(r.points))
      .catch((e) => setMapError(e instanceof ApiError ? e.message : "Failed to load risk map"));
  }, []);

  const selectedZoneId = params.get("zone");
  const setSelectedZoneId = (z: string | null) => {
    const next = new URLSearchParams(params);
    if (z) next.set("zone", z);
    else next.delete("zone");
    setParams(next, { replace: true });
  };

  const points: MapPoint[] = useMemo(() => {
    const liveByZone = new Map(zones.map((z) => [z.zone_id, z] as const));
    return rawPoints.map((p) => {
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
  }, [rawPoints, zones]);

  const selected = zones.find((z) => z.zone_id === selectedZoneId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Chennai Live Risk Map</h1>
          <p className="text-xs text-slate-500">
            {rawPoints.length} zones · click a marker for the full story · per-signal breakdown comes from the shared live stream
          </p>
        </div>
        <div className="flex items-center gap-4">
          <StreamStatusIndicator status={streamStatus} />
          <LiveClock />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="glass flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2">
          {LEGEND.map((l) => (
            <div key={l.label} className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span
                className="h-2.5 w-2.5 rounded-full border border-slate-700"
                style={{ backgroundColor: CATEGORY_HEX[l.key], boxShadow: l.key === "NO_DATA" ? undefined : `0 0 8px ${CATEGORY_HEX[l.key]}66` }}
              />
              {l.label}
            </div>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(["overall", "aqi", "flood", "traffic"] as MapDimension[]).map((d) => (
            <button
              key={d}
              onClick={() => setDimension(d)}
              className={`rounded-full border px-3 py-1 text-[11px] capitalize transition-all ${
                dimension === d
                  ? "border-sky-400/50 bg-sky-500/10 text-sky-200"
                  : "border-slate-800/70 bg-slate-900/40 text-slate-400 hover:border-slate-600 hover:text-slate-200"
              }`}
            >
              {d === "overall" ? "Overall" : d}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        {mapError ? (
          <div className="glass flex h-[70vh] items-center justify-center text-sm text-red-300">{mapError}</div>
        ) : (
          <ZoneMap
            points={points}
            selectedZoneId={selectedZoneId}
            onSelect={setSelectedZoneId}
            dimension={dimension}
            className="h-[70vh]"
          />
        )}
        {selected && (
          <RiskDetailPanel zone={selected} history={history.get(selected.zone_id) ?? []} onClose={() => setSelectedZoneId(null)} />
        )}
      </div>
    </div>
  );
}
