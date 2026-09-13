import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { REVEAL_EFFECT_MS, revealCelebration } from './celebration';

function RevealBurst({ elapsed, label }) {
  const [initialElapsed] = useState(elapsed);
  const [active, setActive] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setActive(false), Math.max(0, REVEAL_EFFECT_MS - initialElapsed));
    return () => clearTimeout(timer);
  }, [initialElapsed]);
  if (!active) return null;
  const effect = <div className="qm-reveal-effect" aria-hidden="true" style={{ '--burst-seek': `${-initialElapsed}ms` }}>
    <strong className="qm-reveal-pop">{label}</strong>
    {[0, 1, 2].map(burst => <div key={burst} className={`qm-confetti-burst burst-${burst}`} style={{ '--burst-delay': `${burst * 420}ms` }}>
      <span className="qm-burst-ring"/>
      {Array.from({ length: 16 }, (_, i) => {
        const angle = (i * 137.508 + burst * 23) * Math.PI / 180;
        const distance = 100 + i % 4 * 34;
        return <i key={i} style={{ '--piece-x': `${Math.cos(angle) * distance}px`, '--piece-y': `${Math.sin(angle) * distance}px`, '--piece-rotation': `${i * 73}deg`, '--piece-color': ['#efc75e', '#8acbb2', '#e79879', '#91b9dd', '#fff4bf'][i % 5] }}/>;
      })}
    </div>)}
  </div>;
  // Keep bursts on the viewport even inside a scrolling or transformed panel.
  return typeof document === 'undefined' ? effect : createPortal(effect, document.body);
}

export default function QuizRevealEffect({ room, uid, host = false, now }) {
  const celebration = revealCelebration(room, uid, host, now);
  return celebration ? <RevealBurst key={`${room.roundId}:${room.revealedAt}`} {...celebration}/> : null;
}
