import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { ModelHealthResponse, DataHealthResponse } from "../api/types";

export default function HealthPage() {
  const [models, setModels] = useState<ModelHealthResponse | null>(null);
  const [dataHealth, setDataHealth] = useState<DataHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getModelHealth(), api.getDataHealth()])
      .then(([m, d]) => {
        setModels(m);
        setDataHealth(d);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load health data"));
  }, []);

  if (error) return <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Model &amp; Data Health</h1>
        <p className="text-xs text-slate-500">
          What's actually loaded and serving, and where live data currently stands — read straight from the DB, never hand-typed.
        </p>
      </div>

      <section className="glass p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">AI Models</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-800/70">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60 text-left text-[10px] uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="px-4 py-2">Signal</th>
                <th className="px-4 py-2">Horizon</th>
                <th className="px-4 py-2">Algorithm</th>
                <th className="px-4 py-2">Serving?</th>
                <th className="px-4 py-2">ROC-AUC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {models?.models.map((m, i) => {
                const rocAuc =
                  m.test_metrics && (m.test_metrics["roc_auc"] ?? m.test_metrics["ROC_AUC"] ?? m.test_metrics["R2"]);
                return (
                  <tr key={i} className={m.selected_for_serving ? "bg-emerald-950/20" : ""}>
                    <td className="px-4 py-2 text-slate-300">{m.model_family}</td>
                    <td className="px-4 py-2 text-slate-400">+{m.horizon_hours}h</td>
                    <td className="px-4 py-2 text-slate-400">{m.algorithm}</td>
                    <td className="px-4 py-2">
                      {m.selected_for_serving ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> serving
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 tabular-nums text-slate-400">{rocAuc !== undefined && rocAuc !== null ? rocAuc.toFixed(3) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="glass p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Data Pipelines &amp; Live Connection</h2>
        {dataHealth && <p className="mb-3 text-xs text-slate-500">{dataHealth.note}</p>}
        <div className="overflow-x-auto rounded-lg border border-slate-800/70">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60 text-left text-[10px] uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Age (min)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {dataHealth?.sources.map((s) => (
                <tr key={s.source_name}>
                  <td className="px-4 py-2 text-slate-300">
                    {s.source_name}
                    {s.description && <div className="text-xs text-slate-600">{s.description}</div>}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        s.status === "ok"
                          ? "text-emerald-400"
                          : s.status === "not_yet_connected"
                          ? "text-slate-500"
                          : "text-amber-400"
                      }
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 tabular-nums text-slate-400">{s.age_minutes != null ? s.age_minutes.toFixed(1) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
