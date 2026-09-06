import { useMemo, useState } from "react";
import { GoogleGenAI } from "@google/genai";
import MathText from "./MathText";
import { checkAndRecordAiRequest, isClientAiRateLimitError } from "../utils/aiSafety";
import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

const API_KEY_STORAGE = "math-team-battle:gemini-api-key";
const MODEL_STORAGE = "math-team-battle:gemini-model";
const MAX_GENERATE_COUNT = 20;
const DIFFICULTIES = ["쉬움", "보통", "어려움", "도전"];
const MODEL_OPTIONS = [
  { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (권장)" },
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite (이전 버전)" },
];

const QUIZ_MODES = [
  { value: "academic", label: "교과 학습", hint: "수학·과학·사회 등 수업용" },
  { value: "general", label: "상식 퀴즈", hint: "명확한 사실 중심" },
  { value: "nonsense", label: "넌센스 퀴즈", hint: "말장난·수수께끼" },
  { value: "free", label: "자유 주제", hint: "원하는 주제로 자유롭게" },
];

const MODE_TYPE_LABELS = {
  academic: ["계산형", "개념형", "응용형"],
  general: ["사실형", "비교형", "추론형"],
  nonsense: ["말장난", "수수께끼", "언어유희"],
  free: ["기본형", "응용형", "창의형"],
};

const DEFAULT_CATEGORY_OPTIONS = ["공통수학2", "상식퀴즈", "넌센스퀴즈", "한국사", "과학", "영어", "자유퀴즈"];

const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          unit: { type: "string" },
          difficulty: { type: "string", enum: DIFFICULTIES },
          question: { type: "string" },
          choices: {
            type: "array",
            minItems: 4,
            maxItems: 4,
            items: { type: "string" },
          },
          correctOption: { type: "integer" },
          explanation: { type: "string" },
        },
        required: [
          "category",
          "unit",
          "difficulty",
          "question",
          "choices",
          "correctOption",
          "explanation",
        ],
      },
    },
  },
  required: ["questions"],
};

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    reviews: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          valid: { type: "boolean" },
          note: { type: "string" },
        },
        required: ["index", "valid", "note"],
      },
    },
  },
  required: ["reviews"],
};

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function bigrams(value) {
  const clean = normalize(value);
  if (clean.length < 2) return new Set(clean ? [clean] : []);
  const result = new Set();
  for (let index = 0; index < clean.length - 1; index += 1) {
    result.add(clean.slice(index, index + 2));
  }
  return result;
}

function similarity(a, b) {
  const aSet = bigrams(a);
  const bSet = bigrams(b);
  if (!aSet.size || !bSet.size) return 0;
  let intersection = 0;
  aSet.forEach((item) => {
    if (bSet.has(item)) intersection += 1;
  });
  return (2 * intersection) / (aSet.size + bSet.size);
}

function validateQuestion(item) {
  if (!item?.category?.trim()) return "분야/과목이 비어 있습니다.";
  if (!item?.unit?.trim()) return "주제/단원이 비어 있습니다.";
  if (!DIFFICULTIES.includes(item.difficulty)) return "난이도 값이 올바르지 않습니다.";
  if (!item?.question?.trim()) return "문제가 비어 있습니다.";
  if (!Array.isArray(item.choices) || item.choices.length !== 4) return "보기는 정확히 4개여야 합니다.";
  if (item.choices.some((choice) => !String(choice || "").trim())) return "빈 보기가 있습니다.";
  if (new Set(item.choices.map(normalize)).size !== 4) return "서로 같은 보기가 있습니다.";
  const correctOption = Number(item.correctOption);
  if (!Number.isInteger(correctOption) || correctOption < 1 || correctOption > 4) {
    return "정답 번호가 1~4가 아닙니다.";
  }
  return "";
}

function getErrorMessage(error) {
  if (isClientAiRateLimitError(error)) return error.message;
  const message = String(error?.message || "");
  if (/API key|key not valid|invalid.*key/i.test(message)) {
    return "API 키가 올바르지 않거나 사용할 수 없습니다. AI Studio의 키를 확인해주세요.";
  }
  if (/429|quota|resource exhausted/i.test(message)) {
    return "Gemini 무료 사용 한도 또는 요청 속도 제한에 도달했습니다. 잠시 후 다시 시도해주세요.";
  }
  if (/403|permission/i.test(message)) {
    return "이 API 키 또는 Google Cloud 프로젝트에 Gemini 사용 권한이 없습니다.";
  }
  if (/404|not found|model/i.test(message)) {
    return "선택한 Gemini 모델을 사용할 수 없습니다. 다른 Flash-Lite 모델로 바꿔보세요.";
  }
  return "Gemini 요청 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
}

function createLocalQuestion(raw, index, existingQuestions) {
  const item = {
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    category: String(raw?.category || "").trim(),
    unit: String(raw?.unit || "").trim(),
    difficulty: String(raw?.difficulty || "보통").trim(),
    question: String(raw?.question || "").trim(),
    choices: Array.isArray(raw?.choices)
      ? raw.choices.slice(0, 4).map((choice) => String(choice || "").trim())
      : [],
    correctOption: Number(raw?.correctOption || 0),
    explanation: String(raw?.explanation || "").trim(),
    selected: true,
    editing: false,
    review: null,
  };

  item.validationError = validateQuestion(item);

  let duplicateScore = 0;
  let duplicateQuestion = "";
  existingQuestions.forEach((existing) => {
    const score = similarity(item.question, existing.question);
    if (score > duplicateScore) {
      duplicateScore = score;
      duplicateQuestion = existing.question || "";
    }
  });

  item.duplicateScore = duplicateScore;
  item.duplicateQuestion = duplicateQuestion;
  if (duplicateScore >= 0.82 || item.validationError) item.selected = false;
  return item;
}

function AIQuestionGenerator({ db, user, questions, questionUnits, questionCategories = [], onMessage }) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) || "");
  const [rememberKey, setRememberKey] = useState(() => Boolean(localStorage.getItem(API_KEY_STORAGE)));
  const [model, setModel] = useState(() => localStorage.getItem(MODEL_STORAGE) || "gemini-3.5-flash-lite");
  const [connectionState, setConnectionState] = useState("idle");
  const [connectionMessage, setConnectionMessage] = useState("");

  const [quizMode, setQuizMode] = useState("academic");
  const [category, setCategory] = useState("공통수학2");
  const [unit, setUnit] = useState(questionUnits[0] || "도형의 방정식");
  const [difficulty, setDifficulty] = useState("보통");
  const [count, setCount] = useState(10);
  const [types, setTypes] = useState({ first: true, second: true, third: true });
  const [avoidDuplicates, setAvoidDuplicates] = useState(true);

  const [generated, setGenerated] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const selectedCount = useMemo(
    () => generated.filter((item) => item.selected && !item.validationError).length,
    [generated]
  );

  const duplicateCount = useMemo(
    () => generated.filter((item) => item.duplicateScore >= 0.82).length,
    [generated]
  );

  const invalidCount = useMemo(
    () => generated.filter((item) => item.validationError).length,
    [generated]
  );

  const categoryOptions = useMemo(() => {
    return [...new Set([...DEFAULT_CATEGORY_OPTIONS, ...questionCategories])].filter(Boolean);
  }, [questionCategories]);

  const unitOptions = useMemo(() => {
    const matching = questions
      .filter((item) => String(item.category || item.subject || "기존 문제").trim() === category.trim())
      .map((item) => String(item.unit || "").trim())
      .filter(Boolean);
    return [...new Set([...matching, ...questionUnits])].sort((a, b) => a.localeCompare(b, "ko"));
  }, [category, questionUnits, questions]);

  const modeMeta = QUIZ_MODES.find((item) => item.value === quizMode) || QUIZ_MODES[0];
  const typeLabels = MODE_TYPE_LABELS[quizMode] || MODE_TYPE_LABELS.academic;

  const notify = (text) => {
    setStatusMessage(text);
    onMessage?.(text);
  };

  const getClient = () => {
    const cleanKey = apiKey.trim();
    if (!cleanKey) throw new Error("API key missing");
    return new GoogleGenAI({ apiKey: cleanKey });
  };

  const persistSettings = () => {
    localStorage.setItem(MODEL_STORAGE, model);
    if (rememberKey && apiKey.trim()) localStorage.setItem(API_KEY_STORAGE, apiKey.trim());
    else localStorage.removeItem(API_KEY_STORAGE);
  };

  const handleConnectionTest = async () => {
    try {
      setConnectionState("testing");
      setConnectionMessage("");
      setErrorMessage("");
      const ai = getClient();
      const response = await ai.models.generateContent({
        model,
        contents: "연결 테스트입니다. 반드시 OK 두 글자만 답하세요.",
      });
      if (!String(response.text || "").trim()) throw new Error("Empty response");
      persistSettings();
      setConnectionState("success");
      setConnectionMessage("Gemini 연결에 성공했습니다. 이 기기에서 AI 문제 생성을 사용할 수 있어요.");
    } catch (error) {
      console.error("Gemini 연결 테스트 오류:", error);
      setConnectionState("error");
      setConnectionMessage(getErrorMessage(error));
    }
  };

  const clearStoredKey = () => {
    localStorage.removeItem(API_KEY_STORAGE);
    setApiKey("");
    setRememberKey(false);
    setConnectionState("idle");
    setConnectionMessage("이 기기에 저장된 Gemini API 키를 삭제했습니다.");
  };

  const toggleType = (name) => {
    setTypes((current) => ({ ...current, [name]: !current[name] }));
  };

  const buildPrompt = (desiredCount) => {
    const selectedTypes = [
      types.first ? typeLabels[0] : "",
      types.second ? typeLabels[1] : "",
      types.third ? typeLabels[2] : "",
    ].filter(Boolean);

    const sameTopicQuestions = questions
      .filter((item) => {
        const itemCategory = String(item.category || item.subject || "기존 문제").trim();
        return itemCategory === category.trim() && item.unit === unit && item.enabled !== false;
      })
      .slice(0, 40)
      .map((item, index) => `${index + 1}. ${item.question}`)
      .join("\n");

    const modeGuide = {
      academic:
        `교과 학습용 문항입니다. '${category}'의 '${unit}' 범위를 벗어나지 말고, 계산이나 사실 확인이 필요한 경우 직접 다시 검증하세요. 학생이 배우는 수준에 맞는 표현을 사용하세요.`,
      general:
        `상식 퀴즈입니다. 널리 확인 가능한 사실을 바탕으로 하며 정답이 명확히 하나인 문제만 만드세요. 시대에 따라 쉽게 바뀌는 정보나 논쟁적인 사실은 피하세요.`,
      nonsense:
        `한국어 넌센스 퀴즈입니다. 말장난, 수수께끼, 언어유희를 활용하되 억지스럽거나 정답이 여러 개인 문제는 피하세요. 해설에는 왜 그 답이 되는지 짧게 설명하세요.`,
      free:
        `자유 주제 퀴즈입니다. 사용자가 지정한 분야와 주제를 충실히 따르고, 각 문제의 정답은 반드시 하나만 성립하도록 만드세요.`,
    }[quizMode] || "정답이 하나인 4지선다 퀴즈를 만드세요.";

    return `당신은 교실용 4지선다 퀴즈 출제 전문가입니다.\n\n` +
      `퀴즈 성격: ${modeMeta.label}\n분야/과목: ${category}\n주제/단원: ${unit}\n난이도: ${difficulty}\n문제 수: ${desiredCount}\n` +
      `문제 구성: ${selectedTypes.length ? selectedTypes.join(", ") : "골고루"}\n\n` +
      `${modeGuide}\n\n` +
      `다음 공통 규칙을 반드시 지키세요.\n` +
      `1. 각 문제는 보기 4개인 4지선다형입니다.\n` +
      `2. 정답은 반드시 하나만 존재해야 하며 correctOption은 1,2,3,4 중 하나입니다.\n` +
      `3. 보기 네 개는 서로 중복되거나 같은 의미가 아니어야 합니다.\n` +
      `4. 정답과 explanation이 실제 정답과 정확히 일치하는지 출력 전에 다시 확인합니다.\n` +
      `5. 오답 보기는 너무 황당하지 않게, 학습자나 참가자가 실제로 고를 법하게 만듭니다.\n` +
      `6. 문제 문장이나 보기에서 정답을 노골적으로 암시하지 않습니다.\n` +
      `7. 수식이 필요한 경우 제곱은 x^2, 아래첨자는 x_1, 루트는 sqrt(...), 분수는 1/2처럼 작성합니다.\n` +
      `8. explanation은 짧고 이해하기 쉽게 작성합니다.\n` +
      `9. category는 반드시 '${category}', unit은 반드시 '${unit}', difficulty는 반드시 '${difficulty}'로 출력합니다.\n` +
      (avoidDuplicates && sameTopicQuestions
        ? `10. 아래 기존 문제들과 숫자나 표현만 조금 바꾼 수준의 중복 문제는 피하세요.\n[기존 문제]\n${sameTopicQuestions}\n`
        : "") +
      `\n요청한 ${desiredCount}문제를 정확히 생성하세요.`;
  };

  const handleGenerate = async () => {
    if (!apiKey.trim()) {
      setErrorMessage("먼저 Gemini API 키를 입력해주세요.");
      return;
    }
    if (!category.trim()) {
      setErrorMessage("생성할 분야/과목을 입력해주세요.");
      return;
    }
    if (!unit.trim()) {
      setErrorMessage("생성할 주제/단원을 입력해주세요.");
      return;
    }
    const safeCount = Math.max(1, Math.min(MAX_GENERATE_COUNT, Number(count) || 1));
    setCount(safeCount);

    try {
      setGenerating(true);
      setErrorMessage("");
      setGenerated([]);
      persistSettings();
      checkAndRecordAiRequest();
      const ai = getClient();
      const response = await ai.models.generateContent({
        model,
        contents: buildPrompt(safeCount),
        config: {
          responseMimeType: "application/json",
          responseSchema: QUESTION_SCHEMA,
          temperature: 0.7,
        },
      });

      const parsed = JSON.parse(response.text || "{}");
      const rows = Array.isArray(parsed.questions) ? parsed.questions.slice(0, safeCount) : [];
      if (!rows.length) throw new Error("No questions generated");

      const localQuestions = rows.map((item, index) => createLocalQuestion(item, index, questions));

      // 생성 결과 내부 중복도 함께 감지한다.
      localQuestions.forEach((item, index) => {
        for (let compareIndex = 0; compareIndex < index; compareIndex += 1) {
          const score = similarity(item.question, localQuestions[compareIndex].question);
          if (score >= 0.88 && score > item.duplicateScore) {
            item.duplicateScore = score;
            item.duplicateQuestion = localQuestions[compareIndex].question;
            item.selected = false;
          }
        }
      });

      setGenerated(localQuestions);
      notify(`AI가 ${localQuestions.length}개 문제를 생성했습니다. 저장 전에 정답과 해설을 확인해주세요.`);
    } catch (error) {
      console.error("Gemini 문제 생성 오류:", error);
      setErrorMessage(getErrorMessage(error));
    } finally {
      setGenerating(false);
    }
  };

  const toggleSelected = (id) => {
    setGenerated((current) => current.map((item) => (
      item.id === id ? { ...item, selected: !item.selected } : item
    )));
  };

  const setAllSelected = (selected) => {
    setGenerated((current) => current.map((item) => ({
      ...item,
      selected: selected && !item.validationError && item.duplicateScore < 0.82,
    })));
  };

  const toggleEdit = (id) => {
    setGenerated((current) => current.map((item) => (
      item.id === id ? { ...item, editing: !item.editing } : item
    )));
  };

  const updateGenerated = (id, field, value) => {
    setGenerated((current) => current.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, [field]: value };
      next.validationError = validateQuestion(next);
      return next;
    }));
  };

  const updateGeneratedChoice = (id, choiceIndex, value) => {
    setGenerated((current) => current.map((item) => {
      if (item.id !== id) return item;
      const choices = [...item.choices];
      choices[choiceIndex] = value;
      const next = { ...item, choices };
      next.validationError = validateQuestion(next);
      return next;
    }));
  };

  const handleReview = async () => {
    const targets = generated.filter((item) => item.selected && !item.validationError);
    if (!targets.length) {
      setErrorMessage("검수할 문제를 먼저 선택해주세요.");
      return;
    }

    try {
      setReviewing(true);
      setErrorMessage("");
      checkAndRecordAiRequest();
      const ai = getClient();
      const payload = targets.map((item, index) => ({
        index: index + 1,
        question: item.question,
        choices: item.choices,
        correctOption: item.correctOption,
        explanation: item.explanation,
      }));
      const response = await ai.models.generateContent({
        model,
        contents: `다음은 '${modeMeta.label}' 형식의 '${category} / ${unit}' 4지선다 문제입니다. 각 문제를 독립적으로 검토하고 정답번호가 맞는지, 정답이 하나뿐인지, 보기 중복이나 사실·계산·논리 오류가 없는지 검사하세요. 교과 학습이면 계산과 개념을 직접 확인하고, 상식이면 사실의 명확성을, 넌센스면 정답의 납득 가능성과 중의성을 확인하세요. 정상이라면 valid=true와 짧은 확인 문구를, 오류 가능성이 있으면 valid=false와 구체적인 이유를 작성하세요.\n\n${JSON.stringify(payload)}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: REVIEW_SCHEMA,
          temperature: 0.1,
        },
      });
      const parsed = JSON.parse(response.text || "{}");
      const reviews = Array.isArray(parsed.reviews) ? parsed.reviews : [];
      const reviewMap = new Map(reviews.map((review) => [Number(review.index), review]));
      setGenerated((current) => {
        let selectedIndex = 0;
        return current.map((item) => {
          if (!item.selected || item.validationError) return item;
          selectedIndex += 1;
          const review = reviewMap.get(selectedIndex);
          return review ? { ...item, review } : item;
        });
      });
      notify("AI 2차 검수를 완료했습니다. '확인 필요' 문제는 교사가 직접 다시 확인해주세요.");
    } catch (error) {
      console.error("Gemini 문제 검수 오류:", error);
      setErrorMessage(getErrorMessage(error));
    } finally {
      setReviewing(false);
    }
  };

  const handleSaveSelected = async () => {
    const targets = generated.filter((item) => item.selected && !item.validationError);
    if (!targets.length) return;

    try {
      setSaving(true);
      setErrorMessage("");
      const batch = writeBatch(db);
      targets.forEach((item) => {
        const ref = doc(collection(db, "questions"));
        batch.set(ref, {
          type: "multiple-choice",
          schemaVersion: 2,
          question: item.question.trim(),
          choices: item.choices.map((choice) => choice.trim()),
          correctOption: Number(item.correctOption),
          explanation: String(item.explanation || "").trim(),
          category: item.category.trim(),
          unit: item.unit.trim(),
          difficulty: item.difficulty,
          enabled: true,
          source: "gemini-ai",
          aiModel: model,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        });
      });
      await batch.commit();
      setGenerated((current) => current.filter((item) => !targets.some((target) => target.id === item.id)));
      notify(`${targets.length}개 AI 문제를 문제은행에 저장했습니다.`);
    } catch (error) {
      console.error("AI 문제 저장 오류:", error);
      setErrorMessage("선택한 문제를 Firestore에 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="ai-question-studio">
      <div className="ai-studio-intro">
        <div>
          <span className="section-pill peach">AI 문제 생성실</span>
          <h2>AI로 원하는 객관식 퀴즈 만들기</h2>
          <p>
            교과 문제부터 상식·넌센스까지 분야와 주제를 직접 입력하고, 확인한 문제만 문제은행에 저장해요.
          </p>
        </div>
        <div className="ai-studio-warning">
          <strong>교사 검토 필수</strong>
          <span>AI가 만든 문제와 정답은 저장 전에 반드시 직접 확인해주세요.</span>
        </div>
      </div>

      <div className="ai-studio-grid">
        <div className="ai-studio-side">
          <section className="panel ai-key-panel">
            <div className="panel-title compact-title">
              <div>
                <span className="section-pill mint">1. AI 연결</span>
                <h3>Gemini API 키</h3>
              </div>
            </div>

            <div className="ai-provider-box">
              <strong>AI 엔진</strong>
              <div className="ai-provider-grid">
                <button type="button" className="ai-provider-card selected">
                  <span>무료</span>
                  <b>Gemini Flash-Lite</b>
                  <small>현재 사용 가능</small>
                </button>
                <button type="button" className="ai-provider-card locked" disabled>
                  <span>고급</span>
                  <b>OpenAI</b>
                  <small>Blaze 보안 점검 후 활성화</small>
                </button>
              </div>
              <p>OpenAI 유료 키는 브라우저에 저장하지 않습니다. 서버 보안과 비용 제한을 먼저 준비한 뒤 연결해요.</p>
            </div>

            <label>
              API 키
              <input
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setConnectionState("idle");
                }}
                placeholder="AI Studio에서 만든 키를 입력하세요"
                autoComplete="off"
              />
            </label>

            <label>
              사용할 모델
              <select
                value={model}
                onChange={(event) => {
                  setModel(event.target.value);
                  setConnectionState("idle");
                }}
              >
                {MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="soft-check ai-remember-key">
              <input
                type="checkbox"
                checked={rememberKey}
                onChange={(event) => setRememberKey(event.target.checked)}
              />
              <span />
              이 관리자 기기에 API 키 기억하기
            </label>

            <div className="ai-key-actions">
              <button
                type="button"
                className="primary-button"
                onClick={handleConnectionTest}
                disabled={connectionState === "testing" || !apiKey.trim()}
              >
                {connectionState === "testing" ? "확인 중..." : "연결 테스트"}
              </button>
              <button type="button" className="secondary-button" onClick={clearStoredKey}>
                키 삭제
              </button>
            </div>

            {connectionMessage && (
              <div className={`ai-connection-message ${connectionState}`}>
                {connectionMessage}
              </div>
            )}

            <p className="ai-key-note">
              키는 Firebase 문제 데이터에는 저장하지 않아요. '기억하기'를 켜면 이 브라우저의 로컬 저장소에만 저장됩니다.
            </p>
            <p className="ai-key-note ai-local-limit-note">
              연속 클릭 보호: 문제 생성·AI 검수 요청은 이 브라우저에서 분당 5회, 하루 60회로 제한합니다. 이 제한은 실수 방지용이며 서버 보안 한도는 아닙니다.
            </p>
          </section>

          <section className="panel ai-settings-panel">
            <div className="panel-title compact-title">
              <div>
                <span className="section-pill lavender">2. 생성 조건</span>
                <h3>어떤 문제를 만들까요?</h3>
              </div>
            </div>

            <div className="ai-mode-box">
              <strong>퀴즈 성격</strong>
              <div className="ai-mode-grid">
                {QUIZ_MODES.map((item) => (
                  <button
                    type="button"
                    key={item.value}
                    className={quizMode === item.value ? "selected" : ""}
                    onClick={() => setQuizMode(item.value)}
                  >
                    <b>{item.label}</b>
                    <span>{item.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <label>
              분야 / 과목 <span className="ai-direct-input-hint">직접 입력 가능</span>
              <input
                list="ai-category-options"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="예: 공통수학2, 상식퀴즈, 넌센스퀴즈"
              />
              <datalist id="ai-category-options">
                {categoryOptions.map((item) => <option key={item} value={item} />)}
              </datalist>
            </label>

            <label>
              주제 / 단원 <span className="ai-direct-input-hint">새 주제도 바로 입력</span>
              <input
                list="ai-unit-options"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                placeholder="예: 원의 방정식, 세계 상식, 말장난"
              />
              <datalist id="ai-unit-options">
                {unitOptions.map((item) => <option key={item} value={item} />)}
              </datalist>
            </label>

            <div className="form-row">
              <label>
                난이도
                <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
                  {DIFFICULTIES.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>
                문제 수
                <input
                  type="number"
                  min="1"
                  max={MAX_GENERATE_COUNT}
                  value={count}
                  onChange={(event) => setCount(event.target.value)}
                />
              </label>
            </div>

            <div className="ai-type-box">
              <strong>문제 구성</strong>
              <div className="ai-type-checks">
                {["first", "second", "third"].map((key, index) => (
                  <label className="soft-check" key={key}>
                    <input type="checkbox" checked={types[key]} onChange={() => toggleType(key)} />
                    <span /> {typeLabels[index]}
                  </label>
                ))}
              </div>
            </div>

            <label className="soft-check ai-avoid-duplicates">
              <input type="checkbox" checked={avoidDuplicates} onChange={(event) => setAvoidDuplicates(event.target.checked)} />
              <span /> 기존 문제와 비슷한 문제 최대한 피하기
            </label>

            <button
              type="button"
              className="primary-button ai-generate-button"
              onClick={handleGenerate}
              disabled={generating || !apiKey.trim()}
            >
              {generating ? "AI가 문제를 만들고 있어요..." : `${Math.min(MAX_GENERATE_COUNT, Number(count) || 1)}문제 생성하기`}
            </button>
          </section>
        </div>

        <section className="panel ai-results-panel">
          <div className="panel-title list-panel-title">
            <div>
              <span className="section-pill sky">3. 검토 후 저장</span>
              <h2>AI 생성 결과</h2>
              <p className="panel-description">문제와 정답을 확인하고 필요한 문제만 선택하세요.</p>
            </div>
            <span className="round-count">{generated.length}</span>
          </div>

          {errorMessage && <div className="error-message ai-error-message">{errorMessage}</div>}
          {statusMessage && <div className="status-message ai-status-message">{statusMessage}</div>}

          {generated.length === 0 ? (
            <div className="empty-state ai-empty-state">
              <div className="empty-illustration">AI</div>
              <strong>아직 생성한 문제가 없어요.</strong>
              <p>왼쪽에서 조건을 정하고 문제 생성을 눌러보세요.</p>
            </div>
          ) : (
            <>
              <div className="ai-result-summary">
                <div><strong>{generated.length}</strong><span>생성</span></div>
                <div><strong>{selectedCount}</strong><span>선택</span></div>
                <div className={duplicateCount ? "warn" : ""}><strong>{duplicateCount}</strong><span>중복 의심</span></div>
                <div className={invalidCount ? "warn" : ""}><strong>{invalidCount}</strong><span>형식 오류</span></div>
              </div>

              <div className="ai-result-toolbar">
                <div>
                  <button type="button" onClick={() => setAllSelected(true)}>정상 문제 전체 선택</button>
                  <button type="button" onClick={() => setAllSelected(false)}>전체 해제</button>
                </div>
                <div>
                  <button type="button" className="ai-review-button" onClick={handleReview} disabled={reviewing || selectedCount === 0}>
                    {reviewing ? "AI 검수 중..." : "AI로 2차 검수"}
                  </button>
                  <button type="button" className="primary-button" onClick={handleSaveSelected} disabled={saving || selectedCount === 0}>
                    {saving ? "저장 중..." : `선택 ${selectedCount}개 문제은행에 저장`}
                  </button>
                </div>
              </div>

              <div className="ai-question-list">
                {generated.map((item, index) => (
                  <article
                    className={`ai-question-card ${item.selected ? "selected" : ""} ${item.validationError ? "invalid" : ""}`}
                    key={item.id}
                  >
                    <div className="ai-question-card-head">
                      <label className="soft-check ai-question-select">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() => toggleSelected(item.id)}
                          disabled={Boolean(item.validationError)}
                        />
                        <span />
                      </label>
                      <div className="ai-question-index">{index + 1}</div>
                      <div className="ai-question-badges">
                        <span>{item.category}</span>
                        <span>{item.unit}</span>
                        <span className={`difficulty-tag difficulty-${item.difficulty}`}>{item.difficulty}</span>
                        {item.duplicateScore >= 0.82 && <span className="ai-warning-badge">중복 의심</span>}
                        {item.validationError && <span className="ai-error-badge">형식 오류</span>}
                        {item.review && (
                          <span className={item.review.valid ? "ai-review-ok" : "ai-review-warning"}>
                            {item.review.valid ? "AI 검수 정상" : "AI 확인 필요"}
                          </span>
                        )}
                      </div>
                      <button type="button" className="edit-question-button" onClick={() => toggleEdit(item.id)}>
                        {item.editing ? "편집 닫기" : "수정"}
                      </button>
                    </div>

                    {!item.editing ? (
                      <>
                        <div className="ai-question-text"><MathText text={item.question} /></div>
                        <div className="ai-choice-grid">
                          {item.choices.map((choice, choiceIndex) => (
                            <div className={item.correctOption === choiceIndex + 1 ? "correct" : ""} key={`${item.id}-${choiceIndex}`}>
                              <b>{choiceIndex + 1}</b>
                              <span><MathText text={choice} /></span>
                            </div>
                          ))}
                        </div>
                        <div className="ai-explanation"><strong>해설</strong><span><MathText text={item.explanation || "해설 없음"} /></span></div>
                      </>
                    ) : (
                      <div className="ai-inline-editor">
                        <div className="form-row">
                          <label>분야/과목<input value={item.category} onChange={(event) => updateGenerated(item.id, "category", event.target.value)} /></label>
                          <label>주제/단원<input value={item.unit} onChange={(event) => updateGenerated(item.id, "unit", event.target.value)} /></label>
                        </div>
                        <label>난이도<select value={item.difficulty} onChange={(event) => updateGenerated(item.id, "difficulty", event.target.value)}>{DIFFICULTIES.map((level) => <option key={level}>{level}</option>)}</select></label>
                        <label>문제<textarea rows={3} value={item.question} onChange={(event) => updateGenerated(item.id, "question", event.target.value)} /></label>
                        <div className="ai-inline-choices">
                          {item.choices.map((choice, choiceIndex) => (
                            <label key={`${item.id}-edit-${choiceIndex}`}>
                              보기 {choiceIndex + 1}
                              <input value={choice} onChange={(event) => updateGeneratedChoice(item.id, choiceIndex, event.target.value)} />
                              <span className="correct-choice-selector">
                                <input
                                  type="radio"
                                  name={`ai-answer-${item.id}`}
                                  checked={item.correctOption === choiceIndex + 1}
                                  onChange={() => updateGenerated(item.id, "correctOption", choiceIndex + 1)}
                                /> 정답
                              </span>
                            </label>
                          ))}
                        </div>
                        <label>해설<textarea rows={2} value={item.explanation} onChange={(event) => updateGenerated(item.id, "explanation", event.target.value)} /></label>
                      </div>
                    )}

                    {item.validationError && <div className="ai-card-warning">{item.validationError}</div>}
                    {item.duplicateScore >= 0.82 && (
                      <div className="ai-card-warning">
                        기존 문제와 매우 비슷할 수 있어 기본 선택에서 제외했습니다.
                        {item.duplicateQuestion && <small>비슷한 문제: <MathText text={item.duplicateQuestion} /></small>}
                      </div>
                    )}
                    {item.review && (
                      <div className={`ai-review-note ${item.review.valid ? "ok" : "warn"}`}>
                        <strong>{item.review.valid ? "AI 2차 검수" : "확인 필요"}</strong>
                        <span><MathText text={item.review.note} /></span>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

export default AIQuestionGenerator;
