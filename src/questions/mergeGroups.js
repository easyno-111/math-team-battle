import { questionCategory, questionUnit } from "../game/questions.js";

const NAME_LIMIT = 100;
export const MERGE_BATCH_SIZE = 400;
export const groupKey = (category, unit) => JSON.stringify([category, unit]);

export function classificationGroups(questions) {
  const groups = new Map();
  for (const question of questions) {
    const category = questionCategory(question), unit = questionUnit(question);
    const key = groupKey(category, unit);
    if (!groups.has(key)) groups.set(key, { key, category, unit, count: 0 });
    groups.get(key).count += 1;
  }
  return [...groups.values()].sort((a, b) => a.category.localeCompare(b.category, "ko") || a.unit.localeCompare(b.unit, "ko"));
}

export function planGroupMerge(questions, { sourceKeys, category, unit, mode = "unit" }) {
  const targetCategory = String(category || "").trim(), targetUnit = String(unit || "").trim();
  if (!["unit", "category"].includes(mode)) throw new Error("합칠 분류 방식을 선택해주세요.");
  if (!targetCategory || targetCategory.length > NAME_LIMIT) throw new Error("분야/과목은 1~100자로 입력해주세요.");
  if (mode === "unit" && (!targetUnit || targetUnit.length > NAME_LIMIT)) throw new Error("주제/단원은 1~100자로 입력해주세요.");
  const selected = new Set(sourceKeys);
  const sources = classificationGroups(questions).filter((group) => selected.has(group.key));
  if (!sources.length) throw new Error("합칠 분류를 하나 이상 선택해주세요.");
  if (sources.length !== selected.size) throw new Error("선택한 분류가 변경됐어요. 목록을 확인한 뒤 다시 선택해주세요.");
  const changes = new Map();
  let matched = 0;
  for (const question of questions) {
    const before = { category: questionCategory(question), unit: questionUnit(question) };
    if (!selected.has(groupKey(before.category, before.unit))) continue;
    matched += 1;
    const after = { category: targetCategory, unit: mode === "unit" ? targetUnit : before.unit };
    if (before.category === after.category && before.unit === after.unit) continue;
    if (typeof question.id !== "string" || !question.id) throw new Error("문제 목록을 새로 불러온 뒤 다시 시도해주세요.");
    changes.set(question.id, { id: question.id, before, after });
  }
  if (!changes.size) throw new Error("선택한 문제들이 이미 같은 분류에 있어요. 합칠 이름을 확인해주세요.");
  return { mode, category: targetCategory, unit: targetUnit, sources, matched, changes: [...changes.values()] };
}

// Return only classification fields. A stale preview cannot overwrite another
// teacher's reclassification, recreate a deleted question, or alter its answer.
export function mergePatch(current, change, mode) {
  if (!current) throw Object.assign(new Error("대상 문제가 삭제됐어요. 분류를 다시 선택해주세요."), { code: "merge-conflict" });
  const category = questionCategory(current), unit = questionUnit(current);
  if (category === change.after.category && unit === change.after.unit) return null;
  if (category !== change.before.category || unit !== change.before.unit) {
    throw Object.assign(new Error("다른 곳에서 문제 분류가 변경됐어요. 분류를 다시 선택해주세요."), { code: "merge-conflict" });
  }
  return mode === "category" ? { category: change.after.category } : { category: change.after.category, unit: change.after.unit };
}

// One transaction per chunk; after a network error retry only the uncommitted
// IDs. Already-applied targets are accepted by mergePatch for safe retries.
export async function executeGroupMerge(plan, commit, onProgress = () => {}) {
  let completed = 0;
  for (let start = 0; start < plan.changes.length; start += MERGE_BATCH_SIZE) {
    const chunk = plan.changes.slice(start, start + MERGE_BATCH_SIZE);
    try {
      await commit(chunk, plan.mode);
    } catch (cause) {
      const error = new Error(cause.message || "분류를 합치지 못했습니다.", { cause });
      Object.assign(error, { code: cause.code, completed, remaining: plan.changes.slice(start) });
      throw error;
    }
    completed += chunk.length;
    onProgress(completed, plan.changes.length);
  }
  return completed;
}
