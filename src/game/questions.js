// Question-bank helpers shared by the question list, importer and game room.
export const DIFFICULTIES = ["쉬움", "보통", "어려움", "도전"];
export const DEFAULT_CATEGORY = "기존 문제";
export const CHOICE_LABELS = ["①", "②", "③", "④"];

export function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\r\n/g, "\n").trim();
}

export function normalizeChoice(value) {
  return cleanText(value).normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko");
}

export function questionCategory(question) {
  return cleanText(question?.category || question?.subject) || DEFAULT_CATEGORY;
}

export function questionUnit(question) {
  return cleanText(question?.unit);
}

// A stored question the game can show: four distinct choices and one correct index.
export function isMultipleChoiceQuestion(question) {
  const choices = Array.isArray(question?.choices) ? question.choices : [];
  const correctOption = Number(question?.correctOption);
  return (
    question?.type === "multiple-choice" &&
    choices.length === 4 &&
    choices.every((choice) => cleanText(choice)) &&
    new Set(choices.map(normalizeChoice)).size === 4 &&
    Number.isInteger(correctOption) &&
    correctOption >= 1 &&
    correctOption <= 4
  );
}

export function isPlayableQuestion(question) {
  return isMultipleChoiceQuestion(question) && question.enabled !== false;
}

export function correctAnswerOf(question) {
  return question?.choices?.[Number(question.correctOption) - 1] ?? "";
}

export function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

// What a student receives: never the correct option, choices in a fresh order.
export function publicQuestion(question, random = Math.random) {
  if (!isPlayableQuestion(question)) return null;
  return {
    id: question.id,
    text: question.question,
    choices: shuffle(question.choices.map(String), random),
    category: questionCategory(question),
    unit: questionUnit(question),
    difficulty: DIFFICULTIES.includes(question.difficulty) ? question.difficulty : "보통",
  };
}

// Prefer unseen questions; when all are seen, start over but avoid repeating the current one.
export function chooseNextQuestion(pool, state, random = Math.random) {
  if (!pool.length) return { question: null, seen: {} };
  const seen = state?.seenQuestionIds || {};
  const unseen = pool.filter((question) => !seen[question.id]);
  const source = unseen.length ? unseen : pool;
  const currentId = state?.currentQuestion?.id;
  const fresh = source.filter((question) => question.id !== currentId);
  const candidates = fresh.length ? fresh : source;
  const question = candidates[Math.floor(random() * candidates.length)];
  return { question, seen: unseen.length ? { ...seen, [question.id]: true } : { [question.id]: true } };
}

export function filterQuestionPool(questions, config) {
  const categories = Array.isArray(config?.categories) ? config.categories : [];
  const units = Array.isArray(config?.units) ? config.units : [];
  const difficulties = Array.isArray(config?.difficulties) ? config.difficulties : [];
  return questions.filter((question) => (
    isPlayableQuestion(question) &&
    (!categories.length || categories.includes(questionCategory(question))) &&
    (!units.length || units.includes(questionUnit(question))) &&
    (!difficulties.length || difficulties.includes(question.difficulty))
  ));
}
