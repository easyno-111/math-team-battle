import { fromBank, newId, normalizeText, validateQuestion } from './model.js';

export const QUIZ_LIMIT = 40;
export function questionFingerprint(q) {
  const choices = Array.isArray(q.choices) ? q.choices.map(normalizeText) : [];
  return JSON.stringify([q.type, normalizeText(q.question), [...choices].sort(),
    q.type === 'choice' || q.type === 'ox' ? choices[Number(q.correctIndex)] : null]);
}
export function prepareBank(questions = []) {
  return questions.filter(q => q && q.enabled !== false && Array.isArray(q.choices)
    && Number.isInteger(Number(q.correctOption)) && Number(q.correctOption) >= 1
    && Number(q.correctOption) <= q.choices.length).map(raw => {
    const q = fromBank(raw);
    const sourceBankId = String(raw.id || questionFingerprint(q));
    return { ...q, id: `bank:${sourceBankId}`, sourceBankId,
      category: String(q.category).trim() || '기존 문제', unit: String(q.unit).trim() || '주제 미지정' };
  }).filter(q => !validateQuestion(q).length);
}
export function existingBankIndex(questions = []) {
  return { ids: new Set(questions.map(q => q.sourceBankId).filter(Boolean)), fingerprints: new Set(questions.map(questionFingerprint)) };
}
export function alreadyInSet(q, index) {
  return Boolean(q.sourceBankId && index.ids.has(q.sourceBankId)) || index.fingerprints.has(questionFingerprint(q));
}
export function uniqueAvailableBank(bank, existing = []) {
  const index = existingBankIndex(existing);
  return bank.filter(q => {
    if (alreadyInSet(q, index)) return false;
    if (q.sourceBankId) index.ids.add(q.sourceBankId);
    index.fingerprints.add(questionFingerprint(q));
    return true;
  });
}
export function matchesBank(q, { category = '', unit = '', difficulty = '', search = '' } = {}) {
  if (category && q.category !== category || unit && q.unit !== unit || difficulty && q.difficulty !== difficulty) return false;
  const terms = String(search).trim().split(/\s+/).filter(Boolean).map(normalizeText);
  if (!terms.length) return true;
  const haystack = normalizeText([q.category, q.unit, q.difficulty, q.question, ...(q.choices || [])].join(' '));
  return terms.every(term => haystack.includes(term));
}
export function bankOptions(bank, field) {
  return [...new Set(bank.map(q => q[field]).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'ko'));
}
export function copyBankQuestion(q, duration = q.duration) {
  return { ...q, id: newId(), choices: [...q.choices], answers: [...(q.answers || [])], items: [...(q.items || [])], duration: Number(duration) };
}
export function appendBankQuestions(draft, chosen) {
  const available = uniqueAvailableBank(chosen, draft.questions);
  if (draft.questions.length + available.length > QUIZ_LIMIT) throw new Error(`현재 ${draft.questions.length}문제입니다. 최대 40문제까지 담을 수 있어 ${QUIZ_LIMIT - draft.questions.length}문제만 더 선택할 수 있어요.`);
  if (available.some(q => validateQuestion(q).length)) throw new Error('선택한 문제의 내용이나 정답을 먼저 확인해주세요.');
  return { draft: { ...draft, questions: [...draft.questions, ...available.map(q => copyBankQuestion(q))] }, added: available.length, skipped: chosen.length - available.length };
}
export function readQuizDraft(raw) {
  if (!raw) return { id: newId(), title: '새 퀴즈 세트', questions: [] };
  const draft = JSON.parse(raw);
  if (!draft || !Array.isArray(draft.questions) || typeof draft.title !== 'string' || typeof draft.id !== 'string') throw new Error('퀴즈 초안을 읽지 못했습니다. 퀴즈 모드에서 초안을 확인해주세요.');
  return draft;
}
function randomOrder(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
// Match each requested slot to a distinct question. Reassignment prevents a broad
// condition from taking the only questions usable by a narrower condition.
export function composeBankRecipe(bank, recipe, { existing = [], shuffleAll = true, random = Math.random } = {}) {
  if (!Array.isArray(recipe) || !recipe.length || recipe.length > QUIZ_LIMIT) throw new Error('출제 조건을 1~40개 추가해주세요.');
  const total = recipe.reduce((sum, row) => sum + Number(row.count), 0);
  for (const [i, row] of recipe.entries()) {
    if (!Number.isInteger(Number(row.count)) || row.count < 1 || row.count > QUIZ_LIMIT) throw new Error(`${i + 1}번째 조건의 문제 수는 1~40 사이의 정수로 입력하세요.`);
    if (!Number.isInteger(Number(row.duration)) || row.duration < 10 || row.duration > 240) throw new Error(`${i + 1}번째 조건의 제한시간은 10~240초로 입력하세요.`);
  }
  if (total + existing.length > QUIZ_LIMIT) throw new Error(`기존 ${existing.length}문제 + 요청 ${total}문제 = ${existing.length + total}문제입니다. 한 세트는 최대 40문제예요.`);
  const available = uniqueAvailableBank(bank, existing);
  const groups = recipe.map((row, i) => {
    const candidates = available.flatMap((q, index) => matchesBank(q, row) ? [index] : []);
    return { ...row, rowIndex: i, count: Number(row.count), duration: Number(row.duration), candidates: randomOrder(candidates, random) };
  });
  const shortages = groups.filter(row => row.candidates.length < row.count).map(row => `${row.rowIndex + 1}번째 조건 (${row.unit || row.category || '전체'}): 요청 ${row.count}문제 / 사용 가능 ${row.candidates.length}문제`);
  if (shortages.length) throw new Error(shortages.join('\n'));
  const slots = groups.flatMap(row => Array.from({ length: row.count }, () => ({ row, match: -1 })));
  const owner = new Map();
  function assign(slot, seen) {
    for (const candidate of slot.row.candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (!owner.has(candidate) || assign(owner.get(candidate), seen)) {
        owner.set(candidate, slot); slot.match = candidate; return true;
      }
    }
    return false;
  }
  for (const slot of [...slots].sort((a,b) => a.row.candidates.length - b.row.candidates.length)) {
    if (!assign(slot, new Set())) throw new Error('여러 조건이 같은 문제를 공유하고 있어 중복 없이 요청한 수를 채울 수 없습니다. 조건이나 문제 수를 조정해주세요.');
  }
  const questions = slots.map(slot => copyBankQuestion(available[slot.match], slot.row.duration));
  return { questions: shuffleAll ? randomOrder(questions, random) : questions, groups: groups.map(({ rowIndex, category, unit, difficulty, count, duration }) => ({ rowIndex, category, unit, difficulty, count, duration })) };
}
