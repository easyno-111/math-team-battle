import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseNextQuestion, filterQuestionPool, isPlayableQuestion, publicQuestion } from '../src/game/questions.js';

const q = (id, patch = {}) => ({ id, type: 'multiple-choice', question: 'Q', choices: ['a', 'b', 'c', 'd'], correctOption: 1, category: '수학', unit: '함수', difficulty: '보통', ...patch });

test('only enabled four-choice questions with distinct choices are playable', () => {
  assert.equal(isPlayableQuestion(q('1')), true);
  assert.equal(isPlayableQuestion(q('2', { enabled: false })), false);
  assert.equal(isPlayableQuestion(q('3', { choices: ['a', 'A', 'c', 'd'] })), false);
  assert.equal(isPlayableQuestion(q('4', { correctOption: 5 })), false);
  assert.equal(isPlayableQuestion({ question: 'legacy', answer: '3' }), false);
});

test('public questions hide the answer and shuffle choices', () => {
  const pub = publicQuestion(q('1'), () => 0.99);
  assert.ok(!('correctOption' in pub));
  assert.deepEqual([...pub.choices].sort(), ['a', 'b', 'c', 'd']);
  assert.equal(publicQuestion(q('2', { enabled: false })), null);
});

test('next question prefers unseen items and never repeats the current one when avoidable', () => {
  const pool = [q('1'), q('2'), q('3')];
  const state = { currentQuestion: { id: '1' }, seenQuestionIds: { 1: true, 2: true } };
  assert.equal(chooseNextQuestion(pool, state, () => 0).question.id, '3');
  const exhausted = chooseNextQuestion(pool, { currentQuestion: { id: '3' }, seenQuestionIds: { 1: true, 2: true, 3: true } }, () => 0);
  assert.notEqual(exhausted.question.id, '3');
  assert.deepEqual(Object.keys(exhausted.seen).length, 1);
});

test('room config filters by category, unit and difficulty', () => {
  const pool = [q('1'), q('2', { unit: '도형' }), q('3', { difficulty: '도전' }), q('4', { category: '상식' })];
  const filtered = filterQuestionPool(pool, { categories: ['수학'], units: ['함수'], difficulties: ['보통'] });
  assert.deepEqual(filtered.map((item) => item.id), ['1']);
});
