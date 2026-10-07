import { useEffect, useState } from "react";

// Ticks once a second while active. Returns 0 until the first tick so callers can show a placeholder.
export function useNow(active, intervalMs = 1000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const tick = () => setNow(Date.now());
    const initial = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, intervalMs);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [active, intervalMs]);
  return now;
}

export function formatRemaining(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
