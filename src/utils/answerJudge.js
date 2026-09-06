const EPSILON = 1e-7;

function cleanText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/√/g, "sqrt")
    .replace(/[“”‘’]/g, "")
    .replace(/\s+/g, "");
}

function parseSimpleNumber(value) {
  const text = cleanText(value).replace(/^\((.*)\)$/u, "$1");

  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(text)) {
    return Number(text);
  }

  const fraction = text.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\/([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/u);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (Math.abs(denominator) < EPSILON) return null;
    return numerator / denominator;
  }

  return null;
}

function nearlyEqual(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}

function normalizeLoose(value) {
  return cleanText(value)
    .replace(/[{}]/g, "")
    .replace(/；/g, ";")
    .replace(/，/g, ",");
}

function compareNumeric(a, b) {
  const numberA = parseSimpleNumber(a);
  const numberB = parseSimpleNumber(b);
  if (numberA === null || numberB === null) return false;
  return nearlyEqual(numberA, numberB);
}

function compareUnorderedList(student, correct) {
  const correctText = normalizeLoose(correct);
  const studentText = normalizeLoose(student);

  if (correctText.startsWith("(") || correctText.startsWith("[") || correctText.startsWith("{")) {
    return false;
  }

  if (!correctText.includes(",") || !studentText.includes(",")) return false;

  const split = (value) => value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ko"));

  const a = split(studentText);
  const b = split(correctText);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function parseLinearTerm(term) {
  if (!term) return { x: 0, y: 0, c: 0 };

  const variableMatch = term.match(/^(.+?)([xy])$/u) || term.match(/^([xy])$/u);
  if (variableMatch) {
    let coefficientText;
    let variable;

    if (variableMatch.length === 3) {
      coefficientText = variableMatch[1];
      variable = variableMatch[2];
    } else {
      coefficientText = "1";
      variable = variableMatch[1];
    }

    if (coefficientText === "" || coefficientText === "+") coefficientText = "1";
    if (coefficientText === "-") coefficientText = "-1";

    const coefficient = parseSimpleNumber(coefficientText);
    if (coefficient === null) return null;

    return variable === "x"
      ? { x: coefficient, y: 0, c: 0 }
      : { x: 0, y: coefficient, c: 0 };
  }

  const constant = parseSimpleNumber(term);
  if (constant === null) return null;
  return { x: 0, y: 0, c: constant };
}

function parseLinearExpression(expression) {
  const text = cleanText(expression)
    .replace(/\(([-+]?\d+(?:\.\d+)?\/[-+]?\d+(?:\.\d+)?)\)(?=[xy])/gu, "$1")
    .replace(/-/g, "+-")
    .replace(/^\+/, "");

  if (!text || /[^0-9xy+\-./]/u.test(text)) return null;

  const result = { x: 0, y: 0, c: 0 };
  for (const term of text.split("+").filter(Boolean)) {
    const parsed = parseLinearTerm(term);
    if (!parsed) return null;
    result.x += parsed.x;
    result.y += parsed.y;
    result.c += parsed.c;
  }

  return result;
}

function parseLinearEquation(value) {
  const text = cleanText(value);
  const pieces = text.split("=");
  if (pieces.length !== 2) return null;

  const left = parseLinearExpression(pieces[0]);
  const right = parseLinearExpression(pieces[1]);
  if (!left || !right) return null;

  return {
    x: left.x - right.x,
    y: left.y - right.y,
    c: left.c - right.c,
  };
}

function compareLinearEquations(student, correct) {
  const a = parseLinearEquation(student);
  const b = parseLinearEquation(correct);
  if (!a || !b) return false;

  const vectorA = [a.x, a.y, a.c];
  const vectorB = [b.x, b.y, b.c];
  const pivot = vectorB.findIndex((value) => Math.abs(value) > EPSILON);

  if (pivot === -1) {
    return vectorA.every((value) => Math.abs(value) <= EPSILON);
  }

  if (Math.abs(vectorA[pivot]) <= EPSILON) return false;
  const ratio = vectorA[pivot] / vectorB[pivot];

  return vectorA.every((value, index) => nearlyEqual(value, vectorB[index] * ratio));
}

function toSafeJsExpression(expression) {
  let text = cleanText(expression);
  if (!text || /[^0-9xy+\-*/().^]/u.test(text)) return null;

  text = text
    .replace(/(\d|\))(?=[xy(])/gu, "$1*")
    .replace(/([xy])(?=\()/gu, "$1*")
    .replace(/([xy)])(?=[xy])/gu, "$1*")
    .replace(/\^/g, "**");

  return text;
}

function evaluateSafeExpression(expression, x, y) {
  const safe = toSafeJsExpression(expression);
  if (!safe) return null;

  try {
    // 입력 문자열은 위의 화이트리스트를 통과한 숫자/연산자/x/y만 허용한다.
    const fn = new Function("x", "y", `return (${safe});`);
    const value = fn(x, y);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function equationValues(value) {
  const text = cleanText(value);
  const pieces = text.split("=");
  if (pieces.length !== 2) return null;

  const samples = [
    [0, 0],
    [1, 2],
    [-2, 3],
    [4, -1],
    [2.5, -3.5],
    [-1.5, -2.25],
  ];

  const values = [];
  for (const [x, y] of samples) {
    const left = evaluateSafeExpression(pieces[0], x, y);
    const right = evaluateSafeExpression(pieces[1], x, y);
    if (left === null || right === null) return null;
    values.push(left - right);
  }
  return values;
}

function comparePolynomialEquations(student, correct) {
  const a = equationValues(student);
  const b = equationValues(correct);
  if (!a || !b) return false;

  let ratio = null;
  for (let index = 0; index < b.length; index += 1) {
    if (Math.abs(b[index]) > EPSILON) {
      if (Math.abs(a[index]) <= EPSILON) return false;
      ratio = a[index] / b[index];
      break;
    }
  }

  if (ratio === null) {
    return a.every((value) => Math.abs(value) <= EPSILON);
  }

  return a.every((value, index) => nearlyEqual(value, b[index] * ratio));
}

function compareSingleAnswer(student, correct) {
  const looseStudent = normalizeLoose(student);
  const looseCorrect = normalizeLoose(correct);

  if (!looseStudent || !looseCorrect) return false;
  if (looseStudent === looseCorrect) return true;
  if (compareNumeric(student, correct)) return true;
  if (compareUnorderedList(student, correct)) return true;
  if (compareLinearEquations(student, correct)) return true;
  if (comparePolynomialEquations(student, correct)) return true;

  return false;
}

export function isAnswerCorrect(studentAnswer, storedAnswer) {
  const candidates = String(storedAnswer ?? "")
    .split("|")
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  if (candidates.length === 0) return false;
  return candidates.some((candidate) => compareSingleAnswer(studentAnswer, candidate));
}

export function attackPowerForDifficulty(difficulty) {
  if (difficulty === "쉬움") return 1;
  if (difficulty === "보통") return 2;
  if (difficulty === "어려움") return 3;
  if (difficulty === "도전") return 5;
  return 1;
}
