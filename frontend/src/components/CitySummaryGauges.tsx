import RadialGauge from "./RadialGauge";
import type { DashboardZone, RiskCategory } from "../api/types";

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

// Same banding the backend's risk_engine.py documents (per-zone categories come
// from there; the city mean is just the average of those same real per-zone scores).
function categoryForScore(score: number): RiskCategory {
  if (score <= 20) return "Low";
  if (score <= 40) return "Moderate";
  if (score <= 60) return "Elevated";
  if (score <= 80) return "High";
  return "Critical";
}

export default function CitySummaryGauges({ zones }: { zones: DashboardZone[] }) {
  const cityAvg = {
    urban: mean(zones.map((z) => z.urban_risk_score)),
    aqi: mean(zones.map((z) => z.aqi_risk)),
    flood: mean(zones.map((z) => z.flood_risk)),
    traffic: mean(zones.map((z) => z.traffic_risk)),
  };
  const items = [
    { label: "Overall", value: cityAvg.urban, category: categoryForScore(cityAvg.urban), suffix: "" },
    { label: "Air", value: cityAvg.aqi, category: categoryForScore(cityAvg.aqi), suffix: "" },
    { label: "Flood", value: cityAvg.flood, category: categoryForScore(cityAvg.flood), suffix: "%" },
    { label: "Traffic", value: cityAvg.traffic, category: categoryForScore(cityAvg.traffic), suffix: "%" },
  ];
  return (
    <div className="glass sweep-line grid grid-cols-2 gap-y-3 px-3 py-4">
      {items.map((g) => (
        <div key={g.label} className="flex flex-col items-center" title={`${g.label}: city-wide mean of live per-zone values`}>
          <RadialGauge score={g.value} category={g.category} size={86} suffix={g.suffix} />
          <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{g.label}</div>
        </div>
      ))}
    </div>
  );
}
