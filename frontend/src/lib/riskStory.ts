import type { PredictionResult, RiskCategory } from "../api/types";

// ---------------------------------------------------------------------------
// Human-friendly status bands. These are presentation thresholds only (how a
// number is *labeled*), not new modeling — the underlying risk score, category
// and every raw value still come straight from the API/SSE payload.

export type ConditionLevel = "Good" | "Moderate" | "Poor" | "Low" | "High";

export function aqiLevel(aqiRisk: number): ConditionLevel {
  if (aqiRisk < 34) return "Good";
  if (aqiRisk < 67) return "Moderate";
  return "Poor";
}

export function floodLevel(floodRisk: number): ConditionLevel {
  if (floodRisk < 20) return "Low";
  if (floodRisk < 50) return "Moderate";
  return "High";
}

export function trafficLevel(trafficRisk: number): ConditionLevel {
  if (trafficRisk < 34) return "Low";
  if (trafficRisk < 67) return "Moderate";
  return "High";
}

export const CATEGORY_ORDER: RiskCategory[] = ["Low", "Moderate", "Elevated", "High", "Critical"];

export function categoryRank(c: RiskCategory): number {
  return CATEGORY_ORDER.indexOf(c);
}

// ---------------------------------------------------------------------------
// "What's the biggest driver?" — a plain comparison of the three real risk
// contributions the backend already computed (aqi_risk/flood_risk/traffic_risk
// on any PredictionResult), never re-derived or estimated independently.

export type Signal = "aqi" | "flood" | "traffic";

export interface ContributorBreakdown {
  signal: Signal;
  label: string;
  icon: string;
  value: number;
}

export function contributors(r: Pick<PredictionResult, "aqi_risk" | "flood_risk" | "traffic_risk">): ContributorBreakdown[] {
  const items: ContributorBreakdown[] = [
    { signal: "aqi", label: "Air quality", icon: "🌫", value: r.aqi_risk },
    { signal: "flood", label: "Flood risk", icon: "🌧", value: r.flood_risk },
    { signal: "traffic", label: "Traffic pressure", icon: "🚗", value: r.traffic_risk },
  ];
  return items.sort((a, b) => b.value - a.value);
}

export function largestContributor(r: Pick<PredictionResult, "aqi_risk" | "flood_risk" | "traffic_risk">): ContributorBreakdown {
  return contributors(r)[0];
}

// ---------------------------------------------------------------------------
// Narrative sentence generators. Every sentence is assembled from real numbers
// on the object passed in — there is no lookup table of canned sentences keyed
// by category, so the wording always tracks whatever the API actually returned.

export function cityConditionSentence(category: RiskCategory): string {
  switch (category) {
    case "Low":
      return "Current conditions are generally safe across the city.";
    case "Moderate":
      return "Current conditions are generally moderate.";
    case "Elevated":
      return "Conditions are elevated in parts of the city and worth monitoring.";
    case "High":
      return "Conditions are concerning in several zones right now.";
    case "Critical":
      return "Conditions are critical in at least one zone — immediate attention recommended.";
  }
}

export function whyRiskSentence(r: Pick<PredictionResult, "aqi_risk" | "flood_risk" | "traffic_risk">): string {
  const [top, second] = contributors(r);
  if (top.value < 15) {
    return "All three signals are currently low — there is no dominant contributor.";
  }
  const gap = top.value - second.value;
  if (gap < 5) {
    return `${top.label} and ${second.label.toLowerCase()} are contributing about equally right now.`;
  }
  return `${top.label} is currently the largest contributor to urban risk.`;
}

export function zoneWatchReason(r: Pick<PredictionResult, "aqi_risk" | "flood_risk" | "traffic_risk">): string {
  const top = largestContributor(r);
  const level =
    top.signal === "aqi" ? aqiLevel(top.value) : top.signal === "flood" ? floodLevel(top.value) : trafficLevel(top.value);
  return `${top.label} is ${level.toLowerCase()} and the main driver here.`;
}

export function whatIfSentence(
  current: Pick<PredictionResult, "aqi_risk" | "flood_risk" | "traffic_risk" | "urban_risk_score">,
  simulated: Pick<PredictionResult, "aqi_risk" | "flood_risk" | "traffic_risk" | "urban_risk_score">
): string {
  const delta = simulated.urban_risk_score - current.urban_risk_score;
  const direction = delta > 0.5 ? "increases" : delta < -0.5 ? "decreases" : "stays about the same";
  const top = largestContributor(simulated);
  if (direction === "stays about the same") {
    return "Under this scenario, urban risk stays about the same.";
  }
  return `Under this scenario, urban risk ${direction} and ${top.label.toLowerCase()} becomes the largest contributor.`;
}
