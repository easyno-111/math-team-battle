import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { removeParticipant, participantAccess, repairParticipants } from '../src/room/moderation.js';
import { judgeSubmission } from '../src/game/grading.js';

const room = (status = 'playing') => ({
  hostUid: 'teacher', status,
  participants: {
    original: { uid: 'original', name: '김민수', team: 'A' },
    duplicate: { uid: 'duplicate', name: '김민수2', team: 'A', needsSync: true },
    peer: { uid: 'peer', name: '이서윤', team: 'B' },
  },
  playerStates: { original: { damage: 20 }, duplicate: { damage: 10 }, peer: { damage: 5 } },
  teams: {
    A: { hp: 210, maxHp: 240, damageDealt: 30, squad: { 0: { id: 'one', ownerUid: 'original' }, 1: { id: 'two', ownerUid: 'duplicate' } } },
    B: { hp: 115, maxHp: 120, shield: 1, squad: [{ id: 'three', ownerUid: 'peer' }] },
  },
  battleEvents: { mine: { attackerUid: 'duplicate' }, theirs: { attackerUid: 'peer' } },
  removedParticipants: { earlier: { at: 100 } },
});
const kick = (current) => removeParticipant(current, { uid: 'duplicate', hostUid: 'teacher', now: 5000 });

test('removal clears only the selected device’s records, units and events, preserving previous gourd damage', () => {
  const before = room(), copy = structuredClone(before), after = kick(before);
  assert.deepEqual(Object.keys(after.participants), ['original', 'peer']);
  assert.deepEqual(Object.keys(after.playerStates), ['original', 'peer']);
  assert.equal(after.participants.original.name, '김민수');
  assert.deepEqual(after.teams.A.squad, [{ id: 'one', ownerUid: 'original' }]);
  assert.deepEqual(after.teams.B, before.teams.B);
  assert.equal(after.teams.A.hp, 210);
  assert.equal(after.teams.A.maxHp, 240);
  assert.equal(after.teams.A.damageDealt, 30);
  assert.deepEqual(Object.keys(after.battleEvents), ['theirs']);
  assert.deepEqual(after.removedParticipants, { earlier: { at: 100 }, duplicate: { at: 5000 } });
  assert.deepEqual(before, copy, 'transaction callbacks may rerun without mutating the cached room');
});

test('lobby removal works before player states or squads exist, and only allowed room phases can be moderated', () => {
  for (const status of ['waiting', 'locked', 'playing', 'finished']) {
    const current = room(status); delete current.playerStates; delete current.teams; delete current.battleEvents;
    assert.equal(participantAccess(kick(current), 'duplicate'), 'removed');
  }
  assert.equal(kick(room('starting')), undefined, 'start freezes the roster');
  assert.equal(kick(null), undefined, 'a closed room cannot be resurrected');
  assert.equal(removeParticipant(room(), { uid: 'duplicate', hostUid: 'intruder', now: 1 }), undefined);
  assert.equal(removeParticipant(room(), { uid: 'teacher', hostUid: 'teacher', now: 1 }), undefined);
  assert.equal(kick(kick(room())), undefined, 'a repeated click cannot remove a different student');
});

test('saved sessions distinguish kicked devices, missing participants, valid members and closed rooms', () => {
  assert.equal(participantAccess(kick(room()), 'duplicate'), 'removed');
  assert.equal(participantAccess(kick(room()), 'original'), 'member');
  assert.equal(participantAccess(room(), 'stale-device'), 'missing');
  assert.equal(participantAccess(null, 'duplicate'), 'closed');
  assert.equal(participantAccess({ participants: { duplicate: {} } }, 'duplicate'), 'member', 'the block applies only to its original room');
});

test('a delayed grade or repair cannot recreate the removed participant', () => {
  const after = kick(room());
  const updates = { 'playerStates/duplicate': { currentQuestion: { id: 'q1' } }, 'participants/duplicate/needsSync': false };
  assert.equal(repairParticipants(after, updates, 'teacher'), undefined);
  assert.equal(repairParticipants(null, updates, 'teacher'), undefined);
  const stale = room(); stale.removedParticipants.duplicate = { at: 1 };
  const question = { id: 'q1', type: 'multiple-choice', choices: ['1', '2', '3', '4'], correctOption: 2 };
  stale.playerStates.duplicate.currentQuestion = { id: 'q1', choices: question.choices };
  const result = judgeSubmission({ room: stale, teams: stale.teams, uid: 'duplicate', submission: { questionId: 'q1', choice: '2', nonce: 'late' }, question, pool: [question], now: 6000 });
  assert.equal(result.kind, 'discard');
  assert.deepEqual(result.updates, {});
});

test('repair still initializes a valid member and does not replace a newer question', () => {
  const current = room();
  const next = repairParticipants(current, { 'playerStates/duplicate': { currentQuestion: { id: 'new' } }, 'participants/duplicate/needsSync': false }, 'teacher');
  assert.equal(next.playerStates.duplicate.currentQuestion.id, 'new');
  assert.equal(next.participants.duplicate.needsSync, false);
  assert.equal(repairParticipants(next, { 'playerStates/duplicate': { currentQuestion: { id: 'stale' } } }, 'teacher'), undefined);
});

// Exercise the actual rules' expressions with the Realtime Database snapshot API.
const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url))).rules;
class Snapshot {
  constructor(value) { this.value = value; }
  child(path) { return new Snapshot(path.split('/').reduce((value, key) => value?.[key], this.value)); }
  exists() { return this.value !== undefined && this.value !== null; }
  val() { return this.value ?? null; }
  isNumber() { return typeof this.value === 'number'; }
}
const evaluate = (expression, current, uid, data = null, newData = null, provider = 'anonymous') =>
  new Function('auth', 'root', 'data', 'newData', '$roomCode', '$uid', `return (${expression});`)(
    uid ? { uid, token: { firebase: { sign_in_provider: provider } } } : null,
    new Snapshot({ rooms: { '1234': current } }), new Snapshot(data), new Snapshot(newData), '1234', 'duplicate');

test('database rules block kicked UID presence, re-entry, counter changes and submissions while permitting the host', () => {
  const entry = rules.rooms.$roomCode, before = room('waiting'), after = kick(before);
  const participantWrite = entry.participants.$uid['.write'];
  assert.equal(evaluate(participantWrite, before, 'duplicate', null, before.participants.duplicate), true);
  for (const existing of [null, { online: true }, before.participants.duplicate]) {
    assert.equal(evaluate(participantWrite, after, 'duplicate', existing, before.participants.duplicate), false);
  }
  assert.equal(evaluate(entry.joinCounter['.write'], after, 'duplicate', 1, 2), false);
  assert.equal(evaluate(participantWrite, after, 'peer', null, before.participants.duplicate), false);
  assert.equal(evaluate(entry['.write'], before, 'duplicate', before, after), false, 'a student cannot set or clear a removal tombstone');
  assert.equal(evaluate(entry['.write'], before, 'teacher', before, after, 'password'), true);
  assert.equal(evaluate(entry['.write'], before, null, before, after), false);
  const playing = room(); playing.playerStates.duplicate.currentQuestion = { id: 'q1' };
  const submissionWrite = rules.roomSubmissions.$roomCode.$uid['.write'];
  assert.equal(evaluate(submissionWrite, playing, 'duplicate', null, { questionId: 'q1' }), true);
  playing.removedParticipants.duplicate = { at: 1 };
  assert.equal(evaluate(submissionWrite, playing, 'duplicate', null, { questionId: 'q1' }), false);
});
