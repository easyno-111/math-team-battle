import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificationGroups, executeGroupMerge, groupKey, mergePatch, planGroupMerge } from '../src/questions/mergeGroups.js';

const question = (id, category, unit, enabled = true) => ({
  id, category, unit, enabled, type: 'multiple-choice', question: '2+2?', choices: ['1', '2', '3', '4'], correctOption: 4, explanation: '덧셈', difficulty: '어려움', createdBy: 'teacher',
});
const bank = () => [question('a', '수학', '기초'), question('b', '수학', '응용', false), question('c', '수학', '심화'), question('target', '수학', '방정식'), question('peer', '영어', '기초')];
const sources = [groupKey('수학', '기초'), groupKey('수학', '응용'), groupKey('수학', '심화')];

test('three topics merge into an existing topic without changing IDs, answers, difficulty or exclusions', () => {
  const original = bank(), copy = structuredClone(original);
  const plan = planGroupMerge(original, { sourceKeys: sources, category: ' 수학 ', unit: ' 방정식 ' });
  assert.equal(plan.matched, 3);
  assert.deepEqual(plan.changes.map((change) => change.id), ['a', 'b', 'c']);
  const merged = original.map((item) => {
    const change = plan.changes.find((candidate) => candidate.id === item.id);
    return change ? { ...item, ...mergePatch(item, change, plan.mode) } : item;
  });
  assert.deepEqual(classificationGroups(merged).map((group) => [group.category, group.unit, group.count]), [['수학', '방정식', 4], ['영어', '기초', 1]]);
  assert.equal(merged.find((item) => item.id === 'b').enabled, false);
  for (let i = 0; i < original.length; i++) assert.deepEqual({ ...merged[i], category: original[i].category, unit: original[i].unit }, original[i]);
  assert.deepEqual(original, copy);
});

test('category-only merge preserves topics and leaves identical topic names in other categories alone', () => {
  const original = [question('a', '수학1', '기초'), question('b', '수학2', '응용'), question('c', '영어', '기초')];
  const plan = planGroupMerge(original, { sourceKeys: [groupKey('수학1', '기초'), groupKey('수학2', '응용')], category: '수학', mode: 'category' });
  assert.deepEqual(plan.changes.map((change) => change.id), ['a', 'b']);
  assert.deepEqual(mergePatch(original[0], plan.changes[0], plan.mode), { category: '수학' });
  assert.equal(plan.changes[1].after.unit, '응용');
});

test('unassigned topics and legacy subject fields can be regrouped; separator-like names do not collide', () => {
  const original = [{ ...question('a', undefined, ''), subject: '옛 과목' }, question('b', 'A::B', 'C'), question('c', 'A', 'B::C')];
  assert.equal(classificationGroups(original).length, 3);
  const plan = planGroupMerge(original, { sourceKeys: [groupKey('옛 과목', '')], category: '수학', unit: '미분' });
  assert.deepEqual(mergePatch(original[0], plan.changes[0], plan.mode), { category: '수학', unit: '미분' });
});

test('invalid selections, blank/long names, disappeared groups and no-op plans fail before writing', () => {
  const settings = { sourceKeys: sources, category: '수학', unit: '방정식' };
  for (const patch of [{ category: ' ' }, { category: '가'.repeat(101) }, { unit: '' }, { unit: '가'.repeat(101) }, { sourceKeys: [] }, { sourceKeys: [sources[0], 'missing'] }, { mode: 'invalid' }]) {
    assert.throws(() => planGroupMerge(bank(), { ...settings, ...patch }));
  }
  assert.throws(() => planGroupMerge(bank(), { sourceKeys: [sources[0]], category: '수학', unit: '기초' }), /이미 같은/);
});

test('a stale preview cannot recreate a deleted question or overwrite a concurrent reclassification', () => {
  const original = bank(), plan = planGroupMerge(original, { sourceKeys: sources, category: '수학', unit: '방정식' });
  const change = plan.changes[0];
  assert.throws(() => mergePatch(null, change, plan.mode), { code: 'merge-conflict' });
  assert.throws(() => mergePatch({ ...original[0], unit: '다른 교사가 옮긴 주제' }, change, plan.mode), { code: 'merge-conflict' });
  assert.equal(mergePatch({ ...original[0], unit: '방정식' }, change, plan.mode), null, 'an uncertain network result is safe to retry');
  assert.deepEqual(mergePatch({ ...original[0], correctOption: 3 }, change, plan.mode), { category: '수학', unit: '방정식' }, 'a concurrent answer edit stays untouched');
});

test('more than 400 questions are processed in bounded chunks with accurate progress', async () => {
  const original = Array.from({ length: 1001 }, (_, i) => question(String(i), '수학', i % 2 ? '기초' : '응용'));
  const plan = planGroupMerge(original, { sourceKeys: sources.slice(0, 2), category: '수학', unit: '방정식' });
  const batches = [], progress = [];
  const count = await executeGroupMerge(plan, async (chunk) => { batches.push(chunk.length); }, (done, total) => progress.push([done, total]));
  assert.deepEqual(batches, [400, 400, 201]);
  assert.deepEqual(progress, [[400, 1001], [800, 1001], [1001, 1001]]);
  assert.equal(count, 1001);
});

test('a failed middle chunk stops processing and retries only the uncommitted questions', async () => {
  const original = Array.from({ length: 801 }, (_, i) => question(String(i), '수학', '기초'));
  const plan = planGroupMerge(original, { sourceKeys: [sources[0]], category: '수학', unit: '방정식' });
  let calls = 0, failure;
  try {
    await executeGroupMerge(plan, async () => { if (++calls === 2) throw Object.assign(new Error('denied'), { code: 'permission-denied' }); });
  } catch (error) { failure = error; }
  assert.equal(calls, 2);
  assert.equal(failure.completed, 400);
  assert.equal(failure.code, 'permission-denied');
  assert.equal(failure.remaining.length, 401);
  assert.equal(failure.remaining[0].id, '400');
  const retried = [];
  await executeGroupMerge({ ...plan, changes: failure.remaining }, async (chunk) => retried.push(...chunk.map((change) => change.id)));
  assert.equal(retried.length, 401);
  assert.ok(!retried.includes('399'));
  assert.equal(retried.at(-1), '800');
});
