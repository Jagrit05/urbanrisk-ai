export default function LiveStatusBadge({
  status,
  ageMinutes,
}: {
  status: "LIVE" | "STALE" | "NO_DATA" | undefined;
  ageMinutes?: number | null;
}) {
  if (!status || status === "NO_DATA") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
        no observation yet
      </span>
    );
  }
  const isLive = status === "LIVE";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${
        isLive ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300" : "border-amber-500/40 bg-amber-950/40 text-amber-300"
      }`}
      title={ageMinutes != null ? `${ageMinutes.toFixed(1)} min old` : undefined}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-emerald-400" : "bg-amber-400"}`} />
      {status}
      {ageMinutes != null && <span className="font-normal opacity-75">· {ageMinutes.toFixed(0)}m old</span>}
    </span>
  );
}
