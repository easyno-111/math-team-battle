import { useMemo, useState } from "react";
import { GoogleGenAI } from "@google/genai";
import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

import MathText from "./MathText";
import { checkAndRecordAiRequest, isClientAiRateLimitError } from "../utils/aiSafety";

const API_KEY_STORAGE = "math-team-battle:gemini-api-key";
const MODEL_STORAGE = "math-team-battle:gemini-model";
const MAX_SOURCE_COUNT = 10;
const MAX_TOTAL_VARIANTS = 20;
const DIFFICULTIES = ["쉬움", "보통", "어려움", "도전"];

const VARIANT_TYPES = [
  {
    value: "surface",
    label: "조건만 바꾸기",
    hint: "숫자·조건·소재를 바꾸고 핵심 개념은 유지",
    guide:
      "원본과 같은 핵심 개념과 풀이 구조를 유지하되 숫자, 조건, 소재, 고유명사 같은 표면 요소를 바꾸세요. 수학 문제는 바뀐 값으로 반드시 다시 계산하세요.",
  },
  {
    value: "same-concept",
    label: "같은 개념 새 문제",
    hint: "겉모습은 다르게, 같은 학습 목표",
    guide:
      "원본과 같은 핵심 개념이나 지식을 묻되 문제 문장과 조건 구성을 충분히 다르게 만드세요. 단순히 단어 몇 개나 숫자만 교체한 복제 문제는 피하세요.",
  },
  {
    value: "easier",
    label: "조금 더 쉽게",
    hint: "핵심은 유지하고 계산·추론 단계를 줄임",
    guide:
      "원본과 같은 핵심 개념을 유지하면서 계산 단계, 조건 수, 추론 부담을 줄여 한 단계 쉬운 문제로 만드세요. 너무 단순해서 개념을 묻지 못하는 문제는 피하세요.",
  },
  {
    value: "harder",
    label: "조금 더 어렵게",
    hint: "범위는 유지하고 한 단계 더 생각하게",
    guide:
      "원본의 범위를 벗어나지 않으면서 조건을 하나 더 결합하거나 추론 단계를 늘려 한 단계 어려운 문제로 만드세요. 불필요하게 계산량만 크게 늘리지는 마세요.",
  },
  {
    value: "applied",
    label: "응용문제로 변형",
    hint: "실생활·상황형 문맥을 더함",
    guide:
      "원본의 핵심 개념이나 지식을 실제 상황, 이야기, 자료 해석 같은 문맥에 적용하는 문제로 바꾸세요. 정답은 여전히 하나만 명확하게 존재해야 합니다.",
  },
];

const VARIANT_SCHEMA = {
  type: "object",
  properties: {
    variants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          parentIndex: { type: "integer" },
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
          "parentIndex",
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
  required: ["variants"],
};

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function getCategory(item) {
  return String(item?.category || item?.subject || "기존 문제").trim() || "기존 문제";
}

function getUnit(item) {
  return String(item?.unit || "주제 미지정").trim() || "주제 미지정";
}

function getErrorMessage(error) {
  if (isClientAiRateLimitError(error)) return error.message;
  const message = String(error?.message || "");
  if (/API key|key not valid|invalid.*key/i.test(message)) {
    return "Gemini API 키를 찾을 수 없거나 사용할 수 없습니다. AI 문제 만들기 화면에서 연결 상태를 확인해주세요.";
  }
  if (/429|quota|resource exhausted/i.test(message)) {
    return "Gemini 무료 사용 한도 또는 요청 속도 제한에 도달했습니다. 잠시 후 다시 시도해주세요.";
  }
  if (/403|permission/i.test(message)) {
    return "이 API 키 또는 Google Cloud 프로젝트에 Gemini 사용 권한이 없습니다.";
  }
  if (/404|not found|model/i.test(message)) {
    return "저장된 Gemini 모델을 사용할 수 없습니다. AI 문제 만들기 화면에서 모델을 다시 선택해주세요.";
  }
  return "유사문제 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
}

function validateVariant(item, parent, allQuestions, generatedSoFar) {
  if (!item.question) return "문제가 비어 있습니다.";
  if (!Array.isArray(item.choices) || item.choices.length !== 4) return "보기는 정확히 4개여야 합니다.";
  if (item.choices.some((choice) => !String(choice || "").trim())) return "빈 보기가 있습니다.";
  if (new Set(item.choices.map(normalize)).size !== 4) return "서로 같은 보기가 있습니다.";
  const correct = Number(item.correctOption);
  if (!Number.isInteger(correct) || correct < 1 || correct > 4) return "정답 번호가 1~4가 아닙니다.";
  if (normalize(item.question) === normalize(parent?.question)) return "원본 문제와 문장이 사실상 같습니다.";

  const sameExisting = allQuestions.some((question) => normalize(question.question) === normalize(item.question));
  if (sameExisting) return "문제은행에 완전히 같은 문제가 이미 있습니다.";

  const sameGenerated = generatedSoFar.some((question) => normalize(question.question) === normalize(item.question));
  if (sameGenerated) return "이번 생성 결과 안에 같은 문제가 중복되었습니다.";

  return "";
}

function SimilarQuestionGenerator({
  db,
  user,
  sourceQuestions,
  allQuestions,
  onClose,
  onMessage,
}) {
  const apiKey = localStorage.getItem(API_KEY_STORAGE) || "";
  const model = localStorage.getItem(MODEL_STORAGE) || "gemini-3.5-flash-lite";
  const [variantType, setVariantType] = useState("same-concept");
  const [perSourceCount, setPerSourceCount] = useState(1);
  const [generated, setGenerated] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const sources = useMemo(() => sourceQuestions.slice(0, MAX_SOURCE_COUNT), [sourceQuestions]);
  const selectedCount = generated.filter((item) => item.selected && !item.validationError).length;
  const maxPerSource = Math.max(1, Math.min(3, Math.floor(MAX_TOTAL_VARIANTS / Math.max(1, sources.length))));
  const safePerSourceCount = Math.max(1, Math.min(maxPerSource, Number(perSourceCount) || 1));
  const totalRequested = Math.min(MAX_TOTAL_VARIANTS, sources.length * safePerSourceCount);
  const variantMeta = VARIANT_TYPES.find((item) => item.value === variantType) || VARIANT_TYPES[1];

  const buildPrompt = () => {
    const sourcePayload = sources.map((item, index) => ({
      parentIndex: index + 1,
      category: getCategory(item),
      unit: getUnit(item),
      difficulty: item.difficulty || "보통",
      question: item.question,
      choices: item.choices,
      correctOption: item.correctOption,
      explanation: item.explanation || "",
    }));

    return `당신은 교실용 4지선다 유사문제 출제 전문가입니다.\n\n` +
      `변형 방식: ${variantMeta.label}\n` +
      `원본 문제마다 ${safePerSourceCount}개씩, 총 ${totalRequested}개를 만드세요.\n` +
      `${variantMeta.guide}\n\n` +
      `반드시 지킬 규칙:\n` +
      `1. 각 결과에는 어떤 원본에서 파생되었는지 parentIndex를 정확히 넣으세요.\n` +
      `2. 원본의 category와 unit은 그대로 유지하세요.\n` +
      `3. 보기 4개와 정답 하나만 존재하는 객관식 문제여야 합니다.\n` +
      `4. 새 문제를 직접 다시 풀거나 사실을 확인해서 correctOption과 explanation이 실제 정답과 맞는지 검증하세요.\n` +
      `5. 보기 네 개는 서로 중복되거나 같은 의미·동치값이면 안 됩니다.\n` +
      `6. 원본 문제 문장, 숫자, 보기, 정답을 그대로 복사한 문제는 만들지 마세요.\n` +
      `7. 같은 원본에서 여러 문제를 만들 때 서로도 충분히 다르게 만드세요.\n` +
      `8. 수식은 제곱 x^2, 아래첨자 x_1, 루트 sqrt(...), 분수 1/2 형식으로 작성하세요.\n` +
      `9. 해설은 짧고 명확하게 작성하세요.\n` +
      `10. easier는 필요하면 난이도를 한 단계 낮추고, harder는 한 단계 높일 수 있지만 범위는 바꾸지 마세요. 다른 변형은 원본 난이도를 유지하세요.\n\n` +
      `[원본 문제 JSON]\n${JSON.stringify(sourcePayload)}\n\n` +
      `요청한 총 ${totalRequested}개의 유사문제를 정확히 반환하세요.`;
  };

  const handleGenerate = async () => {
    if (!apiKey.trim()) {
      setErrorMessage("Gemini API 키가 없습니다. 먼저 'AI 문제 만들기'에서 Gemini 연결을 완료해주세요.");
      return;
    }
    if (!sources.length) return;

    try {
      setGenerating(true);
      setErrorMessage("");
      setGenerated([]);
      checkAndRecordAiRequest();

      const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
      const response = await ai.models.generateContent({
        model,
        contents: buildPrompt(),
        config: {
          responseMimeType: "application/json",
          responseSchema: VARIANT_SCHEMA,
          temperature: variantType === "surface" ? 0.45 : 0.7,
        },
      });

      const parsed = JSON.parse(response.text || "{}");
      const rows = Array.isArray(parsed.variants) ? parsed.variants.slice(0, totalRequested) : [];
      if (!rows.length) throw new Error("No variants generated");

      const local = [];
      rows.forEach((raw, index) => {
        const parentIndex = Math.max(1, Math.min(sources.length, Number(raw.parentIndex) || 1));
        const parent = sources[parentIndex - 1];
        const item = {
          id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          parentIndex,
          parentQuestionId: parent.id,
          parentQuestion: parent.question,
          category: getCategory(parent),
          unit: getUnit(parent),
          difficulty: DIFFICULTIES.includes(raw.difficulty) ? raw.difficulty : (parent.difficulty || "보통"),
          question: String(raw.question || "").trim(),
          choices: Array.isArray(raw.choices) ? raw.choices.slice(0, 4).map((choice) => String(choice || "").trim()) : [],
          correctOption: Number(raw.correctOption || 0),
          explanation: String(raw.explanation || "").trim(),
          selected: true,
        };
        item.validationError = validateVariant(item, parent, allQuestions, local);
        if (item.validationError) item.selected = false;
        local.push(item);
      });

      setGenerated(local);
      onMessage?.(`원본 ${sources.length}개에서 유사문제 ${local.length}개를 생성했습니다. 저장 전에 정답을 확인해주세요.`);
    } catch (error) {
      console.error("유사문제 생성 오류:", error);
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

  const handleSave = async () => {
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
          question: item.question,
          choices: item.choices,
          correctOption: Number(item.correctOption),
          explanation: item.explanation,
          category: item.category,
          unit: item.unit,
          difficulty: item.difficulty,
          enabled: true,
          source: "gemini-variant",
          aiProvider: "gemini",
          aiModel: model,
          parentQuestionId: item.parentQuestionId,
          variantType,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        });
      });
      await batch.commit();
      setGenerated((current) => current.filter((item) => !targets.some((target) => target.id === item.id)));
      onMessage?.(`${targets.length}개 유사문제를 문제은행에 저장했습니다.`);
    } catch (error) {
      console.error("유사문제 저장 오류:", error);
      setErrorMessage("유사문제를 Firestore에 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="variant-overlay" role="presentation" onMouseDown={onClose}>
      <section className="variant-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header className="variant-dialog-header">
          <div>
            <span className="section-pill lavender">유사문제 생성</span>
            <h2>{sources.length === 1 ? "이 문제에서 유사문제 만들기" : `선택한 ${sources.length}개 문제 일괄 변형`}</h2>
            <p>원본 문제의 핵심은 유지하고, AI가 새 보기·정답·해설을 다시 검증해서 만듭니다.</p>
          </div>
          <button type="button" className="variant-close-button" onClick={onClose}>닫기</button>
        </header>

        {sourceQuestions.length > MAX_SOURCE_COUNT && (
          <div className="variant-warning-banner">한 번에 최대 {MAX_SOURCE_COUNT}개 원본만 처리합니다. 앞의 {MAX_SOURCE_COUNT}개만 가져왔어요.</div>
        )}

        <div className="variant-config-grid">
          <section className="variant-config-card">
            <div className="variant-config-heading">
              <span>1</span>
              <div><strong>AI 엔진</strong><small>현재는 무료 Gemini 사용</small></div>
            </div>
            <div className="ai-provider-grid variant-provider-grid">
              <button type="button" className="ai-provider-card selected">
                <span>무료</span>
                <b>Gemini Flash-Lite</b>
                <small>현재 연결된 키 사용</small>
              </button>
              <button type="button" className="ai-provider-card locked" disabled>
                <span>고급</span>
                <b>OpenAI</b>
                <small>보안 준비 후 활성화</small>
              </button>
            </div>
          </section>

          <section className="variant-config-card variant-type-card">
            <div className="variant-config-heading">
              <span>2</span>
              <div><strong>어떻게 바꿀까요?</strong><small>{variantMeta.hint}</small></div>
            </div>
            <div className="variant-type-grid">
              {VARIANT_TYPES.map((item) => (
                <button
                  type="button"
                  key={item.value}
                  className={variantType === item.value ? "selected" : ""}
                  onClick={() => setVariantType(item.value)}
                >
                  <b>{item.label}</b>
                  <small>{item.hint}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="variant-config-card variant-count-config">
            <div className="variant-config-heading">
              <span>3</span>
              <div><strong>몇 개 만들까요?</strong><small>한 번에 최대 {MAX_TOTAL_VARIANTS}문제</small></div>
            </div>
            <div className="variant-count-chips">
              {Array.from({ length: maxPerSource }, (_, index) => index + 1).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={safePerSourceCount === value ? "selected" : ""}
                  onClick={() => setPerSourceCount(value)}
                >
                  원본당 {value}개
                </button>
              ))}
            </div>
            <div className="variant-count-card">
              <span>원본 {sources.length}개</span>
              <strong>총 {totalRequested}문제 생성</strong>
            </div>
            <button type="button" className="primary-button variant-generate-button" onClick={handleGenerate} disabled={generating}>
              {generating ? "유사문제를 만들고 있어요..." : `${totalRequested}개 유사문제 만들기`}
            </button>
          </section>
        </div>

        <div className="variant-safety-note compact">
          <strong>연속 클릭 보호</strong>
          <span>이 브라우저에서 AI 요청을 분당 5회·하루 60회로 제한합니다. 생성된 문제는 자동 저장되지 않아요.</span>
        </div>

        <section className="variant-source-section">
          <div className="variant-section-title">
            <div>
              <strong>원본 문제</strong>
              <small>어떤 문제를 기준으로 변형하는지 먼저 확인하세요.</small>
            </div>
            <span>{sources.length}개</span>
          </div>
          <div className="variant-source-list">
            {sources.map((item, index) => (
              <article key={item.id}>
                <b>{index + 1}</b>
                <div>
                  <small>{getCategory(item)} · {getUnit(item)} · {item.difficulty || "보통"}</small>
                  <MathText text={item.question} />
                </div>
              </article>
            ))}
          </div>
        </section>

        {errorMessage && <div className="error-message variant-error">{errorMessage}</div>}

        <section className="variant-result-section">
          <div className="variant-section-title variant-result-title">
            <div>
              <strong>생성 결과</strong>
              <small>정답과 해설을 직접 확인한 뒤 필요한 문제만 저장하세요.</small>
            </div>
            {generated.length > 0 && (
              <div className="variant-result-actions">
                <span>{selectedCount}개 선택</span>
                <button type="button" className="primary-button" onClick={handleSave} disabled={saving || selectedCount === 0}>
                  {saving ? "저장 중..." : "선택 문제 저장"}
                </button>
              </div>
            )}
          </div>

          {generated.length === 0 ? (
            <div className="variant-empty">
              <div className="empty-illustration">AI</div>
              <strong>아직 만든 유사문제가 없어요.</strong>
              <p>위에서 변형 방식과 생성 수를 고른 뒤 생성 버튼을 눌러보세요.</p>
            </div>
          ) : (
            <div className="variant-result-list">
              {generated.map((item, index) => (
                <article className={`ai-question-card variant-result-card ${item.selected ? "selected" : ""} ${item.validationError ? "invalid" : ""}`} key={item.id}>
                  <div className="ai-question-card-head variant-result-head">
                    <label className="soft-check ai-question-select">
                      <input type="checkbox" checked={item.selected} disabled={Boolean(item.validationError)} onChange={() => toggleSelected(item.id)} />
                      <span />
                    </label>
                    <b className="ai-question-index">{index + 1}</b>
                    <div className="ai-question-badges">
                      <span>원본 {item.parentIndex}</span>
                      <span>{item.category}</span>
                      <span>{item.unit}</span>
                      <span className={`difficulty-tag difficulty-${item.difficulty}`}>{item.difficulty}</span>
                    </div>
                  </div>

                  <div className="ai-question-text"><MathText text={item.question} /></div>
                  <div className="ai-choice-grid variant-choice-grid">
                    {item.choices.map((choice, choiceIndex) => (
                      <div className={item.correctOption === choiceIndex + 1 ? "correct" : ""} key={`${item.id}-${choiceIndex}`}>
                        <b>{choiceIndex + 1}</b>
                        <span><MathText text={choice} /></span>
                      </div>
                    ))}
                  </div>
                  <div className="ai-explanation"><strong>해설</strong><span><MathText text={item.explanation || "해설 없음"} /></span></div>
                  {item.validationError && <div className="ai-card-warning">{item.validationError}</div>}
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

export default SimilarQuestionGenerator;
