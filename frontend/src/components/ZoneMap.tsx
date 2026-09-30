import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, ZoomControl, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useDashboardStreamContext } from "../api/DashboardStreamContext";
import { scoreColor } from "./RiskBadge";

export const CHENNAI_CENTER: [number, number] = [13.03, 80.22];

/** Fits the map bounds to the real zone markers once geometry has loaded. */
function FitToZones({ points }: { points: MapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    const lats = points.map((p) => p.latitude);
    const lngs = points.map((p) => p.longitude);
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
      { padding: [48, 48] }
    );
    // fit once when geometry arrives — not on every live update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length > 0]);
  return null;
}
const NO_DATA = "#475569";
/** Presentation radii so ~20 markers stay readable at city zoom. */
const MIN_R = 9;
const MAX_R = 26;

export interface MapPoint {
  zone_id: string;
  zone_name: string;
  latitude: number;
  longitude: number;
  score: number | null;
  category: string | null;
  has_live_data: boolean;
  status: "LIVE" | "STALE" | "NO_DATA";
}

export type MapDimension = "overall" | "aqi" | "flood" | "traffic";

function valueFor(
  p: MapPoint,
  dimension: MapDimension,
  breakdownByZone: Map<string, import("../api/types").DashboardZone>
): number | null {
  if (!p.has_live_data) return null;
  const live = breakdownByZone.get(p.zone_id);
  if (!live) return null;
  switch (dimension) {
    case "aqi":
      return live.aqi_risk;
    case "flood":
      return live.flood_risk;
    case "traffic":
      return live.traffic_risk;
    default:
      return live.urban_risk_score;
  }
}

function ZoneTooltip({
  point,
  live,
  score,
  dimension,
}: {
  point: MapPoint;
  live: import("../api/types").DashboardZone | undefined;
  score: number | null;
  dimension: MapDimension;
}) {
  const dimLabel: Record<MapDimension, string> = {
    overall: "Urban risk",
    aqi: "Air-quality risk",
    flood: "Flood risk",
    traffic: "Traffic risk",
  };
  return (
    <div className="min-w-[190px] p-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-slate-100">{point.zone_name}</span>
        {live && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            LIVE
          </span>
        )}
      </div>
      {live ? (
        <>
          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-300">
            <span>Urban risk <b className="text-slate-100">{live.urban_risk_score.toFixed(1)}</b></span>
            <span>AQI <b className="text-slate-100">{live.aqi_risk.toFixed(0)}</b></span>
            <span>Flood <b className="text-slate-100">{live.flood_risk.toFixed(0)}%</b></span>
            <span>Traffic <b className="text-slate-100">{live.traffic_risk.toFixed(0)}%</b></span>
          </div>
          <div className="mt-1.5 text-[10px] text-slate-500">
            Click for the full {dimLabel[dimension].toLowerCase()} story →
          </div>
        </>
      ) : (
        <div className="mt-1 text-[11px] text-slate-400">No live observation yet — shown gray, never guessed.</div>
      )}
      {score !== null && (
        <div className="mt-1 text-[10px] uppercase tracking-wider" style={{ color: scoreColor(score) }}>
          {dimLabel[dimension]}: {score.toFixed(1)}
        </div>
      )}
    </div>
  );
}

/**
 * The hero visualization. Markers are sized/colored by the real live score for
 * the selected dimension; High/Critical zones pulse; no-data zones stay gray.
 * Heat glow = big soft circles behind markers, driven by the same real scores.
 */
export default function ZoneMap({
  points,
  selectedZoneId,
  onSelect,
  dimension,
  className = "",
}: {
  points: MapPoint[];
  selectedZoneId: string | null;
  onSelect: (zoneId: string | null) => void;
  dimension: MapDimension;
  className?: string;
}) {
  // Per-signal breakdown comes from the ONE shared SSE stream (context) — the
  // /api/risk-map endpoint itself is untouched.
  const { data: streamData } = useDashboardStreamContext();
  const breakdownByZone = useMemo(
    () => new Map((streamData?.zones ?? []).map((z) => [z.zone_id, z] as const)),
    [streamData]
  );

  const heatPoints = useMemo(
    () =>
      points
        .map((p) => ({ p, v: valueFor(p, dimension, breakdownByZone) }))
        .filter((x): x is { p: MapPoint; v: number } => x.v !== null),
    [points, dimension, breakdownByZone]
  );

  return (
    <div className={`relative overflow-hidden rounded-xl border border-slate-800/70 shadow-[0_30px_80px_-40px_rgba(2,8,20,0.9)] ${className}`}>
      <MapContainer
        center={CHENNAI_CENTER}
        zoom={11}
        zoomControl={false}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          url="https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          attribution="Tiles &copy; Esri — Esri, DeLorme, NAVTEQ"
          maxZoom={16}
        />
        <ZoomControl position="bottomright" />
        <FitToZones points={points} />

        {/* heat / glow underlay — same real scores, rendered as soft light */}
        {heatPoints.map(({ p, v }) => (
          <CircleMarker
            key={`heat-${p.zone_id}`}
            center={[p.latitude, p.longitude]}
            radius={52}
            interactive={false}
            pathOptions={{
              stroke: false,
              fillColor: scoreColor(v),
              fillOpacity: 0.04 + 0.07 * (v / 100),
            }}
          />
        ))}

        {points.map((p) => {
          const v = valueFor(p, dimension, breakdownByZone);
          const color = v !== null ? scoreColor(v) : NO_DATA;
          const radius = v !== null ? MIN_R + (MAX_R - MIN_R) * Math.sqrt(Math.max(0, Math.min(100, v)) / 100) : 6;
          const isSel = selectedZoneId === p.zone_id;
          const live = breakdownByZone.get(p.zone_id);
          const isHigh = live ? live.risk_category === "High" || live.risk_category === "Critical" : false;
          return (
            <CircleMarker
              key={p.zone_id}
              center={[p.latitude, p.longitude]}
              radius={radius}
              eventHandlers={{ click: () => onSelect(p.zone_id) }}
              pathOptions={{
                color: isSel ? "#7dd3fc" : color,
                weight: isSel ? 3 : 1.5,
                fillColor: color,
                fillOpacity: v !== null ? 0.62 : 0.18,
                className: isHigh && !isSel ? "risk-marker-pulse" : "",
              }}
            >
              <Tooltip className="rz-tooltip" direction="top" offset={[0, -8]} opacity={1}>
                <ZoneTooltip point={p} live={live} score={v} dimension={dimension} />
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>


      {/* dimension badge so users know what the marker size means */}
      <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-lg border border-slate-700/60 bg-slate-950/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300 backdrop-blur">
        Marker size &amp; heat = {dimension === "overall" ? "overall risk" : `${dimension} risk`}
      </div>
    </div>
  );
}
