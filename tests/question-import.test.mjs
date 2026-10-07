import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRecords, detectHeader, headerLine, recordsFromText } from '../src/utils/questionImport.js';

const row = (fields) => fields.join('\t');
const good = ['공통수학2', '평면좌표', '쉬움', '두 점 사이의 거리는?', '3', '4', '5', '6', '3', '거리 공식'];

test('pasted text without a header follows the template column order', () => {
  const records = recordsFromText([row(good), row(['', '함수', '보통', '문제2', 'a', 'b', 'c', 'd', '1', ''])].join('\n'));
  assert.equal(records.length, 2);
  assert.equal(records[0].unit, '평면좌표');
  assert.deepEqual(records[0].choices, ['3', '4', '5', '6']);
  assert.equal(records[1].category, '');
  assert.equal(records[1].rowNumber, 2);
});

test('pasted text with a header may reorder columns and skips blank lines', () => {
  const text = ['문제\t정답번호\t보기1\t보기2\t보기3\t보기4\t단원\t난이도', '', 'Q\t2\ta\tb\tc\td\t함수\t도전', ''].join('\r\n');
  const [record] = recordsFromText(text);
  assert.equal(record.question, 'Q');
  assert.equal(record.correctOptionRaw, '2');
  assert.equal(record.difficulty, '도전');
  assert.equal(record.rowNumber, 3);
});

test('a header missing required columns is reported instead of guessed', () => {
  assert.throws(() => recordsFromText('문제\t정답번호\n질문\t1'), /머리글에 필요한 열이 없습니다/);
  assert.throws(() => recordsFromText('하나\t둘'), /열이 부족합니다/);
  assert.throws(() => recordsFromText('\n\n'), /붙여넣은 내용이 없습니다/);
  assert.deepEqual(detectHeader(headerLine().split('\t')).missing, []);
});

test('validation flags empty, duplicate and out-of-range values and dedupes against the bank', () => {
  const existing = [{ type: 'multiple-choice', question: '두 점 사이의 거리는?', choices: ['3', '4', '5', '6'], correctOption: 3 }];
  const records = recordsFromText([
    row(good),
    row(['', '', '매우쉬움', '', 'a', 'a', 'c', 'd', '7', '']),
    row(['상식', '세계', '보통', 'Q2', 'a', 'b', 'c', 'd', '1', '']),
    row(['상식', '세계', '보통', 'Q2', 'd', 'c', 'b', 'a', '4', '']),
  ].join('\n'));
  const result = analyzeRecords(records, existing);
  assert.equal(result.duplicates, 2);
  assert.equal(result.errors, 1);
  assert.equal(result.ready, 1);
  const bad = result.errorRows[0].reason;
  for (const fragment of ['단원이 비어', '난이도는', '문제가 비어', '보기 네 개는 서로', '정답번호는']) assert.match(bad, new RegExp(fragment));
  assert.equal(result.readyRows[0].category, '상식');
  assert.equal(result.rows[0].category, '공통수학2');
});
