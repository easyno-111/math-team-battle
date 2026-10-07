import { useState } from "react";
import { CHOICE_LABELS, DIFFICULTIES } from "../game/questions";
import MathText from "../components/MathText";
import { blankDraft, draftFrom } from "./questionDraft";

export default function QuestionEditor({ editing, categories, units, saving, message, onSave, onCancel }) {
  // Remounted by the parent (key) whenever the edited question changes.
  const [draft, setDraft] = useState(() => (editing ? draftFrom(editing) : blankDraft()));

  const patch = (changes) => setDraft((current) => ({ ...current, ...changes }));
  const setChoice = (index, value) => patch({ choices: draft.choices.map((choice, i) => (i === index ? value : choice)) });
  const submit = async (event) => {
    event.preventDefault();
    const saved = await onSave(draft);
    if (saved && !editing) patch({ question: "", choices: ["", "", "", ""], correctOption: 1, explanation: "" });
  };

  return (
    <section className="panel editor-panel">
      <div className="panel-title">
        <div>
          <span className="section-pill lavender">{editing ? "문제 수정" : "4지선다 추가"}</span>
          <h2>{editing ? "객관식 문제 수정하기" : "새 객관식 문제 만들기"}</h2>
          <p className="panel-description">{editing ? "저장된 문제의 내용과 보기를 고칠 수 있어요." : "보기 네 개와 정답 하나를 정해 저장해요."}</p>
        </div>
      </div>

      <form className="question-form" onSubmit={submit}>
        <div className="form-row">
          <label>분야 / 과목
            <input list="question-category-options" value={draft.category} onChange={(e) => patch({ category: e.target.value })} placeholder="예: 공통수학2, 상식퀴즈" />
            <datalist id="question-category-options">{categories.map((item) => <option key={item} value={item} />)}</datalist>
          </label>
          <label>주제 / 단원
            <input list="question-unit-options" value={draft.unit} onChange={(e) => patch({ unit: e.target.value })} placeholder="예: 평면좌표, 세계 상식" />
            <datalist id="question-unit-options">{units.map((item) => <option key={item} value={item} />)}</datalist>
          </label>
        </div>
        <label>난이도
          <select value={draft.difficulty} onChange={(e) => patch({ difficulty: e.target.value })}>{DIFFICULTIES.map((level) => <option key={level}>{level}</option>)}</select>
        </label>
        <label>문제<textarea value={draft.question} onChange={(e) => patch({ question: e.target.value })} placeholder="예: 두 점 A(1, 2), B(4, 6) 사이의 거리를 구하시오." rows={4} /></label>

        <div className="preview-box multiple-choice-preview">
          <span className="preview-label">학생 화면 미리보기</span>
          <div className="question-preview">{draft.question ? <MathText text={draft.question} /> : <span className="preview-empty">문제를 입력하면 여기에서 미리 볼 수 있어요.</span>}</div>
          <div className="preview-choice-list">
            {draft.choices.map((choice, index) => (
              <div key={index} className={draft.correctOption === index + 1 ? "is-answer" : ""}><span>{CHOICE_LABELS[index]}</span><b><MathText text={choice || `보기 ${index + 1}`} /></b></div>
            ))}
          </div>
        </div>

        <div className="choice-editor-list">
          {draft.choices.map((choice, index) => (
            <label className="choice-editor-row" key={index}>
              <span className="choice-editor-label">{CHOICE_LABELS[index]} 보기 {index + 1}</span>
              <input value={choice} onChange={(e) => setChoice(index, e.target.value)} placeholder={`보기 ${index + 1} 내용을 입력하세요`} />
              <span className="correct-choice-selector"><input type="radio" name="correctOption" checked={draft.correctOption === index + 1} onChange={() => patch({ correctOption: index + 1 })} />정답</span>
            </label>
          ))}
        </div>

        <label>해설 <span className="optional-label">선택</span>
          <textarea value={draft.explanation} onChange={(e) => patch({ explanation: e.target.value })} placeholder="정답 공개 때 보여줄 해설을 적어둘 수 있어요." rows={3} />
        </label>
        {draft.explanation && <div className="math-edit-preview"><small>해설 미리보기</small><MathText text={draft.explanation} /></div>}
        {message && <div className="status-message">{message}</div>}

        <div className="editor-save-actions">
          {editing && <button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>수정 취소</button>}
          <button className="primary-button" disabled={saving}>{saving ? "저장 중..." : editing ? "수정 내용 저장하기" : "객관식 문제 저장하기"}</button>
        </div>
      </form>
    </section>
  );
}
