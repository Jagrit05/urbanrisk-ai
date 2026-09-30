import { createContext, useContext, type ReactNode } from "react";
import { useDashboardStream, type StreamStatus } from "./useDashboardStream";
import type { DashboardResponse } from "./types";

interface DashboardStreamContextValue {
  data: DashboardResponse | null;
  status: StreamStatus;
  error: string | null;
}

const DashboardStreamContext = createContext<DashboardStreamContextValue | null>(null);

/**
 * Opens the ONE SSE connection to /api/stream/dashboard for the whole app.
 * Wrap this around <Routes> (see App.tsx) so Dashboard, the risk map, and
 * anything else that wants live per-zone risk data all read from the same
 * connection instead of each page opening its own EventSource.
 */
export function DashboardStreamProvider({ children }: { children: ReactNode }) {
  const stream = useDashboardStream();
  return <DashboardStreamContext.Provider value={stream}>{children}</DashboardStreamContext.Provider>;
}

export function useDashboardStreamContext(): DashboardStreamContextValue {
  const ctx = useContext(DashboardStreamContext);
  if (!ctx) {
    throw new Error("useDashboardStreamContext must be used inside <DashboardStreamProvider>");
  }
  return ctx;
}
