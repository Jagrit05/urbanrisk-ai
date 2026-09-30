import type {
  DashboardResponse,
  ForecastResponse,
  RiskMapResponse,
  ExplainResponse,
  WhatIfRequest,
  WhatIfResponse,
  AlertsResponse,
  ModelHealthResponse,
  DataHealthResponse,
  SeedObservationRequest,
} from "./types";

// Set VITE_API_BASE_URL in .env for anything other than local dev against
// `uvicorn app.main:app` on the default port.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    // FastAPI's HTTPException body is {"detail": "..."} — surface that exact
    // message (e.g. "No live observation for CHN_ADYAR yet") instead of a
    // generic "request failed", since these are deliberately informative.
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* body wasn't JSON — keep statusText */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getDashboard: () => request<DashboardResponse>("/api/dashboard"),

  getForecast: (zoneId: string) => request<ForecastResponse>(`/api/forecast/${zoneId}`),

  getRiskMap: () => request<RiskMapResponse>("/api/risk-map"),

  getExplain: (zoneId: string, horizon: 6 | 12 | 24 = 6) =>
    request<ExplainResponse>(`/api/explain/${zoneId}?horizon=${horizon}`),

  postWhatIf: (body: WhatIfRequest) =>
    request<WhatIfResponse>("/api/what-if", { method: "POST", body: JSON.stringify(body) }),

  getAlerts: (minCategory = "High") =>
    request<AlertsResponse>(`/api/alerts?min_category=${minCategory}`),

  getModelHealth: () => request<ModelHealthResponse>("/api/model-health"),

  getDataHealth: () => request<DataHealthResponse>("/api/data-health"),

  // Dev-only convenience (matches the backend's dev-only endpoint) — lets the UI be
  // exercised end-to-end before M6's ingestion worker has completed a cycle. Not
  // part of the original spec's endpoint list; remove this call site along with the
  // backend route before any real deployment.
  devSeedObservation: (body: SeedObservationRequest) =>
    request<{ status: string; zone_id: string; observed_at: string }>(
      "/api/dev/seed-observation",
      { method: "POST", body: JSON.stringify(body) }
    ),
};

export { ApiError };
