import { useRef, useState } from "react";
import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { CHOICE_LABELS } from "../game/questions";
import { analyzeRecords, downloadQuestionTemplate, headerLine, recordsFromText, recordsFromWorkbook, toQuestionDocument } from "../utils/questionImport";

const PREVIEW_LIMIT = 100;
const BATCH_SIZE = 400;

const STATUS_LABEL = { ready: "등록 가능", duplicate: "중복 제외", error: "수정 필요" };

export default function QuestionImporter({ user, questions }) {
  const fileInput = useRef(null);
  const [text, setText] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState(null);

  const report = (type, body) => setMessage({ type, body });

  const finishAnalysis = (result, label) => {
    setAnalysis(result);
    setSourceName(label);
    if (result.errors > 0) report("error", `수정이 필요한 행이 ${result.errors}개 있습니다. 내용을 고친 뒤 다시 확인해주세요.`);
    else if (!result.ready && result.duplicates) report("warning", "모든 문제가 이미 등록되어 있어 새로 추가할 문제가 없습니다.");
    else report("success", `${result.ready}개 문제를 등록할 준비가 되었습니다.${result.duplicates ? ` 중복 ${result.duplicates}개는 자동으로 제외됩니다.` : ""}`);
  };

  const analyzeText = () => {
    try {
      finishAnalysis(analyzeRecords(recordsFromText(text), questions), "붙여넣은 내용");
    } catch (error) {
      setAnalysis(null);
      report("error", error.message);
    }
  };

  const analyzeFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setWorking(true);
    try {
      finishAnalysis(analyzeRecords(await recordsFromWorkbook(file), questions), file.name);
    } catch (error) {
      setAnalysis(null);
      report("error", error.message || "엑셀 파일을 읽지 못했습니다.");
    } finally {
      setWorking(false);
    }
  };

  const reset = () => {
    setAnalysis(null);
    setSourceName("");
    setMessage(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const copyHeader = async () => {
    try { await navigator.clipboard.writeText(headerLine()); report("info", "머리글 한 줄을 복사했어요. 엑셀 첫 행에 붙여넣고 그 아래에 문제를 적으세요."); }
    catch { report("warning", `복사가 막혀 있어요. 열 순서: ${headerLine().replace(/\t/g, " · ")}`); }
  };

  const importRows = async () => {
    if (!analysis || analysis.errors > 0 || !analysis.readyRows.length) return;
    if (!window.confirm(`${analysis.readyRows.length}개 문제를 문제은행에 등록할까요?${analysis.duplicates ? `\n중복 ${analysis.duplicates}개는 등록하지 않습니다.` : ""}`)) return;
    setWorking(true);
    try {
      const importBatchId = globalThis.crypto?.randomUUID?.() || `import-${Date.now()}`;
      let done = 0;
      for (let start = 0; start < analysis.readyRows.length; start += BATCH_SIZE) {
        const batch = writeBatch(db);
        analysis.readyRows.slice(start, start + BATCH_SIZE).forEach((row) => {
          batch.set(doc(collection(db, "questions")), toQuestionDocument(row, { createdBy: user.uid, createdAt: serverTimestamp(), source: sourceName === "붙여넣은 내용" ? "paste" : "excel", importBatchId }));
        });
        await batch.commit();
        done = Math.min(analysis.readyRows.length, start + BATCH_SIZE);
        report("info", `등록 중... ${done} / ${analysis.readyRows.length}`);
      }
      report("success", `${analysis.readyRows.length}개 문제를 등록했습니다.`);
      setAnalysis(null);
      setText("");
      if (fileInput.current) fileInput.current.value = "";
    } catch (error) {
      console.error("일괄 등록 오류:", error);
      report("error", error.code === "permission-denied" ? "등록 권한이 없습니다. Firestore 관리자 권한을 확인해주세요." : "일괄 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="panel bulk-import-panel">
      <div className="panel-title bulk-title">
        <div>
          <span className="section-pill peach">여러 문제 한 번에</span>
          <h2>엑셀에서 붙여넣어 문제 넣기</h2>
          <p className="panel-description">엑셀이나 구글 시트에서 범위를 복사해 아래 칸에 붙여넣으면 저장 전에 오류와 중복을 확인해요.</p>
        </div>
        <div className="import-header-actions">
          <button type="button" className="secondary-button" onClick={copyHeader}>머리글 복사</button>
          <button type="button" className="template-button" onClick={downloadQuestionTemplate}>엑셀 양식 받기</button>
        </div>
      </div>

      <div className="import-columns">
        <span>열 순서</span>
        {headerLine().split("\t").map((column, index) => <b key={column}>{index + 1}. {column}</b>)}
        <small>머리글 행을 함께 복사하면 열 순서가 달라도 됩니다. 분야/과목과 해설은 비워도 돼요.</small>
      </div>

      <textarea
        className="import-paste-area"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"엑셀에서 복사한 내용을 여기에 붙여넣으세요. (Ctrl+V)\n예) 공통수학2\t평면좌표\t쉬움\t두 점 사이의 거리는?\t3\t4\t5\t6\t3\t거리 공식"}
        rows={8}
        spellCheck={false}
        disabled={working}
      />

      <div className="import-actions">
        <button type="button" className="primary-button" onClick={analyzeText} disabled={working || !text.trim()}>붙여넣은 내용 확인</button>
        <label className="import-file-label">
          <span>또는 .xlsx 파일 올리기</span>
          <input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={analyzeFile} disabled={working} />
        </label>
        {analysis && <button type="button" className="secondary-button" onClick={reset} disabled={working}>다시 시작</button>}
      </div>

      {message && <div className={`excel-message ${message.type}`}>{message.body}</div>}

      {analysis && (
        <>
          <div className="analysis-summary">
            <div className="summary-card"><span>전체</span><strong>{analysis.total}</strong></div>
            <div className="summary-card success"><span>등록 가능</span><strong>{analysis.ready}</strong></div>
            <div className="summary-card duplicate"><span>중복 제외</span><strong>{analysis.duplicates}</strong></div>
            <div className="summary-card error"><span>수정 필요</span><strong>{analysis.errors}</strong></div>
          </div>

          {analysis.errorRows.length > 0 && (
            <div className="error-row-list">
              <strong>수정이 필요한 행</strong>
              {analysis.errorRows.slice(0, 20).map((row) => <div key={row.rowNumber}><span>{row.rowNumber}행</span><p>{row.reason}</p></div>)}
              {analysis.errorRows.length > 20 && <small>외 {analysis.errorRows.length - 20}개 오류가 더 있습니다.</small>}
            </div>
          )}

          <div className="excel-preview-header">
            <div><strong>{sourceName} 미리보기</strong><span>{analysis.total > PREVIEW_LIMIT ? `앞의 ${PREVIEW_LIMIT}개 행만 보여드려요.` : `${analysis.total}개 행`}</span></div>
            <button type="button" className="primary-button import-button" onClick={importRows} disabled={working || analysis.errors > 0 || !analysis.readyRows.length}>
              {working ? "등록 중..." : `${analysis.readyRows.length}문제 등록하기`}
            </button>
          </div>

          <div className="excel-table-wrap">
            <table className="excel-preview-table">
              <thead><tr><th>행</th><th>상태</th><th>분야/과목</th><th>단원</th><th>난이도</th><th>문제</th><th>보기</th><th>정답</th><th>검사 결과</th></tr></thead>
              <tbody>
                {analysis.rows.slice(0, PREVIEW_LIMIT).map((row) => (
                  <tr key={row.rowNumber} className={`row-${row.status}`}>
                    <td>{row.rowNumber}</td>
                    <td><span className={`import-status ${row.status}`}>{STATUS_LABEL[row.status]}</span></td>
                    <td>{row.category}</td>
                    <td>{row.unit || "-"}</td>
                    <td>{row.difficulty || "-"}</td>
                    <td className="preview-question-cell">{row.question || "-"}</td>
                    <td className="preview-choice-cell">{row.choices.map((choice, index) => <div key={index}><span>{CHOICE_LABELS[index]}</span> {choice || "-"}</div>)}</td>
                    <td>{row.correctAnswer ? `${CHOICE_LABELS[row.correctOption - 1]} ${row.correctAnswer}` : row.correctOptionRaw || "-"}</td>
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
