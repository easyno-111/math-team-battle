import { useEffect, useRef } from "react";
import { createArena } from "./arena.js";
import "./battle.css";

// Only events newer than this on mount are replayed; older ones are already reflected in team state.
const REPLAY_WINDOW_MS = 4000;

export default function BattleArena({ teams, events, members, playing }) {
  const canvasRef = useRef(null);
  const arenaRef = useRef(null);
  const seenRef = useRef(new Set());
  const mountedAtRef = useRef(0);

  useEffect(() => {
    mountedAtRef.current = Date.now();
    const canvas = canvasRef.current;
    const arena = createArena(canvas, { reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
    arenaRef.current = arena;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) arena.resize(width);
    });
    observer.observe(canvas.parentElement);
    arena.resize(canvas.parentElement.clientWidth || 960);
    arena.start();
    return () => { observer.disconnect(); arena.destroy(); arenaRef.current = null; };
  }, []);

  useEffect(() => {
    arenaRef.current?.setTeams(teams || {}, members || {});
  }, [teams, members]);

  useEffect(() => {
    const arena = arenaRef.current;
    if (!arena || !events) return;
    const seen = seenRef.current;
    const fresh = Object.entries(events)
      .filter(([id, event]) => !seen.has(id) && event?.team)
      .sort((a, b) => Number(a[1].at || 0) - Number(b[1].at || 0));
    for (const [id, event] of fresh) {
      seen.add(id);
      if (Number(event.at || 0) < mountedAtRef.current - REPLAY_WINDOW_MS) continue;
      arena.pushEvent(event);
    }
    if (seen.size > 400) seen.clear();
  }, [events]);

  useEffect(() => {
    const arena = arenaRef.current;
    if (!arena) return undefined;
    if (playing) arena.start();
    return undefined;
  }, [playing]);

  return (
    <div className="battle-arena" aria-label="박 터뜨리기 전투 화면">
      <canvas ref={canvasRef} className="battle-canvas" />
    </div>
  );
}
