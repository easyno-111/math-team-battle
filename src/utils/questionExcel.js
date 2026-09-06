import * as XLSX from "@keep-lts/xlsx";

export const QUESTION_DIFFICULTIES = ["쉬움", "보통", "어려움", "도전"];
export const TEMPLATE_SHEET_NAME = "문제은행";
export const TEMPLATE_FILE_NAME = "팀퀴즈배틀_객관식_문제등록양식.xlsx";

const REQUIRED_HEADERS = [
  "단원",
  "난이도",
  "문제",
  "보기1",
  "보기2",
  "보기3",
  "보기4",
  "정답번호",
];
const OPTIONAL_HEADERS = ["해설"];
const TEMPLATE_HEADERS = ["분야/과목", ...REQUIRED_HEADERS, ...OPTIONAL_HEADERS];
const MAX_IMPORT_ROWS = 5000;

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\r\n/g, "\n").trim();
}

function normalizeHeader(value) {
  return cleanText(value).replace(/\s+/g, "");
}

function normalizeComparable(value) {
  return cleanText(value)
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ko");
}

export function isMultipleChoiceQuestion(question) {
  const choices = Array.isArray(question?.choices) ? question.choices : [];
  const correctOption = Number(question?.correctOption);

  return (
    question?.type === "multiple-choice" &&
    choices.length === 4 &&
    choices.every((choice) => cleanText(choice)) &&
    Number.isInteger(correctOption) &&
    correctOption >= 1 &&
    correctOption <= 4
  );
}

export function normalizeQuestionKey(question, choices, correctOption) {
  const normalizedQuestion = normalizeComparable(question);
  const normalizedChoices = choices.map(normalizeComparable);
  const correctAnswer = normalizedChoices[Number(correctOption) - 1] || "";

  return `${normalizedQuestion}::${[...normalizedChoices].sort().join("|")}::${correctAnswer}`;
}

export function downloadQuestionTemplate() {
  const workbook = XLSX.utils.book_new();

  const questionSheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);

  questionSheet["!cols"] = [
    { wch: 18 },
    { wch: 20 },
    { wch: 12 },
    { wch: 58 },
    { wch: 28 },
    { wch: 28 },
    { wch: 28 },
    { wch: 28 },
    { wch: 12 },
    { wch: 58 },
  ];
  questionSheet["!autofilter"] = { ref: "A1:J1" };

  const guideRows = [
    ["수학 팀 배틀 4지선다 문제 일괄 등록 안내"],
    [],
    ["항목", "내용"],
    ["작성 시트", `'${TEMPLATE_SHEET_NAME}' 시트에 문제를 입력하세요.`],
    ["분야/과목", "공통수학2, 상식퀴즈, 넌센스퀴즈처럼 큰 분류를 입력합니다. 비워두면 '기존 문제'로 저장됩니다."],
    ["필수 열", "단원 / 난이도 / 문제 / 보기1 / 보기2 / 보기3 / 보기4 / 정답번호"],
    ["선택 열", "분야/과목과 해설은 비워두어도 됩니다."],
    ["난이도", QUESTION_DIFFICULTIES.join(" / ")],
    ["정답번호", "보기1이 정답이면 1, 보기2가 정답이면 2처럼 1~4의 숫자로 입력하세요."],
    ["보기", "보기 네 개는 모두 입력해야 하며 서로 같은 보기는 사용할 수 없습니다."],
    ["수식", "x^2, x_1처럼 입력해도 됩니다. 앱 화면에서 위첨자/아래첨자로 표시됩니다."],
    ["주의", "문제은행 시트의 첫 번째 행 제목은 수정하거나 삭제하지 마세요."],
    ["주의", "내용이 = 기호로 시작하면 Excel이 수식으로 인식할 수 있으니 맨 앞에 작은따옴표(')를 붙여 입력하세요."],
    ["중복", "문제·보기·정답이 같은 문항은 자동으로 중복 처리합니다."],
    ["게임", "학생에게는 보기 순서가 자동으로 섞여서 출제됩니다."],
    [],
    ["작성 예시"],
    ["분야/과목", "단원", "난이도", "문제", "보기1", "보기2", "보기3", "보기4", "정답번호", "해설"],
    ["공통수학2", "평면좌표", "쉬움", "두 점 A(1, 2), B(4, 6) 사이의 거리를 구하시오.", "3", "4", "5", "6", "3", "두 점 사이의 거리 공식을 이용하면 5이다."],
    ["상식퀴즈", "세계 상식", "보통", "프랑스의 수도는 어디인가?", "파리", "로마", "마드리드", "베를린", "1", "프랑스의 수도는 파리이다."],
  ];

  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows);
  guideSheet["!cols"] = [
    { wch: 18 },
    { wch: 80 },
    { wch: 58 },
    { wch: 28 },
    { wch: 28 },
    { wch: 28 },
    { wch: 28 },
    { wch: 12 },
    { wch: 58 },
  ];

  XLSX.utils.book_append_sheet(workbook, questionSheet, TEMPLATE_SHEET_NAME);
  XLSX.utils.book_append_sheet(workbook, guideSheet, "작성안내");

  XLSX.writeFile(workbook, TEMPLATE_FILE_NAME, { compression: true });
}

export async function parseQuestionWorkbook(file, existingQuestions = []) {
  if (!file) {
    throw new Error("Excel 파일을 선택해주세요.");
  }

  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".xlsx")) {
    throw new Error(".xlsx 형식의 문제 등록 양식만 사용할 수 있습니다.");
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error("파일이 너무 큽니다. 10MB 이하의 Excel 파일을 사용해주세요.");
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: false,
    cellFormula: false,
  });

  if (!workbook.SheetNames.includes(TEMPLATE_SHEET_NAME)) {
    throw new Error(`'${TEMPLATE_SHEET_NAME}' 시트를 찾지 못했습니다. 웹앱에서 새 객관식 양식을 받아 사용해주세요.`);
  }

  const sheet = workbook.Sheets[TEMPLATE_SHEET_NAME];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: true,
  });

  if (rows.length === 0) {
    throw new Error("문제은행 시트가 비어 있습니다.");
  }

  const headerRow = rows[0] ?? [];
  const headerMap = new Map();

  headerRow.forEach((header, index) => {
    headerMap.set(normalizeHeader(header), index);
  });

  const missingHeaders = REQUIRED_HEADERS.filter(
    (header) => !headerMap.has(normalizeHeader(header))
  );

  if (missingHeaders.length > 0) {
    throw new Error(
      `새 객관식 양식에 필요한 열이 없습니다: ${missingHeaders.join(", ")}. 웹앱에서 양식을 다시 받아주세요.`
    );
  }

  const nonEmptyRows = rows.slice(1).filter((row) =>
    row.some((cell) => cleanText(cell) !== "")
  );

  if (nonEmptyRows.length === 0) {
    throw new Error("등록할 문제가 없습니다. 문제은행 시트에 문제를 입력해주세요.");
  }

  if (nonEmptyRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`한 번에 최대 ${MAX_IMPORT_ROWS.toLocaleString()}문제까지 등록할 수 있습니다.`);
  }

  const existingKeys = new Set(
    existingQuestions
      .filter(isMultipleChoiceQuestion)
      .map((item) => normalizeQuestionKey(item.question, item.choices, item.correctOption))
  );
  const uploadKeys = new Set();

  const analyzedRows = [];

  for (let i = 1; i < rows.length; i += 1) {
    const sourceRow = rows[i] ?? [];
    const hasValue = sourceRow.some((cell) => cleanText(cell) !== "");
    if (!hasValue) continue;

    const categoryIndex = ["분야/과목", "분야", "과목"]
      .map((header) => headerMap.get(normalizeHeader(header)))
      .find((index) => index !== undefined);
    const category = categoryIndex === undefined ? "기존 문제" : (cleanText(sourceRow[categoryIndex]) || "기존 문제");
    const unit = cleanText(sourceRow[headerMap.get("단원")]);
    const difficulty = cleanText(sourceRow[headerMap.get("난이도")]);
    const question = cleanText(sourceRow[headerMap.get("문제")]);
    const choices = [1, 2, 3, 4].map((number) =>
      cleanText(sourceRow[headerMap.get(`보기${number}`)])
    );
    const correctOptionRaw = cleanText(sourceRow[headerMap.get("정답번호")]);
    const correctOption = Number(correctOptionRaw);
    const explanationIndex = headerMap.get("해설");
    const explanation = explanationIndex === undefined
      ? ""
      : cleanText(sourceRow[explanationIndex]);

    const errors = [];

    if (!unit) errors.push("단원이 비어 있습니다.");
    if (!difficulty) errors.push("난이도가 비어 있습니다.");
    if (difficulty && !QUESTION_DIFFICULTIES.includes(difficulty)) {
      errors.push(`난이도는 ${QUESTION_DIFFICULTIES.join(" / ")} 중 하나여야 합니다.`);
    }
    if (!question) errors.push("문제가 비어 있습니다.");

    choices.forEach((choice, index) => {
      if (!choice) errors.push(`보기${index + 1}이 비어 있습니다.`);
      if (choice.length > 500) errors.push(`보기${index + 1}은 500자 이하로 입력해주세요.`);
    });

    const normalizedChoices = choices.map(normalizeComparable).filter(Boolean);
    if (normalizedChoices.length === 4 && new Set(normalizedChoices).size !== 4) {
      errors.push("보기 네 개는 서로 달라야 합니다.");
    }

    if (!correctOptionRaw) {
      errors.push("정답번호가 비어 있습니다.");
    } else if (!Number.isInteger(correctOption) || correctOption < 1 || correctOption > 4) {
      errors.push("정답번호는 1, 2, 3, 4 중 하나여야 합니다.");
    }

    if (category.length > 100) errors.push("분야/과목은 100자 이하로 입력해주세요.");
    if (unit.length > 100) errors.push("단원은 100자 이하로 입력해주세요.");
    if (question.length > 2000) errors.push("문제는 2,000자 이하로 입력해주세요.");
    if (explanation.length > 2000) errors.push("해설은 2,000자 이하로 입력해주세요.");

    const key = normalizeQuestionKey(question, choices, correctOption);
    let status = "ready";
    let reason = "등록 가능";

    if (errors.length > 0) {
      status = "error";
      reason = errors.join(" ");
    } else if (existingKeys.has(key)) {
      status = "duplicate";
      reason = "이미 문제은행에 같은 객관식 문제가 있습니다.";
    } else if (uploadKeys.has(key)) {
      status = "duplicate";
      reason = "이 Excel 파일 안에 같은 문제가 중복되어 있습니다.";
    } else {
      uploadKeys.add(key);
    }

    analyzedRows.push({
      excelRow: i + 1,
      category,
      unit,
      difficulty,
      question,
      choices,
      correctOption,
      correctAnswer: choices[correctOption - 1] || "",
      explanation,
      status,
      reason,
    });
  }

  const readyRows = analyzedRows.filter((row) => row.status === "ready");
  const errorRows = analyzedRows.filter((row) => row.status === "error");
  const duplicateRows = analyzedRows.filter((row) => row.status === "duplicate");

  return {
    fileName: file.name,
    total: analyzedRows.length,
    ready: readyRows.length,
    errors: errorRows.length,
    duplicates: duplicateRows.length,
    rows: analyzedRows,
    readyRows,
    errorRows,
    duplicateRows,
  };
}
