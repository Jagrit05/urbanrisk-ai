import { useEffect, useRef, useState } from "react";

/**
 * Rolling per-zone history of urban risk scores, built ONLY from frames the
 * frontend has actually received (SSE dashboard frames or fallback polls).
 * A zone's history grows by one point per distinct frame — no interpolation,
 * no invented backfill. Sparklines simply reflect how much the frontend has
 * seen so far.
 */
export function useZoneHistory(zones: { zone_id: string; urban_risk_score: number }[]) {
  const historyRef = useRef<Map<string, number[]>>(new Map());
  const signatureRef = useRef<string>("");
  const [bump, setBump] = useState(0);

  useEffect(() => {
    const sig = zones.map((z) => `${z.zone_id}:${z.urban_risk_score.toFixed(3)}`).join("|");
    if (sig === signatureRef.current) return;
    signatureRef.current = sig;
    for (const z of zones) {
      const arr = historyRef.current.get(z.zone_id) ?? [];
      const last = arr.length ? arr[arr.length - 1] : null;
      if (last === null || Math.abs(last - z.urban_risk_score) > 1e-6) {
        arr.push(z.urban_risk_score);
        if (arr.length > 40) arr.shift();
        historyRef.current.set(z.zone_id, arr);
      }
    }
    setBump((b) => b + 1);
  }, [zones]);

  return { history: historyRef.current, bump };
}

/** Returns true on the render right after a zone's value actually changed. */
export function useFlashOnChange(value: number): boolean {
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (Math.abs(value - prev.current) > 1e-6) {
      prev.current = value;
      setFlash(true);
      const t = window.setTimeout(() => setFlash(false), 900);
      return () => window.clearTimeout(t);
    }
  }, [value]);
  return flash;
}
