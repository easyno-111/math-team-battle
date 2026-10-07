// One validator for every bulk-import path: pasted spreadsheet text and .xlsx upload.
import * as XLSX from "@keep-lts/xlsx";
import { cleanText, DEFAULT_CATEGORY, DIFFICULTIES, isMultipleChoiceQuestion, normalizeChoice } from "../game/questions.js";

export const TEMPLATE_SHEET_NAME = "문제은행";
export const TEMPLATE_FILE_NAME = "팀퀴즈배틀_객관식_문제등록양식.xlsx";
export const IMPORT_COLUMNS = ["분야/과목", "단원", "난이도", "문제", "보기1", "보기2", "보기3", "보기4", "정답번호", "해설"];
const REQUIRED = ["단원", "난이도", "문제", "보기1", "보기2", "보기3", "보기4", "정답번호"];
const CATEGORY_ALIASES = ["분야/과목", "분야", "과목", "카테고리"];
export const MAX_IMPORT_ROWS = 5000;
export const LIMITS = { category: 100, unit: 100, question: 2000, choice: 500, explanation: 2000 };

function normalizeHeader(value) {
  return cleanText(value).replace(/\s+/g, "");
}

export function normalizeQuestionKey(question, choices, correctOption) {
  const normalizedChoices = choices.map(normalizeChoice);
  return `${normalizeChoice(question)}::${[...normalizedChoices].sort().join("|")}::${normalizedChoices[Number(correctOption) - 1] || ""}`;
}

// Maps a header row to column indexes. Returns null when the row is not a header.
export function detectHeader(cells) {
  const map = new Map(cells.map((cell, index) => [normalizeHeader(cell), index]));
  const missing = REQUIRED.filter((header) => !map.has(normalizeHeader(header)));
  if (missing.length) return { map: null, missing };
  const category = CATEGORY_ALIASES.map((alias) => map.get(normalizeHeader(alias))).find((index) => index !== undefined);
  return {
    missing: [],
    map: {
      category, unit: map.get("단원"), difficulty: map.get("난이도"), question: map.get("문제"),
      choices: [1, 2, 3, 4].map((n) => map.get(`보기${n}`)), correctOption: map.get("정답번호"), explanation: map.get("해설"),
    },
  };
}

const POSITIONAL = { category: 0, unit: 1, difficulty: 2, question: 3, choices: [4, 5, 6, 7], correctOption: 8, explanation: 9 };

function recordFromCells(cells, columns, rowNumber) {
  const at = (index) => (index === undefined ? "" : cleanText(cells[index]));
  return {
    rowNumber,
    category: columns.category === undefined ? "" : at(columns.category),
    unit: at(columns.unit),
    difficulty: at(columns.difficulty),
    question: at(columns.question),
    choices: columns.choices.map(at),
    correctOptionRaw: at(columns.correctOption),
    explanation: at(columns.explanation),
  };
}

function isBlankRow(cells) {
  return !cells.some((cell) => cleanText(cell));
}

// Text copied from Excel or Google Sheets: tab-separated cells, newline-separated rows.
// A header row is optional; without one the template column order is assumed.
export function recordsFromText(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const rows = lines.map((line) => line.split("\t"));
  while (rows.length && isBlankRow(rows[rows.length - 1])) rows.pop();
  const firstIndex = rows.findIndex((cells) => !isBlankRow(cells));
  if (firstIndex < 0) throw new Error("붙여넣은 내용이 없습니다. 엑셀에서 문제 범위를 복사해 붙여넣어 주세요.");
  const header = detectHeader(rows[firstIndex]);
  const looksLikeHeader = rows[firstIndex].some((cell) => normalizeHeader(cell) === "문제" || normalizeHeader(cell) === "정답번호");
  if (looksLikeHeader && !header.map) throw new Error(`머리글에 필요한 열이 없습니다: ${header.missing.join(", ")}`);
  const columns = header.map || POSITIONAL;
  const start = header.map ? firstIndex + 1 : firstIndex;
  if (!header.map && rows[firstIndex].length < 9) {
    throw new Error("열이 부족합니다. 분야/과목, 단원, 난이도, 문제, 보기1~4, 정답번호, 해설 순서로 10개 열을 복사하거나 머리글을 함께 붙여넣어 주세요.");
  }
  return rows.slice(start).map((cells, offset) => ({ cells, rowNumber: start + offset + 1 })).filter(({ cells }) => !isBlankRow(cells)).map(({ cells, rowNumber }) => recordFromCells(cells, columns, rowNumber));
}

export async function recordsFromWorkbook(file) {
  if (!file) throw new Error("Excel 파일을 선택해주세요.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error(".xlsx 형식의 파일만 사용할 수 있습니다.");
  if (file.size > 10 * 1024 * 1024) throw new Error("파일이 너무 큽니다. 10MB 이하의 Excel 파일을 사용해주세요.");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, cellFormula: false });
  const sheetName = workbook.SheetNames.includes(TEMPLATE_SHEET_NAME) ? TEMPLATE_SHEET_NAME : workbook.SheetNames[0];
  if (!sheetName) throw new Error("시트가 없는 파일입니다.");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false, blankrows: true });
  if (!rows.length) throw new Error(`'${sheetName}' 시트가 비어 있습니다.`);
  const header = detectHeader(rows[0] || []);
  if (!header.map) throw new Error(`첫 행에 필요한 열이 없습니다: ${header.missing.join(", ")}. 양식을 다시 받아 사용해주세요.`);
  return rows.slice(1).map((cells, offset) => ({ cells, rowNumber: offset + 2 })).filter(({ cells }) => !isBlankRow(cells)).map(({ cells, rowNumber }) => recordFromCells(cells, header.map, rowNumber));
}

export function analyzeRecords(records, existingQuestions = []) {
  if (!records.length) throw new Error("등록할 문제가 없습니다.");
  if (records.length > MAX_IMPORT_ROWS) throw new Error(`한 번에 최대 ${MAX_IMPORT_ROWS.toLocaleString()}문제까지 등록할 수 있습니다.`);
  const existingKeys = new Set(existingQuestions.filter(isMultipleChoiceQuestion).map((item) => normalizeQuestionKey(item.question, item.choices, item.correctOption)));
  const seenKeys = new Set();
  const rows = records.map((record) => {
    const errors = [];
    const category = record.category || DEFAULT_CATEGORY;
    const correctOption = Number(record.correctOptionRaw);
    if (!record.unit) errors.push("단원이 비어 있습니다.");
    if (!record.difficulty) errors.push("난이도가 비어 있습니다.");
    else if (!DIFFICULTIES.includes(record.difficulty)) errors.push(`난이도는 ${DIFFICULTIES.join(" / ")} 중 하나여야 합니다.`);
    if (!record.question) errors.push("문제가 비어 있습니다.");
    record.choices.forEach((choice, index) => {
      if (!choice) errors.push(`보기${index + 1}이 비어 있습니다.`);
      else if (choice.length > LIMITS.choice) errors.push(`보기${index + 1}은 ${LIMITS.choice}자 이하로 입력해주세요.`);
    });
    if (record.choices.every(Boolean) && new Set(record.choices.map(normalizeChoice)).size !== 4) errors.push("보기 네 개는 서로 달라야 합니다.");
    if (!record.correctOptionRaw) errors.push("정답번호가 비어 있습니다.");
    else if (!Number.isInteger(correctOption) || correctOption < 1 || correctOption > 4) errors.push("정답번호는 1, 2, 3, 4 중 하나여야 합니다.");
    if (category.length > LIMITS.category) errors.push(`분야/과목은 ${LIMITS.category}자 이하로 입력해주세요.`);
    if (record.unit.length > LIMITS.unit) errors.push(`단원은 ${LIMITS.unit}자 이하로 입력해주세요.`);
    if (record.question.length > LIMITS.question) errors.push(`문제는 ${LIMITS.question.toLocaleString()}자 이하로 입력해주세요.`);
    if (record.explanation.length > LIMITS.explanation) errors.push(`해설은 ${LIMITS.explanation.toLocaleString()}자 이하로 입력해주세요.`);

    const key = normalizeQuestionKey(record.question, record.choices, correctOption);
    let status = "ready";
    let reason = "등록 가능";
    if (errors.length) { status = "error"; reason = errors.join(" "); }
    else if (existingKeys.has(key)) { status = "duplicate"; reason = "이미 문제은행에 같은 문제가 있습니다."; }
    else if (seenKeys.has(key)) { status = "duplicate"; reason = "붙여넣은 내용 안에 같은 문제가 중복되어 있습니다."; }
    else seenKeys.add(key);

    return { ...record, category, correctOption, correctAnswer: record.choices[correctOption - 1] || "", status, reason };
  });
  const readyRows = rows.filter((row) => row.status === "ready");
  const errorRows = rows.filter((row) => row.status === "error");
  const duplicateRows = rows.filter((row) => row.status === "duplicate");
  return { total: rows.length, ready: readyRows.length, errors: errorRows.length, duplicates: duplicateRows.length, rows, readyRows, errorRows, duplicateRows };
}

export function toQuestionDocument(row, meta) {
  return {
    type: "multiple-choice", schemaVersion: 2, question: row.question, choices: row.choices, correctOption: row.correctOption,
    explanation: row.explanation || "", category: row.category || DEFAULT_CATEGORY, unit: row.unit, difficulty: row.difficulty, enabled: true, ...meta,
  };
}

export function headerLine() {
  return IMPORT_COLUMNS.join("\t");
}

export function downloadQuestionTemplate() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    IMPORT_COLUMNS,
    ["공통수학2", "평면좌표", "쉬움", "두 점 A(1, 2), B(4, 6) 사이의 거리를 구하시오.", "3", "4", "5", "6", "3", "두 점 사이의 거리 공식을 이용하면 5이다."],
    ["상식퀴즈", "세계 상식", "보통", "프랑스의 수도는 어디인가?", "파리", "로마", "마드리드", "베를린", "1", "프랑스의 수도는 파리이다."],
  ]);
  sheet["!cols"] = [18, 20, 12, 58, 28, 28, 28, 28, 12, 58].map((wch) => ({ wch }));
  const guide = XLSX.utils.aoa_to_sheet([
    ["수학 팀 배틀 객관식 문제 등록 안내"], [],
    ["작성 시트", `'${TEMPLATE_SHEET_NAME}' 시트의 예시 두 줄을 지우고 문제를 입력하세요.`],
    ["필수 열", REQUIRED.join(" / ")],
    ["선택 열", "분야/과목(비우면 '기존 문제')과 해설은 비워도 됩니다."],
    ["난이도", DIFFICULTIES.join(" / ")],
    ["정답번호", "보기1이 정답이면 1처럼 1~4의 숫자를 입력하세요."],
    ["수식", "x^2, x_1, sqrt(2), \\frac{1}{2} 표기를 화면에서 수식으로 보여줍니다."],
    ["빠른 방법", "웹앱의 '엑셀에서 붙여넣기' 칸에 이 시트의 범위를 복사해 붙여넣어도 됩니다."],
  ]);
  guide["!cols"] = [{ wch: 14 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(workbook, sheet, TEMPLATE_SHEET_NAME);
  XLSX.utils.book_append_sheet(workbook, guide, "작성안내");
  XLSX.writeFile(workbook, TEMPLATE_FILE_NAME, { compression: true });
}
