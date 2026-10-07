// Fake room data for screen previews (?mode=preview&screen=...). Never touches Firebase.
import { createTeamState } from "../game/rules";

const NAMES = ["김민수", "이서연", "박지호", "최하린", "정도윤", "강예린", "윤시우", "장유나", "오지안", "한도현", "서하율", "임채원"];

export function mockRoom(teamCount = 2, status = "waiting") {
  const teams = ["A", "B", "C", "D"].slice(0, teamCount);
  const participants = {};
  NAMES.forEach((name, index) => {
    participants[`s${index}`] = { uid: `s${index}`, name, team: teams[index % teams.length], online: index % 5 !== 4, joinedAt: 1000 + index };
  });
  const playerStates = Object.fromEntries(Object.keys(participants).map((uid, index) => [uid, {
    currentQuestion: { id: "q1", text: "두 점 A(1, 2), B(4, 6) 사이의 거리는?", choices: ["3", "4", "5", "6"], category: "공통수학2", unit: "평면좌표", difficulty: "보통" },
    correctCount: index % 4, wrongCount: index % 2, streak: index % 6, maxStreak: index % 7, damage: (index * 7) % 40, lockedUntil: 0,
    lastResult: index % 3 === 0 ? { correct: true, unit: { cls: ["warrior", "archer", "mage", "healer", "paladin"][index % 5], tier: 1 }, streak: 2, damage: 12 } : null,
  }]));
  const teamStates = Object.fromEntries(teams.map((team, index) => {
    const state = createTeamState(Object.values(participants).filter((p) => p.team === team).length, 120);
    state.hp = Math.round(state.maxHp * (0.9 - index * 0.2));
    state.squad = Array.from({ length: 4 + index * 2 }, (_, i) => ({ cls: ["warrior", "archer", "mage", "healer", "paladin"][(i + index) % 5], tier: 1 + (i % 3 === 2 ? 1 : 0) }));
    state.summoned = state.squad.length + index;
    return [team, state];
  }));
  return {
    code: "4821", title: "오늘의 팀 퀴즈", hostUid: "teacher", status, matchId: "demo",
    config: { categories: ["공통수학2", "상식퀴즈"], units: ["평면좌표", "직선의 방정식", "세계 상식"], difficulties: ["쉬움", "보통", "어려움"], durationMinutes: 10, teamCount, gourdHpPerMember: 120, questionCountAtCreation: 57 },
    participants, playerStates, teams: teamStates,
    scheduledEndAt: Date.now() + 4 * 60_000, winner: null, battleEvents: {},
  };
}
