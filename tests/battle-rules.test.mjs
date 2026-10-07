import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_DAMAGE, MAX_SHIELD, SHIELD_FACTOR, SQUAD_SIZE, UNIT_CLASSES, UNIT_META,
  createTeamState, finishByTime, gourdMaxHp, nextTierGoal, normalizeTeamState, pickRivalTeam,
  rankTeams, resolveVolley, rollUnitClass, summonUnit, tierForStreak, unitPower,
} from '../src/game/rules.js';

const teams = (count = 2, members = 5, hpPerMember = 150) =>
  Object.fromEntries(['A', 'B', 'C', 'D'].slice(0, count).map((id) => [id, createTeamState(members, hpPerMember)]));
const sequence = (...values) => { let i = 0; return () => values[i++ % values.length]; };

test('gourd hp scales with members and the teacher setting so uneven teams stay fair', () => {
  assert.equal(gourdMaxHp(5, 150), 750);
  assert.equal(gourdMaxHp(7, 150), 1050);
  assert.equal(gourdMaxHp(0, 'x'), 120, 'missing values fall back to one member and the default');
  assert.equal(gourdMaxHp(1, 5), 20, 'setting is clamped to the allowed range');
});

test('streak tiers: 1-4 normal, 5-9 reinforced, 10+ elite; next goal reported', () => {
  assert.deepEqual([0, 1, 4, 5, 9, 10, 30].map(tierForStreak), [1, 1, 1, 2, 2, 3, 3]);
  assert.deepEqual(nextTierGoal(0), { streak: 5, tier: 2 });
  assert.deepEqual(nextTierGoal(7), { streak: 10, tier: 3 });
  assert.equal(nextTierGoal(12), null);
});

test('summon roll follows weights and covers every class', () => {
  const total = UNIT_CLASSES.reduce((sum, cls) => sum + UNIT_META[cls].weight, 0);
  assert.equal(total, 100);
  assert.equal(rollUnitClass(() => 0), 'warrior');
  assert.equal(rollUnitClass(() => 0.999), 'paladin');
  let edge = 0;
  const seen = new Set(UNIT_CLASSES.map((cls) => { edge += UNIT_META[cls].weight; return rollUnitClass(() => (edge - 0.5) / total); }));
  assert.equal(seen.size, 5);
  assert.deepEqual(summonUnit(6, () => 0), { cls: 'warrior', tier: 2 });
});

test('a volley adds the new unit, fires the whole squad and keeps the squad bounded', () => {
  let state = teams();
  const unit = { cls: 'archer', tier: 1 };
  const first = resolveVolley({ teams: state, teamId: 'A', difficulty: '보통', unit });
  assert.equal(first.damage, BASE_DAMAGE.보통 + unitPower(unit));
  assert.equal(first.teams.A.hp, 750 - first.damage);
  assert.equal(first.teams.B.hp, 750, 'rival untouched by attackers');
  state = first.teams;
  for (let i = 0; i < SQUAD_SIZE + 3; i += 1) state = resolveVolley({ teams: state, teamId: 'A', difficulty: '쉬움', unit }).teams;
  assert.equal(state.A.squad.length, SQUAD_SIZE);
  assert.equal(state.A.summoned, SQUAD_SIZE + 4);
  const full = resolveVolley({ teams: state, teamId: 'A', difficulty: '쉬움', unit });
  assert.equal(full.damage, BASE_DAMAGE.쉬움 + SQUAD_SIZE * unitPower(unit), 'only the squad fires, not every unit ever summoned');
});

test('reinforced and elite summons raise base damage and unit power', () => {
  const base = resolveVolley({ teams: teams(), teamId: 'A', difficulty: '도전', unit: { cls: 'mage', tier: 1 } }).damage;
  const elite = resolveVolley({ teams: teams(), teamId: 'A', difficulty: '도전', unit: { cls: 'mage', tier: 3 } }).damage;
  assert.equal(base, 12 + 2);
  assert.equal(elite, 24 + 7);
});

test('healers heal the rival closest to winning and never above max hp', () => {
  let state = teams(3);
  state.B.hp = 100; state.C.hp = 740;
  assert.equal(pickRivalTeam(state, 'A'), 'B');
  const result = resolveVolley({ teams: state, teamId: 'A', difficulty: '보통', unit: { cls: 'healer', tier: 1 } });
  assert.deepEqual(result.heal, { team: 'B', amount: 4 });
  assert.equal(result.teams.B.hp, 104);
  assert.equal(result.damage, BASE_DAMAGE.보통, 'a healer alone deals only base damage');
  state = result.teams; state.B.hp = 749; state.C.hp = 750;
  const capped = resolveVolley({ teams: state, teamId: 'A', difficulty: '보통', unit: { cls: 'healer', tier: 1 } });
  assert.equal(capped.teams.B.hp, 750);
  assert.deepEqual(capped.heal, { team: 'B', amount: 1 });
});

test('paladins grant bounded shield charges and a shield absorbs most of one volley', () => {
  let state = teams();
  for (let i = 0; i < 5; i += 1) state = resolveVolley({ teams: state, teamId: 'A', difficulty: '쉬움', unit: { cls: 'paladin', tier: 1 } }).teams;
  assert.equal(state.B.shield, MAX_SHIELD);
  const hit = resolveVolley({ teams: state, teamId: 'B', difficulty: '도전', unit: { cls: 'warrior', tier: 1 } });
  assert.equal(hit.shieldUsed, true);
  assert.equal(hit.damage, Math.ceil(hit.rawDamage * SHIELD_FACTOR));
  assert.equal(hit.teams.B.shield, MAX_SHIELD - 1);
});

test('a gourd bursts at zero and reports the burst', () => {
  const state = teams(); state.A.hp = 3;
  const result = resolveVolley({ teams: state, teamId: 'A', difficulty: '쉬움', unit: { cls: 'warrior', tier: 1 } });
  assert.equal(result.burst, true);
  assert.equal(result.teams.A.hp, 0);
});

test('time-out ranking uses hp ratio, shares ranks and flags ties for the teacher', () => {
  const state = teams(4, 5, 150);
  state.A.hp = 300; state.B.hp = 300; state.C.hp = 600; state.D.maxHp = 1050; state.D.hp = 430;
  const { winner, tied, ranking } = finishByTime(state);
  assert.equal(winner, null);
  assert.deepEqual(tied, ['A', 'B']);
  assert.deepEqual(ranking.map((row) => [row.team, row.rank]), [['A', 1], ['B', 1], ['D', 3], ['C', 4]]);
  state.B.hp = 301;
  assert.equal(finishByTime(state).winner, 'A');
  assert.equal(rankTeams(state)[0].team, 'A');
});

test('states read back from Firebase without a squad array are normalized', () => {
  const normalized = normalizeTeamState({ hp: '40', maxHp: 100, squad: { 0: { cls: 'mage', tier: 2 }, 1: { cls: 'ghost' } } });
  assert.deepEqual(normalized.squad, [{ cls: 'mage', tier: 2 }]);
  assert.equal(normalized.hp, 40);
  assert.equal(normalized.shield, 0);
});
