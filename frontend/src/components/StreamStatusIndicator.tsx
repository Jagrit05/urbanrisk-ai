import type { StreamStatus } from "../api/useDashboardStream";

const LABELS: Record<StreamStatus, string> = {
  connecting: "CONNECTING…",
  live: "LIVE (SSE)",
  "polling-fallback": "POLLING (SSE UNAVAILABLE)",
  error: "RECONNECTING…",
};

const DOT: Record<StreamStatus, string> = {
  connecting: "bg-slate-400 animate-pulse",
  live: "bg-emerald-400",
  "polling-fallback": "bg-amber-400",
  error: "bg-amber-400 animate-pulse",
};

const RING: Record<StreamStatus, string> = {
  connecting: "border-slate-700 text-slate-300",
  live: "border-emerald-500/40 bg-emerald-950/40 text-emerald-300",
  "polling-fallback": "border-amber-500/40 bg-amber-950/40 text-amber-300",
  error: "border-amber-500/40 bg-amber-950/40 text-amber-300",
};

export default function StreamStatusIndicator({ status }: { status: StreamStatus }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.14em] ${RING[status]}`}>
      <span className="relative flex h-2 w-2">
        {status === "live" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${DOT[status]}`} />
      </span>
      {LABELS[status]}
    </span>
  );
}
