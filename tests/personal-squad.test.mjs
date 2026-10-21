import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeUnits, createTeamState, resolveVolley, UNIT_LIFETIME_MS } from '../src/game/rules.js';
import { judgeSubmission, initialPlayerState } from '../src/game/grading.js';
import { eventSquad, ownerGroups, syncArenaSquad } from '../src/battle/squad.js';

const unit = (id, ownerUid = 's1', cls = 'warrior', spawnedAt = 1000) => ({
  id, ownerUid, ownerName: ownerUid === 's1' ? '07 김민수' : '12 이서윤', cls, tier: 1,
  spawnedAt, expiresAt: spawnedAt + UNIT_LIFETIME_MS,
});
const teams = () => ({ A: createTeamState(6), B: { ...createTeamState(6), hp: 400 } });

test('a teammate cannot activate another student’s attackers, healers or paladins', () => {
  const state = teams();
  state.A.squad = [unit('a'), unit('b', 's2', 'mage'), unit('c', 's2', 'healer'), unit('d', 's2', 'paladin')];
  const before = structuredClone(state);
  const result = resolveVolley({ teams: state, teamId: 'A', difficulty: '보통', unit: unit('e'), now: 1000 });
  assert.equal(result.damage, 5 + 2 + 2);
  assert.equal(result.heal, null);
  assert.equal(result.shieldGiven, null);
  assert.deepEqual(result.actingUnits.map((u) => u.id), ['a', 'e']);
  assert.deepEqual(state, before, 'the input snapshot is not mutated');
  const ownSupport = resolveVolley({ teams: result.teams, teamId: 'A', difficulty: '보통', unit: unit('f', 's2', 'paladin', 2000), now: 2000 });
  assert.equal(ownSupport.damage, 5, 'the fourth summon retires this owner’s oldest attacker before acting');
  assert.deepEqual(ownSupport.heal, { team: 'B', amount: 4 });
  assert.deepEqual(ownSupport.shieldGiven, { team: 'B', charges: 2 });
  assert.ok(ownSupport.actingUnits.every((u) => u.ownerUid === 's2'));
});

test('fourth summon retires the oldest personal unit before acting and never evicts teammates', () => {
  const state = teams();
  state.A.squad = [unit('middle', 's1', 'mage', 2000), unit('old', 's1', 'warrior', 1000), unit('new', 's1', 'archer', 3000), ...Array.from({ length: 15 }, (_, i) => unit(`peer-${i}`, `peer-${i}`))];
  const result = resolveVolley({ teams: state, teamId: 'A', unit: unit('fourth', 's1', 'warrior', 4000), now: 4000 });
  assert.equal(result.teams.A.squad.length, 18, 'there is no team-wide cap of twelve');
  assert.deepEqual(result.actingUnits.map((u) => u.id), ['middle', 'new', 'fourth']);
  assert.equal(result.damage, 11);
  assert.equal(result.teams.A.squad.find((u) => u.id === 'middle').expiresAt, 47000, 'new summons do not refresh old lifetimes');
});

test('expiry excludes a unit at the exact deadline, including Firebase object snapshots', () => {
  const old = unit('old');
  assert.deepEqual(activeUnits({ 0: old }, 45999), [old]);
  assert.deepEqual(activeUnits({ 0: old }, 46000), []);
  assert.deepEqual(activeUnits([{ cls: 'mage', tier: 3 }], 1000), [], 'ownerless legacy units retire');
  const state = teams(); state.A.squad = [old, unit('expired-support', 's1', 'healer')];
  const result = resolveVolley({ teams: state, teamId: 'A', unit: unit('fresh', 's1', 'mage', 46000), now: 46000 });
  assert.equal(result.damage, 7);
  assert.equal(result.heal, null);
  assert.deepEqual(result.actingUnits.map((u) => u.id), ['fresh']);
  assert.equal(activeUnits(result.teams.A.squad, 91000).length, 0, 'a reconnect cannot restart the lifetime');
});

test('grading stamps identity and expiry and sends the same acting units to result and animation', () => {
  const question = { id: 'q1', type: 'multiple-choice', question: '1+1?', choices: ['1', '2', '3', '4'], correctOption: 2, difficulty: '보통', enabled: true };
  const state = teams(); state.A.squad = [unit('peer', 's2')];
  const room = { participants: { s1: { name: '07 김민수', team: 'A' } }, playerStates: { s1: { ...initialPlayerState(question), currentQuestion: { id: 'q1', choices: question.choices } } } };
  const result = judgeSubmission({ room, teams: state, uid: 's1', submission: { questionId: 'q1', choice: '2', nonce: 'n1', ownerUid: 's2' }, question, pool: [question], now: 5000, random: () => 0 });
  assert.equal(result.event.unit.id, 's1:n1');
  assert.equal(result.event.unit.ownerUid, 's1', 'identity comes from the host participant, never the submission payload');
  assert.equal(result.event.unit.ownerName, '07 김민수');
  assert.equal(result.event.unit.spawnedAt, 5000);
  assert.equal(result.event.unit.expiresAt, 50000);
  assert.equal(result.event.damage, 7);
  assert.deepEqual(result.event.actingUnits, result.updates['playerStates/s1/lastResult'].actingUnits);
  assert.deepEqual(eventSquad(result.event), result.event.actingUnits);
  const wrong = judgeSubmission({ room, teams: state, uid: 's1', submission: { questionId: 'q1', choice: '3', nonce: 'n2' }, question, pool: [question], now: 5000 });
  assert.equal(wrong.kind, 'wrong');
  assert.ok(!wrong.event);
  assert.ok(!Object.keys(wrong.updates).some((path) => path.startsWith('teams/')));
});

test('snapshot followed by event cannot duplicate a summon or select a matching teammate sprite', () => {
  const own = unit('own'), peer = unit('peer', 's2');
  const roster = syncArenaSquad([], [own, peer], 1000);
  roster[0].attackT = 0.8;
  const event = { at: 1000, attackerUid: 's1', unit: own, actingUnits: [own, peer] };
  assert.deepEqual(eventSquad(event).map((u) => u.id), ['own']);
  const repeated = syncArenaSquad(roster, { 0: own, 1: peer }, 1100);
  assert.equal(repeated.length, 2);
  assert.equal(repeated[0].attackT, 0.8);
  assert.deepEqual(ownerGroups(repeated).map((group) => group.map((u) => u.id)), [['own'], ['peer']]);
  assert.equal(syncArenaSquad(repeated, [peer], 2000).length, 1, 'replaced units leave the renderer');
  assert.equal(syncArenaSquad(repeated, [own, peer], 46000).length, 0, 'expiry also works on remount');
});
