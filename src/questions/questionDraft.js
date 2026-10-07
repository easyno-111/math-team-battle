import { normalizeChoice, questionCategory } from "../game/questions";

const DEFAULT_CATEGORY = "공통수학2";

export function blankDraft() {
  return { question: "", choices: ["", "", "", ""], correctOption: 1, explanation: "", category: DEFAULT_CATEGORY, unit: "", difficulty: "보통" };
}

export function draftFrom(item) {
  return {
    question: item.question || "",
    choices: Array.isArray(item.choices) ? item.choices.slice(0, 4) : ["", "", "", ""],
    correctOption: Number(item.correctOption || 1),
    explanation: item.explanation || "",
    category: questionCategory(item),
    unit: item.unit || "",
    difficulty: item.difficulty || "보통",
  };
}

export function validateDraft(draft) {
  const choices = draft.choices.map((choice) => choice.trim());
  if (!draft.category.trim()) return "분야/과목을 입력해주세요.";
  if (!draft.unit.trim()) return "주제/단원을 입력해주세요.";
  if (!draft.question.trim()) return "문제를 입력해주세요.";
  if (choices.some((choice) => !choice)) return "보기 4개를 모두 입력해주세요.";
  if (new Set(choices.map(normalizeChoice)).size !== 4) return "보기 4개는 서로 다른 내용이어야 합니다.";
  if (!Number.isInteger(draft.correctOption) || draft.correctOption < 1 || draft.correctOption > 4) return "정답 보기를 선택해주세요.";
  return "";
}

export function draftToPayload(draft) {
  return {
    type: "multiple-choice", schemaVersion: 2, question: draft.question.trim(), choices: draft.choices.map((c) => c.trim()), correctOption: draft.correctOption,
    explanation: draft.explanation.trim(), category: draft.category.trim(), unit: draft.unit.trim(), difficulty: draft.difficulty, enabled: true,
  };
}
