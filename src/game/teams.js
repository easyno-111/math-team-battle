// Team identity shared by the teacher, student and battle screens.
export const TEAM_IDS = ["A", "B", "C", "D"];

export const TEAM_META = {
  A: { label: "라벤더 팀", short: "라벤더", color: "#9b86c8", dark: "#5f4f8f", light: "#e6ddff" },
  B: { label: "민트 팀", short: "민트", color: "#65aa94", dark: "#2f6f5b", light: "#d8f3e8" },
  C: { label: "피치 팀", short: "피치", color: "#db9679", dark: "#9a5a3f", light: "#ffe3d6" },
  D: { label: "스카이 팀", short: "스카이", color: "#76a7d5", dark: "#3b6a99", light: "#dcecfb" },
};

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 4;

export function clampTeamCount(value) {
  const count = Number(value) || MIN_TEAMS;
  return Math.max(MIN_TEAMS, Math.min(MAX_TEAMS, Math.round(count)));
}

export function configuredTeams(teamCount) {
  return TEAM_IDS.slice(0, clampTeamCount(teamCount));
}

export function teamLabel(team) {
  return TEAM_META[team]?.label || `${team}팀`;
}

export function teamShort(team) {
  return TEAM_META[team]?.short || team;
}
