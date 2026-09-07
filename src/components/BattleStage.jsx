import { useEffect, useMemo, useRef, useState } from 'react';
import { characterPosition, createBattleTimeline, TEAM_COLORS } from '../utils/battleAnimation';
import './BattleStage.css';
import { rankTeam } from '../utils/teamRanking';

function useTimeline(events, scores, playing) {
  const [frame, setFrame] = useState({ active: [], visualScores: scores });
  const timeline = useRef(null);
  if (timeline.current === null) timeline.current = createBattleTimeline();
  useEffect(() => {
    if (playing) timeline.current.ingest(events, scores, Date.now());
  }, [events, scores, playing]);
  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => {
      const next = timeline.current.tick(Date.now());
      setFrame(previous => {
        const same = previous.active.length === next.active.length && previous.active.every((event, i) => event.id === next.active[i].id);
        if (same && (!next.visualScores || previous.visualScores === next.visualScores)) return previous;
        return { active: next.active, visualScores: next.visualScores || previous.visualScores };
      });
    }, 100);
    const current = timeline.current;
    return () => { window.clearInterval(timer); current.clear(); };
  }, [playing]);
  return playing ? frame : { active: [], visualScores: scores };
}

function HitMotion({ event, direction, index }) {
  const animation = useRef(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = window.setTimeout(() => animation.current?.beginElement(), event.profile.impact + index * event.profile.stagger);
    return () => window.clearTimeout(timer);
  }, [event, index]);
  const distance = index < event.profile.shots - 1 ? 9 : event.profile.tier === 'normal' ? 12 : event.profile.tier === 'fever' ? 48 : event.profile.tier === 'heavy' ? 32 : 20;
  return <animateTransform ref={animation} attributeName="transform" type="translate" additive="sum"
    values={`0 0;${-direction * distance} -8;${-direction * distance} -8;${direction * 3} 1;0 0`}
    keyTimes="0;.12;.25;.8;1" dur=".42s" begin="indefinite" fill="remove" />;
}

function TeamHop({ event }) {
  const animation = useRef(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = window.setTimeout(() => animation.current?.beginElement(), event.profile.windup);
    return () => window.clearTimeout(timer);
  }, [event]);
  return <animateTransform ref={animation} attributeName="transform" type="translate" additive="sum"
    values="0 0;0 -7;0 1;0 0" keyTimes="0;.35;.8;1" dur=".36s" begin="indefinite" fill="remove" />;
}

function Person({ person, attacks, rank }) {
  const incoming = attacks.filter(event => event.targetUid === person.id);
  const outgoing = attacks.filter(event => event.members.has(person.id));
  const color = TEAM_COLORS[person.team];
  const fever = attacks.find(event => event.attackerTeam === person.team && event.profile.tier === 'fever');
  const direction = person.side === 'left' ? 1 : -1;
  return <g transform={`translate(${person.x} ${person.y})`} style={{ '--team-color': color, '--facing': direction }}>
    {outgoing.length > 0 && <ellipse cy="-29" rx="29" ry="43" fill={color} opacity=".2" />}
    {incoming.length > 0 && <g className="battle-v10-target"><circle cy="-36" r="32" /><path d="M-42 -36 h18 M24 -36 h18 M0 -78 v18 M0 -12 v18" /><text y="-105" textAnchor="middle">표적</text></g>}
    {rank && rank.contribution > 0 && rank.rank <= 3 && <text className="battle-v10-rank" x="-29" y="-80" textAnchor="end">{rank.rank}위</text>}
    <ellipse cy="7" rx="23" ry="5" fill="#39463b" opacity=".15" />
    <g className="battle-v09-body">
      {fever && <TeamHop key={`${fever.id}-hop`} event={fever} />}
      {fever && <g key={fever.id} className="battle-v09-fever-halo"><ellipse cy="-29" rx="30" ry="40" fill="none" stroke={color} strokeWidth="3" /></g>}
      <g className="battle-v09-idle" style={{ '--idle-delay': `${person.index % 6 * -.3}s` }}>
        <path d="M-8 -18 L-15 1 M8 -18 L17 1" className="battle-v09-legs" />
        <path d="M-20 3 h10 M12 3 h10" stroke="#514955" strokeWidth="6" strokeLinecap="round" />
        <rect x="-14" y="-44" width="28" height="29" rx="8" fill={color} stroke="#514955" strokeWidth="2" />
        <g transform={`translate(${direction * 8} -36) scale(${direction} 1)`}>
          <path d="M0 0 L10 10 L20 7" fill="none" stroke="#edc7a4" strokeWidth="7" strokeLinecap="round" />
          {outgoing.map(event => <path key={event.id} className="battle-v09-arm" d="M0 0 L9 -7 L20 7" fill="none" stroke="#edc7a4" strokeWidth="7" strokeLinecap="round" />)}
        </g>
        <rect x="-14" y="-71" width="28" height="28" rx="9" fill="#efc9a7" stroke="#66505a" strokeWidth="2" />
        <path d="M-13 -59 v-6 q0 -10 13 -9 q14 0 14 12 l-8 -4 -5 4 -5 -4 -9 7" fill="#65515b" />
        <circle cx={direction * 4 - 4} cy="-56" r="1.5" fill="#4c4149" /><circle cx={direction * 4 + 4} cy="-56" r="1.5" fill="#4c4149" />
        <path d="M-3 -50 q3 3 6 0" fill="none" stroke="#b7726c" strokeWidth="1.5" />
      </g>
      {incoming.flatMap(event => Array.from({ length: event.profile.shots }, (_, index) => <HitMotion key={`${event.id}-${index}`} event={event} direction={direction} index={index} />))}
    </g>
    <g className="battle-v09-name"><title>{person.name}</title><rect x="-35" y="-96" width="70" height="19" rx="7" fill="#fffdf7" opacity=".94" /><text y="-82" textAnchor="middle">{String(person.name || "학생").length > 6 ? `${String(person.name).slice(0, 5)}…` : person.name}</text></g>
    {outgoing.map(event => <g key={event.id} className="battle-v09-badge"><rect x="-32" y="-119" width="64" height="19" rx="8" fill={color} /><text y="-106" textAnchor="middle" fill="white">{event.members.size > 1 ? '합동 발사' : '공격!'}</text></g>)}
  </g>;
}

function Shot({ event, start, end, index }) {
  const { profile } = event;
  const visibility = useRef(null);
  const motion = useRef(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = window.setTimeout(() => {
      visibility.current?.beginElement();
      motion.current?.beginElement();
    }, profile.windup + index * profile.stagger);
    return () => window.clearTimeout(timer);
  }, [profile, index]);
  const direction = end.x > start.x ? 1 : -1;
  const sx = start.x + direction * 28;
  const sy = start.y - 29;
  const ex = end.x;
  const ey = end.y - 37;
  const delay = profile.windup + index * profile.stagger;
  const hit = (delay + profile.flight) / 1000;
  const path = `M ${sx} ${sy} Q ${(sx + ex) / 2} ${Math.min(sy, ey) - (profile.type === 'fever' ? 140 : 85) - index * 12} ${ex} ${ey}`;
  return <g style={{ '--team-color': TEAM_COLORS[event.attackerTeam] }}>
    <g className="battle-v09-shot" visibility="hidden">
      <set ref={visibility} attributeName="visibility" to="visible" begin="indefinite" dur={`${profile.flight / 1000}s`} />
      <animateMotion ref={motion} path={path} begin="indefinite" dur={`${profile.flight / 1000}s`} rotate="auto" calcMode="linear" fill="freeze" />
      {profile.type === 'rocket' || profile.type === 'barrage' ? <g>
        <path d="M-25 -6 L-46 0 -25 6Z" fill="#ffbd54" /><path d="M-20 -9 H12 L28 0 12 9 H-20Z" fill={TEAM_COLORS[event.attackerTeam]} stroke="#fff6d7" strokeWidth="2" />
        <path d="M-14 -9 L-26 -19 -24 -4 M-14 9 L-26 19 -24 4" fill={TEAM_COLORS[event.attackerTeam]} /><circle cx="9" r="4" fill="#fff" />
      </g> : profile.type === 'fever' ? <g>
        <path d="M-94 0 L-11 -21 -22 0 -11 21Z" fill="#ffc14d" opacity=".85" />
        <ellipse rx="27" ry="22" fill="#ffb34a" stroke="#fff4be" strokeWidth="5" /><circle r="13" fill="#fff8da" />
      </g> : <g>
        <path d="M-40 0 L-6 -4 L-6 4 Z" fill={TEAM_COLORS[event.attackerTeam]} opacity=".6" />
        <ellipse rx={profile.type === 'normal' ? 9 : 17} ry={profile.type === 'normal' ? 6 : 12} fill={TEAM_COLORS[event.attackerTeam]} stroke="#fffbea" strokeWidth="3" />
        {profile.type !== 'normal' && <circle r="5" fill="#fff8e9" />}
      </g>}

    </g>
    <g transform={`translate(${ex} ${ey})`} className={`battle-v09-impact tier-${profile.tier}`} style={{ '--hit-delay': `${hit}s` }}>
      <text className="battle-v10-damage" y="-24" textAnchor="middle">{index === profile.shots - 1 ? `HIT ${event.attack}` : 'HIT'}</text>
      {profile.tier === 'fever' && <circle className="battle-v09-ring meteor-wave" r="105" />}
      <circle className="battle-v09-ring" r={index === profile.shots - 1 ? profile.radius : profile.radius * .65} />
      {Array.from({ length: profile.tier === "fever" ? 12 : 8 }, (_, i) => i * (profile.tier === "fever" ? 30 : 45)).map(angle => <g key={angle} transform={`rotate(${angle})`}><path className="battle-v09-spark" d="M8 0 h13" /></g>)}
    </g>
  </g>;
}

export default function BattleStage({ leftTeam, rightTeam, leftParticipants, rightParticipants, room, playing }) {
  const scores = useMemo(() => room.scores || {}, [room.scores]);
  const { active, visualScores } = useTimeline(room.battleEvents, scores, playing);
  const characters = useMemo(() => [
    ...leftParticipants.map((p, index) => ({ ...p, team: leftTeam, side: 'left', index, ...characterPosition('left', index, leftParticipants.length) })),
    ...rightParticipants.map((p, index) => ({ ...p, team: rightTeam, side: 'right', index, ...characterPosition('right', index, rightParticipants.length) })),
  ], [leftParticipants, rightParticipants, leftTeam, rightTeam]);
  const ranks = new Map([...rankTeam(leftParticipants, room.playerStates || {}), ...rankTeam(rightParticipants, room.playerStates || {})].map(person => [person.id, person]));
  const featured = active.reduce((best, event) => !best || event.combo > best.combo ? event : best, null);
  const byId = new Map(characters.map(p => [p.id, p]));
  const leftScore = Number(visualScores[leftTeam] || 0);
  const rightScore = Number(visualScores[rightTeam] || 0);
  const shift = Math.max(-55, Math.min(55, (rightScore - leftScore) / Math.max(8, (leftScore + rightScore) * .58) * 55));
  const winner = !playing && room.winner && room.winner !== 'draw' ? room.winner : null;
  return <div className="battle-v09" aria-label="팀 줄다리기 전투">
    <div className="battle-v09-heading"><span style={{ color: TEAM_COLORS[leftTeam] }}>{leftTeam} TEAM</span><small>{playing ? '정답을 맞혀 우리 팀을 당겨주세요' : '경기 종료'}</small><span style={{ color: TEAM_COLORS[rightTeam] }}>{rightTeam} TEAM</span></div>
    {featured?.combo >= 5 && <div key={featured.id} className={`battle-v10-special-title tier-${featured.profile.tier}`}><strong>{featured.combo} COMBO · {featured.profile.label}</strong><small>{featured.attackerName} → {byId.get(featured.targetUid)?.name || featured.targetName || '상대팀'}</small></div>}
    <svg viewBox="0 0 1000 460" role="img" aria-label="학생 캐릭터와 실시간 공격 장면">
      <defs><linearGradient id="battle-v09-ground" x2="0" y2="1"><stop stopColor="#fbf6e9" /><stop offset="1" stopColor="#e8eddd" /></linearGradient></defs>
      <rect x="20" y="92" width="960" height="345" rx="45" fill="url(#battle-v09-ground)" opacity=".94" />
      <path d="M500 110 V427" stroke="#c4bcaa" strokeWidth="2" strokeDasharray="5 9" />
      <text x="500" y="79" textAnchor="middle" className="battle-v09-center">CENTER</text>
      <g className="battle-v09-rope" style={{ transform: `translateX(${shift}px)` }}>
        {[...new Set(characters.map(person => person.y - 29))].map(y => <g key={y}>
          <path d={`M60 ${y} H440 Q480 ${y} 500 353 Q520 ${y} 560 ${y} H940`} stroke="#906a48" strokeWidth="7" fill="none" strokeLinecap="round" />
          <path d={`M60 ${y - 1} H440 Q480 ${y} 500 353 Q520 ${y} 560 ${y - 1} H940`} stroke="#d7b184" strokeWidth="3" strokeDasharray="8 4" fill="none" />
        </g>)}
        <path d="M500 339 l12 14 -12 14 -12 -14Z" fill="#ed9d86" stroke="#fff4dc" strokeWidth="3" />
      </g>
      {characters.map(person => <Person key={person.id} person={person} attacks={active} rank={ranks.get(person.id)} />)}
      {active.map(event => {
        const start = byId.get(event.attackerUid);
        const end = byId.get(event.targetUid);
        if (!start || !end) return null;
        return <g key={event.id} className={`battle-v09-event attack-type-${event.profile.type}`}>
          <path className="battle-v10-aim" d={`M${start.x} ${start.y - 30} L${end.x} ${end.y - 36}`} stroke={TEAM_COLORS[event.attackerTeam]} />
          <g transform={`translate(${start.x} ${start.y - 32})`} style={{ '--charge-duration': `${event.profile.windup / 1000}s` }}>
            <circle className="battle-v10-charge" r={event.profile.tier === 'fever' ? 43 : event.profile.tier === 'heavy' ? 30 : 18} fill="none" stroke={TEAM_COLORS[event.attackerTeam]} />
          </g>
          {event.id === featured?.id && (event.profile.tier === 'heavy' || event.profile.tier === 'fever') && <rect className="battle-v10-field-flash" x="20" y="92" width="960" height="345" rx="45" style={{ '--hit-delay': `${event.profile.impact / 1000}s` }} />}

          {Array.from({ length: event.profile.shots }, (_, index) => <Shot key={index} event={event} start={start} end={end} index={index} />)}
        </g>;
      })}
    </svg>
    <div className="battle-v09-notices" aria-live="off">{active.map(event => {
      const targetName = byId.get(event.targetUid)?.name || event.targetName || '상대팀';
      const memberNames = [...event.members.values()].join(', ');
      return <div key={event.id} className={`battle-v09-notice tier-${event.profile.tier}`} style={{ '--team-color': TEAM_COLORS[event.attackerTeam] }} title={`${memberNames} → ${targetName}`}>
        <b>{event.attackerTeam}팀 {event.attackerName}{event.members.size > 1 ? ` 외 ${event.members.size - 1}명` : ''} → {event.targetTeam}팀 {targetName}</b>
        <span>{event.combo >= 2 ? `${event.combo}콤보 · ` : ''}{event.profile.label}</span><strong>+{event.attack}</strong>
      </div>;
    })}</div>
    <div className="battle-v10-combo-guide">2콤보 강화탄 · 3콤보 쌍발탄 · 5콤보 대형 로켓 · 7콤보 집중포격 · 10콤보 피버</div>

    {winner && <div className="battle-v09-victory" style={{ '--team-color': TEAM_COLORS[winner] }}><small>FINISH</small><strong>{winner}팀 승리!</strong><span>{Number(scores[leftTeam] || 0)} : {Number(scores[rightTeam] || 0)}</span><div>{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--x': `${7 + i * 6.5}%`, '--delay': `${i % 5 * .08}s`, '--turn': `${i * 37}deg` }} />)}</div></div>}
  </div>;
}
