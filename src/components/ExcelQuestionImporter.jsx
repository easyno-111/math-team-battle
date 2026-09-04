import { useRef, useState } from "react";
import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import {
  downloadQuestionTemplate,
  parseQuestionWorkbook,
} from "../utils/questionExcel";

const PREVIEW_LIMIT = 100;
const BATCH_SIZE = 400;

function makeBatchId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function StatusBadge({ status }) {
  if (status === "ready") {
    return <span className="import-status ready">등록 가능</span>;
  }

  if (status === "duplicate") {
    return <span className="import-status duplicate">중복 제외</span>;
  }

  return <span className="import-status error">수정 필요</span>;
}

export default function ExcelQuestionImporter({ user, questions }) {
  const inputRef = useRef(null);
  const [analysis, setAnalysis] = useState(null);
  const [fileName, setFileName] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");

  const resetFileInput = () => {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const clearAnalysis = () => {
    setAnalysis(null);
    setFileName("");
    setMessage("");
    resetFileInput();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setAnalyzing(true);
      setMessage("");
      setAnalysis(null);
      setFileName(file.name);

      const result = await parseQuestionWorkbook(file, questions);
      setAnalysis(result);

      if (result.errors > 0) {
        setMessageType("error");
        setMessage(
          `수정이 필요한 행이 ${result.errors}개 있습니다. 엑셀 파일을 수정한 뒤 다시 올려주세요.`
        );
      } else if (result.ready === 0 && result.duplicates > 0) {
        setMessageType("warning");
        setMessage("모든 문제가 이미 등록되어 있어 새로 추가할 문제가 없습니다.");
      } else {
        setMessageType("success");
        setMessage(
          `${result.ready}개 문제를 등록할 준비가 되었습니다.${
            result.duplicates > 0
              ? ` 중복 ${result.duplicates}개는 자동으로 제외됩니다.`
              : ""
          }`
        );
      }
    } catch (error) {
      console.error("Excel 분석 오류:", error);
      setAnalysis(null);
      setMessageType("error");
      setMessage(error.message || "엑셀 파일을 분석하지 못했습니다.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleImport = async () => {
    if (!analysis || analysis.errors > 0 || analysis.readyRows.length === 0) {
      return;
    }

    const ok = window.confirm(
      `${analysis.readyRows.length}개 문제를 문제은행에 등록할까요?\n중복 ${analysis.duplicates}개는 등록하지 않습니다.`
    );

    if (!ok) return;

    try {
      setImporting(true);
      setMessageType("info");
      setMessage("문제를 등록하고 있습니다...");

      const importBatchId = makeBatchId();
      let completed = 0;

      for (let start = 0; start < analysis.readyRows.length; start += BATCH_SIZE) {
        const chunk = analysis.readyRows.slice(start, start + BATCH_SIZE);
        const batch = writeBatch(db);

        chunk.forEach((row) => {
          const questionRef = doc(collection(db, "questions"));

          batch.set(questionRef, {
            question: row.question,
            answer: row.answer,
            unit: row.unit,
            difficulty: row.difficulty,
            enabled: true,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            source: "excel",
            importBatchId,
            importedFileName: analysis.fileName,
          });
        });

        await batch.commit();
        completed += chunk.length;
        setMessage(`등록 중... ${completed} / ${analysis.readyRows.length}`);
      }

      setMessageType("success");
      setMessage(`${analysis.readyRows.length}개 문제가 정상적으로 등록되었습니다.`);
      setAnalysis(null);
      setFileName("");
      resetFileInput();
    } catch (error) {
      console.error("Excel 일괄 등록 오류:", error);
      setMessageType("error");

      if (error.code === "permission-denied") {
        setMessage("등록 권한이 없습니다. Firestore 관리자 권한을 확인해주세요.");
      } else {
        setMessage("일괄 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      }
    } finally {
      setImporting(false);
    }
  };

  const previewRows = analysis?.rows.slice(0, PREVIEW_LIMIT) ?? [];

  return (
    <section className="panel bulk-import-panel">
      <div className="panel-title bulk-title">
        <div>
          <span className="section-pill peach">여러 문제 한 번에</span>
          <h2>엑셀로 문제 넣기</h2>
          <p className="panel-description">
            전용 양식에 문제를 적어 올리면, 저장 전에 오류와 중복을 먼저 확인해드려요.
          </p>
        </div>

        <button
          type="button"
          className="template-button"
          onClick={downloadQuestionTemplate}
        >
          엑셀 양식 받기
        </button>
      </div>

      <div className="bulk-workflow">
        <div className="workflow-step lavender-step">
          <span className="workflow-number">1</span>
          <div>
            <strong>양식 받기</strong>
            <p>단원 · 난이도 · 문제 · 정답이 들어 있는 전용 양식을 받아요.</p>
          </div>
        </div>
        <div className="workflow-step mint-step">
          <span className="workflow-number">2</span>
          <div>
            <strong>문제 채우기</strong>
            <p>엑셀에서 필요한 문제를 원하는 만큼 작성해요.</p>
          </div>
        </div>
        <div className="workflow-step peach-step">
          <span className="workflow-number">3</span>
          <div>
            <strong>올리고 확인하기</strong>
            <p>오류와 중복을 확인한 뒤 한 번에 문제은행에 저장해요.</p>
          </div>
        </div>
      </div>

      <div className="upload-zone">
        <div className="upload-copy">
          <strong>작성한 엑셀 파일을 선택해주세요.</strong>
          <span>.xlsx · 최대 10MB · 최대 5,000문제</span>
          {fileName && <em>{fileName}</em>}
        </div>

        <div className="upload-actions">
          <input
            ref={inputRef}
            className="file-input"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFileChange}
            disabled={analyzing || importing}
          />

          {analysis && (
            <button
              type="button"
              className="secondary-button"
              onClick={clearAnalysis}
              disabled={importing}
            >
              다른 파일 선택
            </button>
          )}
        </div>
      </div>

      {analyzing && (
        <div className="excel-processing">
          <span className="mini-spinner" />
          엑셀 파일을 확인하고 있어요...
        </div>
      )}

      {message && !analyzing && (
        <div className={`excel-message ${messageType}`}>{message}</div>
      )}

      {analysis && !analyzing && (
        <>
          <div className="analysis-summary">
            <div className="summary-card">
              <span>전체</span>
              <strong>{analysis.total}</strong>
            </div>
            <div className="summary-card success">
              <span>등록 가능</span>
              <strong>{analysis.ready}</strong>
            </div>
            <div className="summary-card duplicate">
              <span>중복 제외</span>
              <strong>{analysis.duplicates}</strong>
            </div>
            <div className="summary-card error">
              <span>수정 필요</span>
              <strong>{analysis.errors}</strong>
            </div>
          </div>

          {analysis.errorRows.length > 0 && (
            <div className="error-row-list">
              <strong>수정이 필요한 행</strong>
              {analysis.errorRows.slice(0, 20).map((row) => (
                <div key={`error-${row.excelRow}`}>
                  <span>{row.excelRow}행</span>
                  <p>{row.reason}</p>
                </div>
              ))}
              {analysis.errorRows.length > 20 && (
                <small>외 {analysis.errorRows.length - 20}개 오류가 더 있습니다.</small>
              )}
            </div>
          )}

          <div className="excel-preview-header">
            <div>
              <strong>올릴 문제 미리보기</strong>
              <span>
                {analysis.total > PREVIEW_LIMIT
                  ? `앞의 ${PREVIEW_LIMIT}개 행만 보여드려요.`
                  : `${analysis.total}개 행을 보여드려요.`}
              </span>
            </div>

            <button
              type="button"
              className="primary-button import-button"
              onClick={handleImport}
              disabled={
                importing ||
                analysis.errors > 0 ||
                analysis.readyRows.length === 0
              }
            >
              {importing ? "등록 중..." : `${analysis.readyRows.length}문제 등록하기`}
            </button>
          </div>

          <div className="excel-table-wrap">
            <table className="excel-preview-table">
              <thead>
                <tr>
                  <th>행</th>
                  <th>상태</th>
                  <th>단원</th>
                  <th>난이도</th>
                  <th>문제</th>
                  <th>정답</th>
                  <th>검사 결과</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr key={`${row.excelRow}-${row.question}`} className={`row-${row.status}`}>
                    <td>{row.excelRow}</td>
                    <td><StatusBadge status={row.status} /></td>
                    <td>{row.unit || "-"}</td>
                    <td>{row.difficulty || "-"}</td>
                    <td className="preview-question-cell">{row.question || "-"}</td>
                    <td>{row.answer || "-"}</td>
                    <td className="reason-cell">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
