import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleRound, quizPhase, answerWindowOpen, roundReadyToGrade, canAdvanceRound } from '../src/quiz/flow.js';
import { publicQuestion, settleRound } from '../src/quiz/model.js';
import { revealCelebration, REVEAL_EFFECT_MS } from '../src/quiz/celebration.js';

const q = { id: 'q', type: 'choice', question: '1 + 2 = ?', choices: ['2', '3', '4', '5'], correctIndex: 1, duration: 30, explanation: '덧셈' };
const waiting = { phase: 'waiting', index: -1, hostUid: 'teacher', total: 2, players: { a: { name: '가' }, b: { name: '나' } }, options: { autoAdvance: false } };
const first = () => scheduleRound(waiting, publicQuestion(q), 'r1', 10000);

test('opening plays once for 4 seconds, then question alone for 3 seconds, then a full answer window', () => {
  const room = first();
  assert.equal(quizPhase(room, 10000), 'intro');
  assert.equal(quizPhase(room, 13999), 'intro');
  assert.equal(quizPhase(room, 14000), 'preview');
  assert.equal(quizPhase(room, 16999), 'preview');
  assert.equal(quizPhase(room, 17000), 'answer');
  assert.equal(room.endAt - room.startAt, 30000);
  for (const time of [10000, 13999, 14000, 16999, 47000, 47001]) assert.equal(answerWindowOpen(room, time), false);
  assert.equal(answerWindowOpen(room, 17000), true);
  assert.equal(answerWindowOpen(room, 46999), true);
  assert.equal(roundReadyToGrade(room, 46999), false);
  assert.equal(roundReadyToGrade(room, 47000), true);
});

test('later rounds skip intro, clear previous answers and effects, preserve roster and score', () => {
  const revealed = { ...first(), phase: 'reveal', revealedAt: 48000, reveal: q, correctLabel: '3', results: { a: {} }, scores: { a: { total: 1000 } } };
  const next = scheduleRound(revealed, publicQuestion(q), 'r2', 55000);
  assert.equal(next.index, 1);
  assert.equal(next.introAt, null);
  assert.equal(quizPhase(next, 55000), 'preview');
  assert.equal(next.startAt, 58000);
  assert.equal(next.endAt, 88000);
  for (const field of ['results', 'reveal', 'correctLabel', 'revealedAt']) assert.equal(next[field], null);
  assert.equal(next.players, revealed.players);
  assert.equal(next.scores, revealed.scores);
  assert.equal(revealed.phase, 'reveal');
});

test('reloading or reconnecting joins the same schedule without replay or timer reset', () => {
  const restored = JSON.parse(JSON.stringify(first()));
  assert.equal(quizPhase(restored, 15000), 'preview');
  assert.equal(quizPhase(restored, 25000), 'answer');
  assert.equal(restored.endAt, 47000);
  assert.equal(roundReadyToGrade(restored, 50000), true);
  assert.equal(answerWindowOpen(restored, 50000), false);
});

test('all submissions can arrive early without exposing correct answers or shortening the clock', () => {
  const room = first();
  room.submissions = { a: { answer: '1' }, b: { answer: '1' } };
  assert.equal(roundReadyToGrade(room, room.startAt + 10), false);
  for (const field of ['correctIndex', 'explanation', 'answers', 'target']) assert.equal(field in room.question, false);
  assert.equal(room.reveal, null);
});

test('speed bonus starts when choices appear, and reading-time submissions do not score', () => {
  const room = first();
  const result = settleRound(room, q, {
    a: { roundId: 'r1', answer: '1', submittedAt: room.startAt },
    b: { roundId: 'r1', answer: '1', submittedAt: room.startAt - 1 },
  });
  assert.equal(result.results.a.points, 1000);
  assert.equal(result.results.a.elapsedMs, 0);
  assert.equal(result.results.b.points, 0);
});

test('two host tabs cannot skip a question or finish a different round', () => {
  assert.equal(canAdvanceRound({ ...waiting }, waiting), true);
  assert.equal(canAdvanceRound(first(), waiting), false);
  const revealed = { ...first(), phase: 'reveal' };
  assert.equal(canAdvanceRound({ ...revealed, roundId: 'another' }, revealed), false);
  assert.equal(canAdvanceRound({ ...revealed, hostUid: 'someone' }, revealed), false);
  assert.equal(canAdvanceRound(null, revealed), false);
});

test('grading and reveal cannot reopen submissions, including after reconnect', () => {
  for (const phase of ['waiting', 'grading', 'reveal', 'finished']) {
    const room = { ...first(), phase };
    assert.equal(quizPhase(room, 10001), phase);
    assert.equal(answerWindowOpen(room, 20000), false);
    assert.equal(roundReadyToGrade(room, 99000), false);
  }
  assert.equal(answerWindowOpen({ phase: 'answer' }, 20000), false);
  assert.equal(roundReadyToGrade({ phase: 'answer' }, 20000), false);
});

function revealedRoom() {
  return { ...first(), phase: 'reveal', revealedAt: 48000, results: {
    a: { correct: true, submitted: true, roundId: 'r1', elapsedMs: 20000 },
    b: { correct: false, submitted: true, roundId: 'r1' },
    outsider: { correct: true, submitted: true, roundId: 'r1' },
  } };
}
test('every correct student celebrates regardless of rank, while host sees current correct count', () => {
  const room = revealedRoom();
  assert.equal(revealCelebration(room, 'a', false, 48100).label, '정답!');
  assert.equal(revealCelebration(room, 'b', false, 48100), null);
  assert.equal(revealCelebration(room, undefined, false, 48100), null);
  assert.equal(revealCelebration(room, undefined, true, 48100).label, '정답 1명!');
  room.results.a.roundId = 'old';
  assert.equal(revealCelebration(room, 'a', true, 48100), null);
});

test('bursts expire, never replay after a late return, and disappear for the next question', () => {
  const room = revealedRoom();
  assert.equal(revealCelebration(room, 'a', false, 48000).elapsed, 0);
  assert.equal(revealCelebration(room, 'a', false, 49000).elapsed, 1000);
  for (const time of [0, NaN, 47999, 48000 + REVEAL_EFFECT_MS, 99999]) assert.equal(revealCelebration(room, 'a', false, time), null);
  for (const phase of ['answer', 'grading', 'finished']) assert.equal(revealCelebration({ ...room, phase }, 'a', false, 48100), null);
});
