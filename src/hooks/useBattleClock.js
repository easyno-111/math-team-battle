import { useCallback, useEffect, useRef, useState } from "react";
import { onValue, ref } from "firebase/database";

// Shared absolute clock for grading, unit expiry and countdowns on every screen.
export function useBattleClock(database, active = true) {
  const offset = useRef(0);
  const [now, setNow] = useState(0);
  const getNow = useCallback(() => Date.now() + offset.current, []);
  useEffect(() => {
    if (!active) return undefined;
    const tick = () => setNow(getNow());
    const unsubscribe = database ? onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
      offset.current = Number(snapshot.val()) || 0;
      tick();
    }) : () => {};
    const initial = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => { unsubscribe(); window.clearTimeout(initial); window.clearInterval(timer); };
  }, [database, active, getNow]);
  return { now, getNow };
}
