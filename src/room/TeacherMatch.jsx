import { useMemo, useState } from "react";
import { TEAM_META, teamLabel, teamShort } from "../game/teams";
import { hpRatio, normalizeTeams, rankTeams, UNIT_META, unitLabel, activeUnits, PERSONAL_SQUAD_SIZE } from "../game/rules";
import { formatRemaining } from "../hooks/useNow";
import { adminRealtime } from "../realtime";
import { useBattleClock } from "../hooks/useBattleClock";
import BattleArena from "../battle/BattleArena";
import { rankMembers } from "./roomUtils";
import battleArenaBg from "../assets/game/battle-arena.webp";

function TeamRoster({ team, participants, playerStates, teamState, now }) {
  const ranked = rankMembers(participants, playerStates);
  const squad = now ? activeUnits(teamState?.squad, now) : [];
  const counts = squad.reduce((acc, unit) => { acc[unit.cls] = (acc[unit.cls] || 0) + 1; return acc; }, {});
  return (
    <div className={`match-team-list match-team-${team.toLowerCase()}`}>
      <div className="match-team-list-title"><span>{team} TEAM</span><strong>{teamLabel(team)}</strong></div>
      <div className="team-squad-summary">
        {Object.keys(UNIT_META).map((cls) => counts[cls] ? <span key={cls}>{UNIT_META[cls].label} {counts[cls]}</span> : null)}
        {!squad.length && <span>아직 소환된 용사가 없어요</span>}
      </div>
      <div className="match-student-list" tabIndex={0} aria-label={`${team}팀 순위 목록`}>
        {ranked.map((person) => {
          const state = playerStates[person.id] || {};
          const streak = Number(state.streak || 0);
          const own = squad.filter((unit) => unit.ownerUid === person.id);
          return (
            <div className={`match-student-row rank-${person.rank <= 3 && person.damage > 0 ? person.rank : "other"}`} key={person.id}>
              <b className="team-rank-number">{person.tied ? "=" : ""}{person.rank}</b>
              <div className="team-rank-person">
                <strong title={person.name}>{person.name}</strong>
                <span>{streak >= 2 ? `${streak}연속 정답` : `정답 ${state.correctCount || 0}`} · 내 용사 {own.length}/{PERSONAL_SQUAD_SIZE}</span>
                <span className="match-owner-units">
                  {own.map((unit) => <span key={unit.id}>{unitLabel(unit)} {Math.max(0, Math.ceil((unit.expiresAt - now) / 1000))}초</span>)}
                  {!own.length && "소환 대기"}
                </span>
              </div>
              <div className="match-student-stats"><b>{person.damage}</b><small>피해</small></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TeacherMatch({ room, roomCode, teams, participants, byTeam, message, onFinish, onResolveTie, onRestart, onClose }) {
  const playing = room.status === "playing";
  const finished = room.status === "finished";
  const { now, getNow } = useBattleClock(adminRealtime);
  const remaining = playing ? Number(room.scheduledEndAt || now) - now : 0;
  const teamStates = useMemo(() => normalizeTeams(room.teams), [room.teams]);
  const ranking = useMemo(() => rankTeams(teamStates), [teamStates]);
  const memberNames = useMemo(() => Object.fromEntries(teams.map((team) => [team, (byTeam[team] || []).map((p) => p.name)])), [teams, byTeam]);
  const [closing, setClosing] = useState(false);
  const tied = Array.isArray(room.tiedTeams) ? room.tiedTeams : [];
  const winner = room.winner;

  return (
    <section className="teacher-match-shell" style={{ backgroundImage: `url(${battleArenaBg})` }}>
      <div className="match-scene-shade" />

      <header className="teacher-match-scoreboard" style={{ "--teams": teams.length }}>
        {teams.map((team) => {
          const state = teamStates[team];
          const ratio = state ? hpRatio(state) : 1;
          return (
            <div key={team} className={`match-score team-${team.toLowerCase()}-score ${winner === team ? "is-winner" : ""}`}>
              <span>{teamShort(team)}</span>
              <strong>{state ? Math.round(state.hp) : 0}</strong>
              <div className="match-score-bar"><i style={{ width: `${Math.round(ratio * 100)}%`, background: TEAM_META[team].color }} /></div>
              <small>{state ? `박 ${Math.round(ratio * 100)}% · 소환 ${state.summoned}` : ""}</small>
            </div>
          );
        })}
        <div className="match-center-info">
          <span>박 터뜨리기</span>
          <strong>{playing ? (now ? formatRemaining(remaining) : "--:--") : "FINISH"}</strong>
          <small>ROOM {roomCode} · {room.title}</small>
        </div>
      </header>

      {finished && (
        <div className="match-result-banner">
          <span>{room.finishReason === "burst" ? "박이 터졌어요!" : room.finishReason === "time" ? "시간 종료" : "경기 종료"}</span>
          <strong>{winner ? `${teamLabel(winner)} 승리` : tied.length ? "동점!" : "무승부"}</strong>
          {tied.length > 0 && !winner && (
            <div className="tournament-tie-actions">
              <small>박 체력이 같아요. 승리팀을 골라주세요.</small>
              {tied.map((team) => <button type="button" key={team} onClick={() => onResolveTie(team)}>{teamLabel(team)} 승리</button>)}
            </div>
          )}
          <p>{ranking.map((row) => `${row.rank}위 ${teamShort(row.team)} ${Math.round(row.ratio * 100)}%`).join(" · ")}</p>
        </div>
      )}

      <BattleArena key={room.matchId} teams={room.teams || {}} events={room.battleEvents} members={memberNames} playing={playing} getNow={getNow} />

      <div className={`match-roster-grid team-count-${teams.length}`}>
        {teams.map((team) => <TeamRoster key={team} team={team} participants={byTeam[team] || []} playerStates={room.playerStates || {}} teamState={teamStates[team]} now={now} />)}
      </div>

      <div className="teacher-match-controls">
        {playing && <button type="button" className="match-finish-button" onClick={onFinish}>지금 경기 종료</button>}
        {finished && <button type="button" className="match-finish-button" onClick={onRestart}>같은 학생으로 다시 하기</button>}
        {!closing ? (
          <button type="button" className="match-close-button" onClick={() => setClosing(true)}>방 닫기</button>
        ) : (
          <div className="close-room-confirm match-close-confirm"><span>게임방까지 삭제할까요?</span><button type="button" onClick={() => setClosing(false)}>취소</button><button type="button" onClick={onClose}>방 닫기</button></div>
        )}
        {message && <div className="lobby-toast">{message}</div>}
      </div>
      <div className="battle-guide">정답 → 내 용사 소환 → 내 용사만 행동 · 개인 최대 3명 · 각 45초 후 퇴장 · 5연속 정답은 강화 용사, 10연속은 정예 용사 · 힐러는 앞서가는 상대 박을 회복, 팔라딘은 상대 박을 수호 · 먼저 박을 터뜨리는 팀이 승리 · {participants.length}명 참가</div>
    </section>
  );
}

