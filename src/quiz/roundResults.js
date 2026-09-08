import { normalizeText } from './model.js';

export function studentAnswerLabel(question, answer) {
  if (answer === null || answer === undefined) return '미제출';
  if ((question?.type === 'choice' || question?.type === 'ox') && Number.isInteger(answer) && question.choices?.[answer] !== undefined) {
    return question.type === 'ox' ? question.choices[answer] : `${String.fromCharCode(65 + answer)} · ${question.choices[answer]}`;
  }
  if (Array.isArray(answer)) return answer.map(value => String(value)).join(' → ');
  if (typeof answer === 'object') return JSON.stringify(answer);
  return String(answer);
}
export function roundAnalytics(room) {
  if (!['reveal', 'finished'].includes(room?.phase)) return { ready: false, rows: [], groups: [], total: 0, submitted: 0, correct: 0, wrong: 0, missing: 0, correctPercent: 0 };
  const question = room.reveal || room.question;
  const rows = Object.entries(room.players || {}).map(([uid, player]) => {
    const result = room.results?.[uid];
    const submitted = Boolean(result?.submitted) && result.answer !== null && result.answer !== undefined;
    const correct = submitted && Boolean(result?.correct);
    return { uid, name: String(player.name || result?.name || '이름 없음'), submitted, correct,
      points: Number(result?.points) || 0, answer: submitted ? result.answer : null,
      label: submitted ? studentAnswerLabel(question, result.answer) : '미제출' };
  }).sort((a,b) => a.name.localeCompare(b.name, 'ko', { numeric: true }) || a.uid.localeCompare(b.uid));
  const total = rows.length, submitted = rows.filter(row => row.submitted).length, correct = rows.filter(row => row.correct).length;
  const groups = [];
  if (question?.type === 'choice' || question?.type === 'ox') {
    (question.choices || []).forEach((label, index) => groups.push({ key: `choice:${index}`, label, choiceIndex: index, correct: index === Number(question.correctIndex), rows: rows.filter(row => row.submitted && row.answer === index) }));
    const others = rows.filter(row => row.submitted && (!Number.isInteger(row.answer) || row.answer < 0 || row.answer >= (question.choices?.length || 0)));
    if (others.length) groups.push({ key: 'other', label: '그 외 답안', rows: others });
  } else {
    const buckets = new Map();
    for (const row of rows.filter(row => row.submitted)) {
      const key = 'answer:' + (question?.type === 'short' ? normalizeText(row.answer) : JSON.stringify(row.answer));
      if (!buckets.has(key)) buckets.set(key, { key, label: row.label, rows: [] });
      buckets.get(key).rows.push(row);
    }
    groups.push(...[...buckets.values()].map(group => ({ ...group, correct: group.rows.every(row => row.correct) })).sort((a,b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label, 'ko', { numeric: true })));
  }
  return { ready: true, rows, groups, total, submitted, correct, wrong: submitted - correct, missing: total - submitted, correctPercent: total ? Math.round(correct / total * 100) : 0 };
}
export function responseGroup(analytics, key) {
  if (key === 'correct') return { key, label: '정답을 맞힌 학생', rows: analytics.rows.filter(row => row.correct) };
  if (key === 'wrong') return { key, label: '오답·부분 점수를 받은 학생', rows: analytics.rows.filter(row => row.submitted && !row.correct) };
  if (key === 'missing') return { key, label: '제출하지 않은 학생', rows: analytics.rows.filter(row => !row.submitted) };
  return analytics.groups.find(group => group.key === key) || null;
}
