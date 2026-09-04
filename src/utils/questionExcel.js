import * as XLSX from "@keep-lts/xlsx";

export const QUESTION_DIFFICULTIES = ["쉬움", "보통", "어려움", "도전"];
export const TEMPLATE_SHEET_NAME = "문제은행";
export const TEMPLATE_FILE_NAME = "수학팀배틀_문제등록양식.xlsx";

const REQUIRED_HEADERS = ["단원", "난이도", "문제", "정답"];
const MAX_IMPORT_ROWS = 5000;

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\r\n/g, "\n").trim();
}

function normalizeHeader(value) {
  return cleanText(value).replace(/\s+/g, "");
}

export function normalizeQuestionKey(question, answer) {
  const normalize = (value) =>
    cleanText(value)
      .normalize("NFKC")
      .replace(/\s+/g, "")
      .toLowerCase();

  return `${normalize(question)}::${normalize(answer)}`;
}

export function downloadQuestionTemplate() {
  const workbook = XLSX.utils.book_new();

  const questionSheet = XLSX.utils.aoa_to_sheet([
    REQUIRED_HEADERS,
  ]);

  questionSheet["!cols"] = [
    { wch: 20 },
    { wch: 12 },
    { wch: 58 },
    { wch: 34 },
  ];
  questionSheet["!autofilter"] = { ref: "A1:D1" };

  const guideRows = [
    ["수학 팀 배틀 문제 일괄 등록 안내"],
    [],
    ["항목", "내용"],
    ["작성 시트", `'${TEMPLATE_SHEET_NAME}' 시트에 문제를 입력하세요.`],
    ["필수 열", "단원 / 난이도 / 문제 / 정답"],
    ["난이도", QUESTION_DIFFICULTIES.join(" / ")],
    ["수식", "x^2, x_1처럼 입력해도 됩니다. 앱 화면에서 위첨자/아래첨자로 표시됩니다."],
    ["주의", "문제은행 시트의 첫 번째 행(단원·난이도·문제·정답)은 수정하거나 삭제하지 마세요."],
    ["주의", "문제나 정답이 = 기호로 시작하면 Excel이 수식으로 인식할 수 있으니 맨 앞에 작은따옴표(')를 붙여 입력하세요."],
    ["중복", "이미 등록된 문제와 정답이 완전히 같은 행은 자동으로 건너뜁니다."],
    [],
    ["작성 예시"],
    ["단원", "난이도", "문제", "정답"],
    ["이차방정식", "보통", "x^2 - 5x + 6 = 0의 해를 구하시오.", "2, 3"],
    ["제곱근", "쉬움", "sqrt(81)의 값을 구하시오.", "9"],
  ];

  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows);
  guideSheet["!cols"] = [
    { wch: 18 },
    { wch: 78 },
    { wch: 58 },
    { wch: 34 },
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
    throw new Error(`'${TEMPLATE_SHEET_NAME}' 시트를 찾지 못했습니다. 웹앱에서 받은 양식을 사용해주세요.`);
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
    throw new Error(`필수 열이 없습니다: ${missingHeaders.join(", ")}`);
  }

  const dataRows = rows.slice(1).filter((row) =>
    row.some((cell) => cleanText(cell) !== "")
  );

  if (dataRows.length === 0) {
    throw new Error("등록할 문제가 없습니다. 문제은행 시트에 문제를 입력해주세요.");
  }

  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`한 번에 최대 ${MAX_IMPORT_ROWS.toLocaleString()}문제까지 등록할 수 있습니다.`);
  }

  const existingKeys = new Set(
    existingQuestions.map((item) =>
      normalizeQuestionKey(item.question, item.answer)
    )
  );
  const uploadKeys = new Set();

  const analyzedRows = [];
  for (let i = 1; i < rows.length; i += 1) {
    const sourceRow = rows[i] ?? [];
    const hasValue = sourceRow.some((cell) => cleanText(cell) !== "");
    if (!hasValue) continue;


    const unit = cleanText(sourceRow[headerMap.get("단원")]);
    const difficulty = cleanText(sourceRow[headerMap.get("난이도")]);
    const question = cleanText(sourceRow[headerMap.get("문제")]);
    const answer = cleanText(sourceRow[headerMap.get("정답")]);

    const errors = [];

    if (!unit) errors.push("단원이 비어 있습니다.");
    if (!difficulty) errors.push("난이도가 비어 있습니다.");
    if (difficulty && !QUESTION_DIFFICULTIES.includes(difficulty)) {
      errors.push(`난이도는 ${QUESTION_DIFFICULTIES.join(" / ")} 중 하나여야 합니다.`);
    }
    if (!question) errors.push("문제가 비어 있습니다.");
    if (!answer) errors.push("정답이 비어 있습니다.");
    if (unit.length > 100) errors.push("단원은 100자 이하로 입력해주세요.");
    if (question.length > 2000) errors.push("문제는 2,000자 이하로 입력해주세요.");
    if (answer.length > 500) errors.push("정답은 500자 이하로 입력해주세요.");

    const key = normalizeQuestionKey(question, answer);
    let status = "ready";
    let reason = "등록 가능";

    if (errors.length > 0) {
      status = "error";
      reason = errors.join(" ");
    } else if (existingKeys.has(key)) {
      status = "duplicate";
      reason = "이미 문제은행에 같은 문제와 정답이 있습니다.";
    } else if (uploadKeys.has(key)) {
      status = "duplicate";
      reason = "이 Excel 파일 안에 같은 문제와 정답이 중복되어 있습니다.";
    } else {
      uploadKeys.add(key);
    }

    analyzedRows.push({
      excelRow: i + 1,
      unit,
      difficulty,
      question,
      answer,
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
