import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPlayerState, judgeSubmission } from '../src/game/grading.js';
import { createTeamState, WRONG_LOCK_MS } from '../src/game/rules.js';

const question = (id, correctOption = 2, difficulty = '보통') => ({ id, type: 'multiple-choice', question: `문제 ${id}`, choices: ['1', '2', '3', '4'], correctOption, difficulty, enabled: true });
const pool = [question('q1'), question('q2'), question('q3')];
const room = (overrides = {}) => ({
  participants: { s1: { uid: 's1', name: '가', team: 'A' } },
  playerStates: { s1: { ...initialPlayerState(pool[0], () => 0), currentQuestion: { id: 'q1', choices: ['1', '2', '3', '4'] } } },
  ...overrides,
});
const teams = () => ({ A: createTeamState(1, 150), B: createTeamState(1, 150) });
const submission = (choice, questionId = 'q1') => ({ nonce: 'n1', questionId, choice });

test('a correct answer summons a unit, damages the own gourd, advances the question and logs an event', () => {
  const result = judgeSubmission({ room: room(), teams: teams(), uid: 's1', submission: submission(' 2 '), question: pool[0], pool, now: 1000, random: () => 0 });
  assert.equal(result.kind, 'correct');
  assert.equal(result.updates['playerStates/s1/correctCount'], 1);
  assert.equal(result.updates['playerStates/s1/streak'], 1);
  assert.equal(result.updates['teams/A'].hp, 150 - result.event.damage);
  assert.equal(result.updates['teams/A'].squad.length, 1);
  assert.ok(!('teams/B' in result.updates), 'untouched rival is not rewritten');
  assert.notEqual(result.updates['playerStates/s1/currentQuestion'].id, 'q1');
  assert.ok(!('correctOption' in result.updates['playerStates/s1/currentQuestion']));
  assert.equal(result.event.team, 'A');
  assert.equal(result.event.unit.cls, 'warrior');
  assert.equal(result.updates.status, undefined);
});

test('a wrong answer resets the streak and locks choices for ten seconds', () => {
  const current = room();
  current.playerStates.s1.streak = 3;
  const result = judgeSubmission({ room: current, teams: teams(), uid: 's1', submission: submission('3'), question: pool[0], pool, now: 5000 });
  assert.equal(result.kind, 'wrong');
  assert.equal(result.updates['playerStates/s1/streak'], 0);
  assert.equal(result.updates['playerStates/s1/lockedUntil'], 5000 + WRONG_LOCK_MS);
  assert.equal(result.updates['playerStates/s1/lastResult'].streakBroken, true);
  assert.ok(!Object.keys(result.updates).some((key) => key.startsWith('teams/')));
});

test('submissions during a lock are rejected without touching counts', () => {
  const current = room();
  current.playerStates.s1.lockedUntil = 9000;
  const result = judgeSubmission({ room: current, teams: teams(), uid: 's1', submission: submission('2'), question: pool[0], pool, now: 8000 });
  assert.equal(result.kind, 'blocked');
  assert.deepEqual(Object.keys(result.updates), ['playerStates/s1/lastResult']);
});

test('stale, unknown or off-menu submissions are discarded', () => {
  assert.equal(judgeSubmission({ room: room(), teams: teams(), uid: 's1', submission: submission('2', 'q2'), question: pool[1], pool }).kind, 'discard');
  assert.equal(judgeSubmission({ room: room(), teams: teams(), uid: 'ghost', submission: submission('2'), question: pool[0], pool }).kind, 'discard');
  const offMenu = judgeSubmission({ room: room(), teams: teams(), uid: 's1', submission: submission('9'), question: pool[0], pool, now: 0 });
  assert.equal(offMenu.kind, 'wrong');
});

test('the burst that empties a gourd finishes the room with that team as winner', () => {
  const state = teams(); state.A.hp = 1;
  const result = judgeSubmission({ room: room(), teams: state, uid: 's1', submission: submission('2'), question: pool[0], pool, now: 1000, random: () => 0 });
  assert.equal(result.burst, true);
  assert.equal(result.updates.status, 'finished');
  assert.equal(result.updates.winner, 'A');
  assert.equal(result.updates.finishReason, 'burst');
});

test('streak five summons a reinforced unit', () => {
  const current = room();
  current.playerStates.s1.streak = 4;
  const result = judgeSubmission({ room: current, teams: teams(), uid: 's1', submission: submission('2'), question: pool[0], pool, now: 0, random: () => 0 });
  assert.equal(result.event.unit.tier, 2);
  assert.equal(result.updates['playerStates/s1/maxStreak'], 5);
});
