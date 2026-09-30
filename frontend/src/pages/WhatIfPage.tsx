import { useEffect, useState, type ChangeEvent } from "react";
import { api, ApiError } from "../api/client";
import type { RiskMapPoint, WhatIfResponse } from "../api/types";
import RadialGauge from "../components/RadialGauge";
import { whatIfSentence } from "../lib/riskStory";

interface FormState {
  rainfall_rate_mm_per_h: string;
  temperature: string;
  humidity: string;
  wind_speed: string;
  pressure: string;
  aqi: string;
  pm2_5: string;
  pm10: string;
}

const EMPTY_FORM: FormState = {
  rainfall_rate_mm_per_h: "",
  temperature: "",
  humidity: "",
  wind_speed: "",
  pressure: "",
  aqi: "",
  pm2_5: "",
  pm10: "",
};

const FIELD_LABELS: Record<keyof FormState, string> = {
  rainfall_rate_mm_per_h: "Rainfall rate (mm/h)",
  temperature: "Temperature (°C)",
  humidity: "Humidity (%)",
  wind_speed: "Wind speed (km/h)",
  pressure: "Pressure (hPa)",
  aqi: "AQI",
  pm2_5: "PM2.5 (µg/m³)",
  pm10: "PM10 (µg/m³)",
};

export default function WhatIfPage() {
  const [zones, setZones] = useState<RiskMapPoint[]>([]);
  const [zoneId, setZoneId] = useState<string>("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [result, setResult] = useState<WhatIfResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getRiskMap().then((r) => {
      setZones(r.points);
      if (r.points.length) setZoneId(r.points[0].zone_id);
    });
  }, []);

  async function runSimulation() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body = {
        zone_id: zoneId,
        ...Object.fromEntries(
          Object.entries(form)
            .filter(([, v]) => v !== "")
            .map(([k, v]) => [k, Number(v)])
        ),
      };
      const res = await api.postWhatIf(body);
      setResult(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Simulation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-white">What if conditions change?</h1>
        <p className="text-xs text-slate-500">
          Override any subset of current conditions and compare the real model output against the zone's live baseline.
          This is a scenario simulation, not a causal claim.
        </p>
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
        <button
          onClick={runSimulation}
          disabled={!zoneId || loading}
          className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-4 py-2 text-sm font-medium text-sky-200 transition-colors hover:bg-sky-500/25 disabled:opacity-50"
        >
          {loading ? "Running…" : "Run simulation"}
        </button>
      </div>

      <div className="glass grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        {(Object.keys(EMPTY_FORM) as (keyof FormState)[]).map((key) => (
          <label key={key} className="text-[11px] text-slate-400">
            {FIELD_LABELS[key]}
            <input
              type="number"
              value={form[key]}
              placeholder="baseline"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-700/70 bg-slate-950/60 px-2 py-1.5 text-sm text-slate-200 outline-none transition-colors focus:border-sky-400/60"
            />
          </label>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-300">{error}</div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-800/70 bg-slate-900/40 px-4 py-2.5 text-xs text-slate-400">{result.disclaimer}</div>

          <div className="glass grid grid-cols-1 items-center gap-6 p-6 sm:grid-cols-3">
            <div className="flex flex-col items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Current (live)</span>
              <RadialGauge score={result.current.urban_risk_score} category={result.current.risk_category} size={140} />
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Change</span>
              <span
                className={`text-4xl font-bold tabular-nums ${
                  result.delta_urban_risk_score >= 0.5
                    ? "text-red-400"
                    : result.delta_urban_risk_score <= -0.5
                    ? "text-emerald-400"
                    : "text-slate-400"
                }`}
              >
                {result.delta_urban_risk_score >= 0 ? "+" : ""}
                {result.delta_urban_risk_score.toFixed(1)}
              </span>
              <span className="text-xl text-slate-600">→</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Simulated</span>
              <RadialGauge score={result.simulated.urban_risk_score} category={result.simulated.risk_category} size={140} />
            </div>
          </div>

          <div className="glass px-4 py-3 text-sm text-slate-300">{whatIfSentence(result.current, result.simulated)}</div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ResultDetail title="Current (live baseline)" r={result.current} />
            <ResultDetail title="Simulated" r={result.simulated} />
          </div>
        </div>
      )}
    </div>
  );
}

function ResultDetail({ title, r }: { title: string; r: WhatIfResponse["current"] }) {
  return (
    <div className="glass space-y-2 p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{title}</div>
      <div className="grid grid-cols-3 gap-2 text-sm text-slate-400">
        <div>AQI risk: <span className="tabular-nums text-slate-200">{r.aqi_risk.toFixed(1)}</span></div>
        <div>Flood risk: <span className="tabular-nums text-slate-200">{r.flood_risk.toFixed(1)}</span></div>
        <div>Traffic risk: <span className="tabular-nums text-slate-200">{r.traffic_risk.toFixed(1)}</span></div>
      </div>
      <div className="text-[11px] text-slate-600">
        predicted AQI {r.predicted_aqi} · flood via {r.flood_model_used} · traffic via {r.traffic_model_used}
      </div>
    </div>
  );
}
