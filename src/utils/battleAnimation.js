// Pure, bounded visual scheduler. Gameplay scores are never changed here.
export const TEAM_COLORS = { A: '#9b86c8', B: '#65aa94', C: '#db9679', D: '#76a7d5' };
export function motionProfile(combo = 0, count = 1) {
  const type = combo >= 10 ? 'fever' : combo >= 7 ? 'barrage' : combo >= 5 ? 'rocket' : combo >= 3 ? 'double' : combo >= 2 ? 'power' : 'normal';
  const table = {
    normal: { tier:'normal', shots:1, windup:180, flight:320, radius:18, label:'기본 공격' },
    power: { tier:'combo', shots:1, windup:220, flight:350, radius:28, label:'강화탄' },
    double: { tier:'combo', shots:2, windup:240, flight:360, radius:28, label:'쌍발탄' },
    rocket: { tier:'heavy', shots:1, windup:340, flight:480, radius:48, label:'대형 로켓' },
    barrage: { tier:'heavy', shots:5, windup:280, flight:390, radius:38, label:'집중포격' },
    fever: { tier:'fever', shots:1, windup:550, flight:500, radius:75, label:'피버 · 메테오' },
  };
  const p = table[type], stagger = 90;
  return { ...p, type, stagger, impact:p.windup+p.flight,
    duration:p.windup+p.flight+(p.shots-1)*stagger+(type === 'fever' ? 750 : 600),
    label: `${count > 1 ? `${count}명 합동 · ` : ''}${p.label}` };
}
export function characterPosition(side, index, count) {
  const rows = count > 8 ? 3 : count > 4 ? 2 : 1;
  const row = index % rows;
  const col = Math.floor(index / rows);
  const columns = Math.ceil(count / rows);
  const x = columns === 1 ? 270 : 95 + col * (325 / Math.max(1, columns - 1));
  return { x: side === 'left' ? x + row * 9 : 1000 - x - row * 9, y: (rows === 3 ? 190 : rows === 2 ? 250 : 310) + row * 108 };
}
export function createBattleTimeline() {
  const seen = new Set();
  const pending = new Map();
  let active = [];
  let sequence = 0;
  let impactSequence = 0;
  let visualScores = null;
  return {
    ingest(events, scores, now) {
      for (const [id, event] of Object.entries(events || {})) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (!event.attackerUid || now - Number(event.at || 0) > 3500) continue;
        const team = event.attackerTeam;
        const prior = pending.get(team);
        const members = new Map(prior?.members || []);
        members.set(event.attackerUid, event.attackerName);
        const combo = Math.max(prior?.combo || 0, Number(event.combo || 0));
        const representative = prior && prior.combo > Number(event.combo || 0) ? prior : event;
        pending.set(team, { ...representative, id, at: event.at, combo, attack: Number(event.attack || 0) + (prior?.attack || 0),
          members, scores: { ...scores }, sequence: ++sequence });
      }
      // Firebase keeps only the latest 28–36 events; retain extra ids across removals.
      while (seen.size > 256) seen.delete(seen.values().next().value);
    },
    tick(now) {
      for (const event of active) {
        if (now >= event.startedAt + event.profile.impact && event.sequence > impactSequence) {
          impactSequence = event.sequence;
          visualScores = event.scores;
        }
      }
      active = active.filter(event => now < event.startedAt + event.profile.duration);
      for (const [team, event] of pending) {
        if (active.length >= 4) break;
        active.push({ ...event, profile: motionProfile(event.combo, event.members.size), startedAt: now });
        pending.delete(team);
      }
      return { active: [...active], visualScores, pendingCount: pending.size };
    },
    clear() { pending.clear(); seen.clear(); active = []; visualScores = null; sequence = 0; impactSequence = 0; },
  };
}
