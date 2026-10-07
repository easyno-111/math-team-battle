// Gourd-battle rules. Pure functions only: no React, no Firebase, no timers.
// Every team owns a gourd. A correct answer summons a unit for that team and the
// team's squad fires a volley at its own gourd. The first gourd to burst wins.
import { TEAM_IDS } from "./teams.js";

export const UNIT_CLASSES = ["warrior", "archer", "mage", "healer", "paladin"];

// weight: summon probability share. power: per tier (1..3).
// Attackers deal power as damage. Healers heal the rival gourd. Paladins grant the rival gourd shield charges.
export const UNIT_META = {
  warrior: { label: "전사", role: "attack", weight: 24, power: [2, 4, 7], attackLabel: "검기" },
  archer: { label: "궁수", role: "attack", weight: 23, power: [2, 4, 7], attackLabel: "화살" },
  mage: { label: "마법사", role: "attack", weight: 23, power: [2, 4, 7], attackLabel: "마법탄" },
  healer: { label: "힐러", role: "heal", weight: 15, power: [4, 7, 12], attackLabel: "회복" },
  paladin: { label: "팔라딘", role: "shield", weight: 15, power: [1, 1, 2], attackLabel: "수호" },
};

export const TIER_LABELS = ["", "일반", "강화", "정예"];
export const MAX_TIER = 3;
// Streak needed to summon each tier: tier 1 always, tier 2 from 5 in a row, tier 3 from 10.
export const TIER_STREAKS = [1, 5, 10];
export const SQUAD_SIZE = 12;
export const MAX_SHIELD = 3;
export const SHIELD_FACTOR = 0.4;
export const BASE_DAMAGE = { 쉬움: 3, 보통: 5, 어려움: 8, 도전: 12 };
// Gourd hp per team member. ~120 lasts two to three minutes at a normal answering pace.
export const DEFAULT_HP_PER_MEMBER = 120;
export const HP_PRESETS = [
  { value: 70, label: "짧게", hint: "약 1~2분" },
  { value: 120, label: "보통", hint: "약 2~3분" },
  { value: 200, label: "길게", hint: "약 4~5분" },
];
export const HP_PER_MEMBER_RANGE = { min: 20, max: 1000 };
export const WRONG_LOCK_MS = 10_000;

export function tierForStreak(streak) {
  const value = Number(streak) || 0;
  if (value >= TIER_STREAKS[2]) return 3;
  if (value >= TIER_STREAKS[1]) return 2;
  return 1;
}

// The next streak milestone a student can reach, or null at the top tier.
export function nextTierGoal(streak) {
  const value = Number(streak) || 0;
  const goal = TIER_STREAKS.find((threshold, index) => index > 0 && threshold > value);
  return goal ? { streak: goal, tier: TIER_STREAKS.indexOf(goal) + 1 } : null;
}

export function rollUnitClass(random = Math.random) {
  const total = UNIT_CLASSES.reduce((sum, cls) => sum + UNIT_META[cls].weight, 0);
  let roll = random() * total;
  for (const cls of UNIT_CLASSES) {
    roll -= UNIT_META[cls].weight;
    if (roll < 0) return cls;
  }
  return UNIT_CLASSES[0];
}

export function summonUnit(streak, random = Math.random) {
  return { cls: rollUnitClass(random), tier: tierForStreak(streak) };
}

export function unitPower(unit) {
  const meta = UNIT_META[unit?.cls];
  if (!meta) return 0;
  const tier = Math.max(1, Math.min(MAX_TIER, Number(unit.tier) || 1));
  return meta.power[tier - 1];
}

export function unitLabel(unit) {
  const meta = UNIT_META[unit?.cls];
  if (!meta) return "유닛";
  const tier = Math.max(1, Math.min(MAX_TIER, Number(unit.tier) || 1));
  return tier === 1 ? meta.label : `${TIER_LABELS[tier]} ${meta.label}`;
}

export function clampHpPerMember(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_HP_PER_MEMBER;
  return Math.round(Math.max(HP_PER_MEMBER_RANGE.min, Math.min(HP_PER_MEMBER_RANGE.max, number)));
}

export function gourdMaxHp(memberCount, hpPerMember = DEFAULT_HP_PER_MEMBER) {
  const members = Math.max(1, Number(memberCount) || 1);
  return members * clampHpPerMember(hpPerMember);
}

export function createTeamState(memberCount, hpPerMember = DEFAULT_HP_PER_MEMBER) {
  const maxHp = gourdMaxHp(memberCount, hpPerMember);
  return { hp: maxHp, maxHp, shield: 0, squad: [], summoned: 0, damageDealt: 0, members: Math.max(1, Number(memberCount) || 1) };
}

// Firebase drops empty arrays and may hand back objects; normalize before use.
export function normalizeTeamState(team) {
  const squadSource = team?.squad;
  const squad = Array.isArray(squadSource) ? squadSource : Object.values(squadSource || {});
  return {
    hp: Math.max(0, Number(team?.hp) || 0),
    maxHp: Math.max(1, Number(team?.maxHp) || 1),
    shield: Math.max(0, Number(team?.shield) || 0),
    squad: squad.filter((unit) => unit && UNIT_META[unit.cls]).slice(-SQUAD_SIZE),
    summoned: Math.max(0, Number(team?.summoned) || 0),
    damageDealt: Math.max(0, Number(team?.damageDealt) || 0),
    members: Math.max(1, Number(team?.members) || 1),
  };
}

export function normalizeTeams(teams) {
  return Object.fromEntries(Object.entries(teams || {}).filter(([id]) => TEAM_IDS.includes(id)).map(([id, team]) => [id, normalizeTeamState(team)]));
}

export function hpRatio(team) {
  return team ? Math.max(0, Math.min(1, team.hp / team.maxHp)) : 1;
}

// The rival of a team is whichever other team is closest to bursting its gourd.
export function pickRivalTeam(teams, teamId) {
  const others = TEAM_IDS.filter((id) => id !== teamId && teams[id]);
  if (!others.length) return null;
  return others.reduce((best, id) => (hpRatio(teams[id]) < hpRatio(teams[best]) ? id : best), others[0]);
}

export function squadPower(squad, role) {
  return (squad || []).filter((unit) => UNIT_META[unit.cls]?.role === role).reduce((sum, unit) => sum + unitPower(unit), 0);
}

// One correct answer: summon, then the whole squad acts. Returns new team states and what happened.
export function resolveVolley({ teams, teamId, difficulty, unit }) {
  const current = normalizeTeams(teams);
  const self = current[teamId];
  if (!self) throw new Error(`unknown-team:${teamId}`);
  const squad = [...self.squad, unit].slice(-SQUAD_SIZE);
  const tierBoost = 1 + 0.5 * ((Number(unit.tier) || 1) - 1);
  const rawDamage = Math.round((BASE_DAMAGE[difficulty] ?? BASE_DAMAGE.보통) * tierBoost) + squadPower(squad, "attack");
  const shieldUsed = self.shield > 0;
  const damage = shieldUsed ? Math.max(1, Math.ceil(rawDamage * SHIELD_FACTOR)) : rawDamage;
  const hp = Math.max(0, self.hp - damage);
  const next = { ...current, [teamId]: { ...self, hp, shield: shieldUsed ? self.shield - 1 : self.shield, squad, summoned: self.summoned + 1, damageDealt: self.damageDealt + damage } };

  let heal = null;
  let shieldGiven = null;
  const rivalId = pickRivalTeam(current, teamId);
  if (rivalId) {
    const rival = next[rivalId];
    const healAmount = Math.min(squadPower(squad, "heal"), rival.maxHp - rival.hp);
    const charges = Math.min(squadPower(squad, "shield"), MAX_SHIELD - rival.shield);
    if (healAmount > 0) heal = { team: rivalId, amount: healAmount };
    if (charges > 0) shieldGiven = { team: rivalId, charges };
    next[rivalId] = { ...rival, hp: rival.hp + Math.max(0, healAmount), shield: rival.shield + Math.max(0, charges) };
  }

  return { teams: next, damage, rawDamage, shieldUsed, heal, shieldGiven, burst: hp === 0, hpAfter: hp };
}

// Lowest remaining ratio ranks first. Equal ratios share a rank.
export function rankTeams(teams) {
  const rows = Object.entries(normalizeTeams(teams)).map(([team, state]) => ({ team, ...state, ratio: hpRatio(state) }))
    .sort((a, b) => a.ratio - b.ratio || TEAM_IDS.indexOf(a.team) - TEAM_IDS.indexOf(b.team));
  let rank = 0;
  return rows.map((row, index) => {
    if (index === 0 || Math.abs(row.ratio - rows[index - 1].ratio) > 1e-9) rank = index + 1;
    return { ...row, rank };
  });
}

// When the clock runs out: a single leader wins, equal leaders are a tie for the teacher to settle.
export function finishByTime(teams) {
  const ranking = rankTeams(teams);
  const leaders = ranking.filter((row) => row.rank === 1).map((row) => row.team);
  return { winner: leaders.length === 1 ? leaders[0] : null, tied: leaders.length > 1 ? leaders : [], ranking };
}
