import { NavLink, Outlet } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/", label: "Command Center", icon: "◎", end: true },
  { to: "/map", label: "Live Risk Map", icon: "⬡" },
  { to: "/forecasts", label: "Forecasts", icon: "◷" },
  { to: "/explain", label: "Why (Explainable AI)", icon: "⚙" },
  { to: "/what-if", label: "What-If Simulator", icon: "⇄" },
  { to: "/alerts", label: "Alerts", icon: "⚠" },
  { to: "/health", label: "System Health", icon: "◫" },
];

export default function Layout() {
  return (
    <div className="app-bg relative flex min-h-screen">
      <div className="grid-overlay pointer-events-none absolute inset-x-0 top-0 h-[70vh]" aria-hidden />
      <aside className="relative z-10 hidden w-56 shrink-0 flex-col border-r border-slate-800/60 bg-slate-950/50 p-4 backdrop-blur-xl md:flex">
        <div className="mb-6 px-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-400" />
            </span>
            <span className="text-sm font-semibold tracking-wide text-slate-100">UrbanRisk AI</span>
          </div>
          <div className="mt-0.5 text-[11px] uppercase tracking-[0.22em] text-slate-500">Chennai Command</div>
        </div>
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }: { isActive: boolean }) =>
                `group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-sky-500/10 text-sky-200 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.25)]"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                }`
              }
            >
              <span aria-hidden className="w-4 text-center text-xs opacity-80">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto rounded-lg border border-slate-800/70 bg-slate-900/40 p-3 text-[11px] leading-relaxed text-slate-500">
          Every number on screen is served live by the UrbanRisk backend — nothing is simulated on this page.
        </div>
      </aside>
      <main className="relative z-10 flex-1 overflow-x-hidden p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
