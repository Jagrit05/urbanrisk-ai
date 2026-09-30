/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        risk: {
          low: "#10b981",
          moderate: "#eab308",
          elevated: "#f59e0b",
          high: "#fb923c",
          critical: "#ef4444",
        },
        grid: "#1c2a3f",
        ink: "#050b16",
        ink2: "#0a1424",
      },
      boxShadow: {
        glass: "inset 0 1px 0 0 rgba(148,163,184,0.08)",
        "glow-red": "0 0 18px rgba(239,68,68,0.45)",
        "glow-orange": "0 0 18px rgba(245,158,11,0.45)",
        "glow-green": "0 0 18px rgba(16,185,129,0.45)",
      },
      animation: {
        "pulse-slow": "pulse 3.2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
