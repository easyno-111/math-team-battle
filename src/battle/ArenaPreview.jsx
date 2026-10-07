import { useEffect, useMemo, useRef, useState } from "react";
import { configuredTeams, TEAM_META } from "../game/teams";
import { BASE_DAMAGE, createTeamState, resolveVolley, summonUnit } from "../game/rules";
import BattleArena from "./BattleArena";
import "../styles/base.css";

const NAMES = ["민수", "서연", "지호", "하린", "도윤", "예린", "시우", "유나"];
const DIFFS = Object.keys(BASE_DAMAGE);

// Local-only rehearsal of the arena: ?mode=preview. No Firebase, random volleys on a timer.
export default function ArenaPreview() {
  const [teamCount, setTeamCount] = useState(2);
  const [auto, setAuto] = useState(true);
  const teamIds = useMemo(() => configuredTeams(teamCount), [teamCount]);
  const [teams, setTeams] = useState(() => Object.fromEntries(configuredTeams(2).map((id) => [id, createTeamState(5, 3)])));
  const [events, setEvents] = useState({});
  const [matchId, setMatchId] = useState(1);
  const streaks = useRef({});

  const reset = (count = teamCount) => {
    const ids = configuredTeams(count);
    setTeams(Object.fromEntries(ids.map((id) => [id, createTeamState(5, 3)])));
    setEvents({});
    streaks.current = {};
    setMatchId((value) => value + 1);
  };

  const fire = (team, forcedStreak) => {
    setTeams((current) => {
      if (!current[team] || current[team].hp <= 0 || Object.values(current).some((state) => state.hp <= 0)) return current;
      const streak = forcedStreak ?? (streaks.current[team] = (streaks.current[team] || 0) + (Math.random() < 0.75 ? 1 : -(streaks.current[team] || 0)));
      const unit = summonUnit(Math.max(1, streak));
      const volley = resolveVolley({ teams: current, teamId: team, difficulty: DIFFS[Math.floor(Math.random() * DIFFS.length)], unit });
      const event = { at: Date.now(), team, attackerUid: `demo-${team}`, attackerName: NAMES[Math.floor(Math.random() * NAMES.length)], unit, streak: Math.max(1, streak), damage: volley.damage, shieldUsed: volley.shieldUsed, heal: volley.heal, shieldGiven: volley.shieldGiven, hpAfter: volley.hpAfter, burst: volley.burst };
      setEvents((list) => ({ ...list, [`${Date.now()}-${Math.random().toString(36).slice(2, 7)}`]: event }));
      return volley.teams;
    });
  };

  useEffect(() => {
    if (!auto) return undefined;
    const timer = window.setInterval(() => fire(teamIds[Math.floor(Math.random() * teamIds.length)]), 1400);
    return () => window.clearInterval(timer);
  }, [auto, teamIds]);

  return (
    <main className="app-shell" style={{ alignItems: "flex-start" }}>
      <div style={{ width: "min(1200px, 100%)", display: "grid", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <strong>전투 연출 미리보기</strong>
          {[2, 3, 4].map((count) => <button type="button" key={count} className="secondary-button" onClick={() => { setTeamCount(count); reset(count); }} aria-pressed={teamCount === count}>{count}팀</button>)}
          <button type="button" className="secondary-button" onClick={() => setAuto((value) => !value)}>{auto ? "자동 정답 멈춤" : "자동 정답 재생"}</button>
          <button type="button" className="secondary-button" onClick={() => reset()}>다시 시작</button>
          {teamIds.map((team) => (
            <span key={team} style={{ display: "inline-flex", gap: 4 }}>
              <button type="button" className="secondary-button" style={{ borderColor: TEAM_META[team].color }} onClick={() => fire(team)}>{team}팀 정답</button>
              <button type="button" className="secondary-button" onClick={() => fire(team, 5)}>강화</button>
              <button type="button" className="secondary-button" onClick={() => fire(team, 10)}>정예</button>
            </span>
          ))}
        </div>
        <BattleArena key={matchId} teams={teams} events={events} members={{}} playing />
        <p style={{ color: "#777", fontSize: 12 }}>이 화면은 Firebase 없이 규칙 모듈만으로 돌아가는 연습용입니다. 실제 경기와 같은 계산을 씁니다.</p>
      </div>
    </main>
  );
}
