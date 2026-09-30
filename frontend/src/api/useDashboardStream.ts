import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./client";
import type { DashboardResponse } from "./types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const POLL_FALLBACK_MS = 15_000;
const RECONNECT_DELAY_MS = 5_000;

export type StreamStatus = "connecting" | "live" | "polling-fallback" | "error";

/**
 * Subscribes to GET /api/stream/dashboard (Server-Sent Events, added in M8).
 * If the browser's EventSource errors out (network issue, backend restarting,
 * a proxy that doesn't support SSE, etc.) this falls back to plain polling of
 * GET /api/dashboard every 15s rather than leaving the page stuck — the same
 * "graceful fallback, never a crash" principle M6's ingestion worker uses.
 */
export function useDashboardStream() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    function startPollingFallback() {
      setStatus("polling-fallback");
      const poll = () => {
        api
          .getDashboard()
          .then((d) => {
            if (!cancelled) {
              setData(d);
              setError(null);
            }
          })
          .catch((e) => {
            if (!cancelled) setError(e instanceof ApiError ? e.message : "Dashboard fetch failed");
          });
      };
      poll();
      pollRef.current = window.setInterval(poll, POLL_FALLBACK_MS);
    }

    function connect() {
      if (cancelled) return;
      setStatus("connecting");
      const es = new EventSource(`${BASE_URL}/api/stream/dashboard`);
      esRef.current = es;

      es.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data) as DashboardResponse;
          setData(payload);
          setStatus("live");
          setError(null);
        } catch {
          // malformed frame — ignore this one, next one will likely be fine
        }
      };

      es.addEventListener("error", (ev: any) => {
        // Distinguish the backend's own `event: error` frames (still a live
        // connection, just reporting a bad poll cycle) from EventSource's own
        // connection-level error (readyState CLOSED/CONNECTING).
        if (ev?.data) {
          try {
            const body = JSON.parse(ev.data);
            setError(body.detail ?? "Stream reported an error");
          } catch {
            setError("Stream reported an error");
          }
          return;
        }
        if (es.readyState === EventSource.CLOSED) {
          es.close();
          if (!cancelled) {
            setStatus("error");
            // One retry after a short delay; if SSE still isn't reachable, fall
            // back to polling instead of retrying forever.
            window.setTimeout(() => {
              if (cancelled) return;
              const retryEs = new EventSource(`${BASE_URL}/api/stream/dashboard`);
              esRef.current = retryEs;
              retryEs.onmessage = es.onmessage;
              retryEs.onerror = () => {
                retryEs.close();
                if (!cancelled) startPollingFallback();
              };
            }, RECONNECT_DELAY_MS);
          }
        }
      });
    }

    connect();

    return () => {
      cancelled = true;
      esRef.current?.close();
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  return { data, status, error };
}
