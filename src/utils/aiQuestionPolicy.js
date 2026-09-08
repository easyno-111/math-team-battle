import quality from '../../functions/question-quality.json' with { type: 'json' };

const NONSENSE = /넌센스|넌쎈스|아재\s*개그|말장난|언어유희|nonsense|dad\s*jokes?/i;
export const nonsenseGuide = quality.nonsense.join('\n');
export const reviewGuide = quality.review.join('\n');
export function isNonsenseRequest({ mode, prompt = '', topic = '', source } = {}) {
  if (mode === 'nonsense') return true;
  const explicit = String(prompt).replace(/(?:넌센스|넌쎈스|아재\s*개그|말장난|언어유희)\s*(?:퀴즈|문제|는|를|은|을|이|가|도|같은|\s)*(?:제외|빼고|말고|금지|없이|아닌)/gi, '');
  const sources = Array.isArray(source) ? source : [source];
  return NONSENSE.test([explicit, topic, ...sources.flatMap(q => [q?.category, q?.unit])].join(' '));
}
export function nonsenseSearchPrompt(request, count = 10) {
  const limit = Math.max(1, Math.min(20, Math.floor(Number(count) || 1)));
  return `${quality.search.join('\n')}\n목표 ${limit}문제에 쓸 후보를 최대 ${Math.min(30, limit * 2)}개 수집하세요. 수보다 품질을 우선하세요.\n[교사의 출제 조건]\n${String(request).slice(0, 26000)}`;
}
export function safeSources(sources = []) {
  const found = new Map();
  for (const source of sources) {
    try {
      const url = new URL(source?.uri);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      if (!found.has(url.href)) found.set(url.href, { uri: url.href, title: String(source.title || url.hostname) });
    } catch { /* Only real web links can be shown as references. */ }
  }
  return [...found.values()].slice(0, 8);
}
export function extractGroundingSources(response) {
  return safeSources((response?.candidates?.[0]?.groundingMetadata?.groundingChunks || []).flatMap(chunk => chunk.web?.uri ? [{ uri: chunk.web.uri, title: chunk.web.title }] : []));
}
export function referenceBlock({ text, sources }) {
  return `\n[검색 후보 자료]\n${text}\n[검색 출처 번호]\n${sources.map((s, i) => `${i + 1}. ${s.title} | ${s.uri}`).join('\n')}`;
}
export async function withAiTimeout(promise, milliseconds = 65000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('AI 응답이 지연됩니다. 잠시 후 다시 시도하세요.')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
export async function searchNonsense(ai, model, request, count) {
  const response = await withAiTimeout(ai.models.generateContent({ model, contents: nonsenseSearchPrompt(request, count), config: { tools: [{ googleSearch: {} }], temperature: 0.15 } }), 40000);
  const text = String(response.text || '').trim(), sources = extractGroundingSources(response);
  if (!text || !sources.length) throw new Error('넌센스 검색 출처를 확인하지 못했습니다. 임의로 문제를 만들지 않았습니다. 검색을 지원하는 모델로 다시 시도하세요.');
  return { text: text.slice(0, 18000), sources };
}
export function groundedSchema(schema, key = 'questions') {
  const list = schema.properties[key];
  return { ...schema, properties: { ...schema.properties,
    [key]: { ...list, minItems: 0, maxItems: 20, items: { ...list.items, properties: { ...list.items.properties, sourceIndex: { type: 'integer', minimum: 1, maximum: 8 } }, required: [...list.items.required, 'sourceIndex'] } },
    note: { type: 'string' } }, required: [...new Set([...schema.required, 'note'])] };
}
export function verifyNonsenseDrafts(parsed, sources, key = 'questions') {
  if (!safeSources(sources).length) throw new Error('넌센스 검색 출처가 없습니다. 문제를 다시 생성해주세요.');
  const rows = Array.isArray(parsed[key]) ? parsed[key] : [];
  const valid = rows.filter(q => Number.isInteger(q.sourceIndex) && q.sourceIndex >= 1 && q.sourceIndex <= sources.length && String(q.explanation || '').trim().length >= 8);
  const note = [parsed.note, rows.length > valid.length ? `출처 번호나 해설을 확인할 수 없는 ${rows.length - valid.length}문제는 제외했습니다.` : ''].filter(Boolean).join(' ');
  if (!valid.length) throw new Error(note || '출처와 말장난의 이유가 명확한 넌센스 후보를 찾지 못했습니다. 주제나 문제 수를 조정해주세요.');
  return { ...parsed, [key]: valid, note };
}
const reviewSnapshot = q => JSON.stringify([q.question, q.choices, q.correctOption, q.explanation]);
export function applyAiReviews(current, targets, reviews) {
  const original = new Map(targets.map((q, i) => [q.id, { snapshot: reviewSnapshot(q), index: i + 1 }]));
  return current.map(q => {
    const target = original.get(q.id);
    if (!target || target.snapshot !== reviewSnapshot(q)) return q;
    const matches = reviews.filter(r => Number.isInteger(r.index) && r.index === target.index);
    const review = matches.length === 1 && typeof matches[0].valid === 'boolean'
      ? matches[0] : { valid: false, note: '이 문제의 검수 결과가 누락되거나 중복됐습니다. 직접 확인해주세요.' };
    return { ...q, review, selected: review.valid ? q.selected : false };
  });
}
