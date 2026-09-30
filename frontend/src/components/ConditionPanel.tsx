import type { ConditionLevel } from "../lib/riskStory";

const LEVEL_COLOR: Record<ConditionLevel, string> = {
  Good: "#16a34a",
  Low: "#16a34a",
  Moderate: "#d97706",
  High: "#dc2626",
  Poor: "#dc2626",
};

export default function ConditionPanel({
  icon,
  label,
  level,
  value,
  valueSuffix = "",
  detail,
}: {
  icon: string;
  label: string;
  level: ConditionLevel;
  value: number;
  valueSuffix?: string;
  detail: string;
}) {
  const color = LEVEL_COLOR[level];
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur">
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <span aria-hidden>{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold" style={{ color }}>
          {level}
        </span>
        <span className="text-sm text-slate-500">
          {value.toFixed(1)}
          {valueSuffix}
        </span>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">{detail}</p>
    </div>
  );
}
