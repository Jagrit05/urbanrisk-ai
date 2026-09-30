import { useEffect, useState } from "react";

/**
 * Owns its own setInterval + state entirely inside this component, so the
 * once-a-second re-render is scoped to this small subtree — NOT the Dashboard
 * (or anything above it). Per the redesign brief: "the live clock must not
 * rerender the entire application every second."
 */
export default function LiveClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
  const date = now.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

  return (
    <div className="text-right">
      <div className="font-mono text-sm font-medium text-slate-200 tabular-nums">{time}</div>
      <div className="text-xs text-slate-500">
        {date} · IST · UTC+5:30
      </div>
    </div>
  );
}
