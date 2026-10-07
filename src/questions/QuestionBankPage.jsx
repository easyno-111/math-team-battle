import { useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { auth, db } from "../firebase";
import { CHOICE_LABELS, DIFFICULTIES, isMultipleChoiceQuestion, questionCategory, questionUnit } from "../game/questions";
import { appendBankQuestions, prepareBank, readQuizDraft } from "../quiz/bank";
import MathText from "../components/MathText";
import QuestionImporter from "../components/QuestionImporter";
import QuestionEditor from "./QuestionEditor";
import { draftToPayload, validateDraft } from "./questionDraft";

const BATCH_SIZE = 400;
const ALL = "전체";

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
}

async function batched(ids, apply) {
  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    const batch = writeBatch(db);
    ids.slice(start, start + BATCH_SIZE).forEach((id) => apply(batch, doc(db, "questions", id)));
    await batch.commit();
  }
}

export default function QuestionBankPage({ user, questions, loadError, onSendToQuiz }) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("공통수학2");
  const [expanded, setExpanded] = useState(() => new Set());
  const [filters, setFilters] = useState({ search: "", category: ALL, unit: ALL, difficulty: ALL, enabled: ALL });
  const [deleteAll, setDeleteAll] = useState(null);

  const categories = useMemo(() => sortedUnique(questions.map(questionCategory)), [questions]);
  const allUnits = useMemo(() => sortedUnique(questions.map(questionUnit)), [questions]);
  const unitsForFilter = useMemo(() => sortedUnique(questions.filter((q) => filters.category === ALL || questionCategory(q) === filters.category).map(questionUnit)), [questions, filters.category]);
  const legacy = useMemo(() => questions.filter((q) => !isMultipleChoiceQuestion(q)), [questions]);
  const enabledCount = questions.filter((q) => q.enabled !== false).length;

  const filtered = useMemo(() => {
    const keyword = filters.search.trim().toLocaleLowerCase("ko");
    return questions.filter((item) => {
      if (!isMultipleChoiceQuestion(item)) return false;
      if (filters.category !== ALL && questionCategory(item) !== filters.category) return false;
      if (filters.unit !== ALL && questionUnit(item) !== filters.unit) return false;
      if (filters.difficulty !== ALL && item.difficulty !== filters.difficulty) return false;
      if (filters.enabled === "사용 중" && item.enabled === false) return false;
      if (filters.enabled === "출제 제외" && item.enabled !== false) return false;
      if (!keyword) return true;
      return [questionCategory(item), item.unit, item.difficulty, item.question, ...(item.choices || []), item.explanation].filter(Boolean).join(" ").toLocaleLowerCase("ko").includes(keyword);
    });
  }, [questions, filters]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const item of filtered) {
      const key = `${questionCategory(item)}::${questionUnit(item) || "주제 미지정"}`;
      if (!map.has(key)) map.set(key, { key, category: questionCategory(item), name: questionUnit(item) || "주제 미지정", items: [] });
      map.get(key).items.push(item);
    }
    return [...map.values()].sort((a, b) => a.category.localeCompare(b.category, "ko") || a.name.localeCompare(b.name, "ko"));
  }, [filtered]);

  const filtering = Boolean(filters.search.trim()) || [filters.category, filters.unit, filters.difficulty, filters.enabled].some((value) => value !== ALL);
  const visibleIds = filtered.map((item) => item.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const editing = editingId ? questions.find((item) => item.id === editingId) || null : null;

  const toggleIds = (ids, forceOn) => {
    setSelected((current) => {
      const next = new Set(current);
      const on = forceOn ?? !ids.every((id) => next.has(id));
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
    setBulkDeleteConfirm(false);
  };

  const stamp = { updatedBy: user.uid, updatedAt: serverTimestamp() };

  const saveDraft = async (draft) => {
    const problem = validateDraft(draft);
    if (problem) { setMessage(problem); return false; }
    setSaving(true);
    setMessage("");
    try {
      if (editing) {
        await updateDoc(doc(db, "questions", editing.id), { ...draftToPayload(draft), ...stamp });
        setEditingId(null);
        setMessage("문제를 수정했습니다.");
      } else {
        await addDoc(collection(db, "questions"), { ...draftToPayload(draft), createdBy: user.uid, createdAt: serverTimestamp(), source: "manual" });
        setMessage("객관식 문제가 저장되었습니다.");
      }
      return true;
    } catch (error) {
      console.error("문제 저장 오류:", error);
      setMessage(error.code === "permission-denied" ? "저장 권한이 없습니다. Firestore 관리자 설정을 확인해주세요." : "문제를 저장하지 못했습니다.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const startEditing = (item) => {
    setEditingId(item.id);
    setConfirmDeleteId(null);
    setMessage("수정할 내용을 고친 뒤 저장 버튼을 눌러주세요.");
    window.requestAnimationFrame(() => document.querySelector(".editor-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const run = async (label, work) => {
    try { await work(); setMessage(label); }
    catch (error) { console.error(error); setMessage(error.code === "permission-denied" ? "권한이 없습니다. Firestore 규칙을 확인해주세요." : "작업을 완료하지 못했습니다. 잠시 후 다시 시도해주세요."); }
  };

  const toggleEnabled = async (item) => {
    setBusyId(item.id);
    await run(item.enabled === false ? "문제를 다시 게임 출제에 포함했습니다." : "문제를 게임 출제에서 제외했습니다.", () => updateDoc(doc(db, "questions", item.id), { enabled: item.enabled === false, ...stamp }));
    setBusyId(null);
  };

  const deleteOne = async (id) => {
    setBusyId(id);
    await run("문제가 삭제되었습니다.", async () => {
      await deleteDoc(doc(db, "questions", id));
      setConfirmDeleteId(null);
      setSelected((current) => { const next = new Set(current); next.delete(id); return next; });
      if (editingId === id) setEditingId(null);
    });
    setBusyId(null);
  };

  const bulk = async (label, apply, after) => {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkBusy(true);
    await run(label(ids.length), async () => { await batched(ids, apply); after?.(ids); });
    setBulkBusy(false);
  };

  const sendToQuiz = () => {
    try {
      const chosen = questions.filter((item) => selected.has(item.id));
      const prepared = prepareBank(chosen);
      if (!prepared.length) throw new Error("출제에 포함된 유효한 객관식 문제를 선택해주세요.");
      const key = `qm-draft:${user.uid}`;
      const result = appendBankQuestions(readQuizDraft(localStorage.getItem(key)), prepared);
      localStorage.setItem(key, JSON.stringify(result.draft));
      onSendToQuiz(`문제은행에서 ${result.added}문제를 퀴즈 초안에 담았습니다. 총 ${result.draft.questions.length}문제입니다.${result.skipped ? ` 중복 ${result.skipped}문제는 제외했습니다.` : ""} 세트 저장을 눌러 보관하세요.`);
    } catch (error) {
      setMessage(error.message || "퀴즈 초안을 저장하지 못했습니다.");
    }
  };

  const confirmDeleteAll = async (event) => {
    event.preventDefault();
    if (!deleteAll.password) { setDeleteAll({ ...deleteAll, error: "관리자 로그인 비밀번호를 다시 입력해주세요." }); return; }
    const ids = deleteAll.ids;
    setDeleteAll({ ...deleteAll, busy: true, error: "" });
    try {
      await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(user.email, deleteAll.password));
      await batched(ids, (batch, ref) => batch.delete(ref));
      setDeleteAll(null);
      setSelected(new Set());
      setEditingId(null);
      setMessage(`${ids.length}개 문제를 삭제했습니다.`);
    } catch (error) {
      console.error("문제 삭제 오류:", error);
      const code = error?.code || "";
      const text = ["auth/invalid-credential", "auth/wrong-password", "auth/invalid-login-credentials"].includes(code) ? "비밀번호가 올바르지 않습니다."
        : code === "auth/too-many-requests" ? "비밀번호 확인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요."
          : code === "permission-denied" ? "문제 삭제 권한이 없습니다. Firestore 규칙을 확인해주세요." : "삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
      setDeleteAll((current) => ({ ...current, busy: false, error: text }));
    }
  };

  return (
    <>
      {legacy.length > 0 && (
        <div className="legacy-question-notice">
          <div>
            <strong>이전 형식 문제 {legacy.length}개가 남아 있어요.</strong>
            <p>경기는 4지선다 문제만 사용합니다. 목록에는 보이지 않으니 아래 버튼으로 정리해주세요.</p>
          </div>
          <button type="button" onClick={() => setDeleteAll({ ids: legacy.map((q) => q.id), label: "이전 형식 문제", password: "", error: "", busy: false })}>이전 형식 문제 삭제</button>
        </div>
      )}

      <div className="dashboard-grid">
        <QuestionEditor key={editingId || 'new'} editing={editing} categories={categories} units={allUnits} saving={saving} message={message} onSave={saveDraft} onCancel={() => { setEditingId(null); setMessage(""); }} />

        <section className="panel question-list-panel">
          <div className="panel-title list-panel-title">
            <div>
              <span className="section-pill mint">저장된 문제</span>
              <h2>분야 · 주제별 문제 목록</h2>
              <p className="panel-description">목록 칸 안에서 스크롤하며 분야와 주제별로 관리할 수 있어요.</p>
            </div>
            <span className="round-count">{questions.length}</span>
          </div>

          <div className="question-bank-toolbar">
            <input className="question-search-input" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="문제, 보기, 분야, 주제 검색" />
            <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value, unit: ALL })}><option>{ALL}</option>{categories.map((item) => <option key={item}>{item}</option>)}</select>
            <select value={filters.unit} onChange={(e) => setFilters({ ...filters, unit: e.target.value })}><option>{ALL}</option>{unitsForFilter.map((item) => <option key={item}>{item}</option>)}</select>
            <select value={filters.difficulty} onChange={(e) => setFilters({ ...filters, difficulty: e.target.value })}><option>{ALL}</option>{DIFFICULTIES.map((item) => <option key={item}>{item}</option>)}</select>
            <select value={filters.enabled} onChange={(e) => setFilters({ ...filters, enabled: e.target.value })}><option>{ALL}</option><option>사용 중</option><option>출제 제외</option></select>
            <button type="button" className="delete-all-trigger" onClick={() => setDeleteAll({ ids: questions.map((q) => q.id), label: "문제", password: "", error: "", busy: false })} disabled={!questions.length}>문제 전체 삭제</button>
          </div>

          <div className="question-bank-summary">
            <div>
              <span>사용 중 <strong>{enabledCount}</strong></span>
              {questions.length - enabledCount > 0 && <span>출제 제외 <strong>{questions.length - enabledCount}</strong></span>}
              <span>현재 표시 <strong>{filtered.length}</strong></span>
              <span>분야 <strong>{categories.length}</strong></span>
              <span>주제 <strong>{groups.length}</strong></span>
            </div>
            <div className="question-fold-actions">
              <button type="button" onClick={() => setExpanded(new Set(groups.map((g) => g.key)))} disabled={!groups.length}>전체 펼치기</button>
              <button type="button" onClick={() => setExpanded(new Set())} disabled={!groups.length}>전체 접기</button>
            </div>
          </div>

          {loadError && <p className="status-message" role="alert">{loadError}</p>}

          {filtered.length > 0 && (
            <div className={`question-bulk-bar ${selected.size ? "has-selection" : ""}`}>
              <div className="question-bulk-selection">
                <label className="soft-check bulk-select-all"><input type="checkbox" checked={allVisibleSelected} onChange={() => toggleIds(visibleIds, !allVisibleSelected)} /><span />현재 표시 전체 선택</label>
                <strong>{selected.size}개 선택</strong>
                {selected.size > 0 && <button type="button" className="bulk-clear-button" onClick={() => { setSelected(new Set()); setBulkDeleteConfirm(false); }} disabled={bulkBusy}>선택 해제</button>}
              </div>
              {selected.size > 0 && (
                <div className="question-bulk-actions">
                  <button type="button" className="bulk-quiz-button" onClick={sendToQuiz} disabled={bulkBusy}>퀴즈 초안에 담기</button>
                  <div className="bulk-category-editor">
                    <input list="bulk-category-options" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} placeholder="분야/과목" aria-label="선택 문제 분야/과목" />
                    <datalist id="bulk-category-options">{categories.map((item) => <option key={item} value={item} />)}</datalist>
                    <button type="button" disabled={bulkBusy || !bulkCategory.trim()} onClick={() => bulk((n) => `${n}개 문제의 분야/과목을 '${bulkCategory.trim()}'(으)로 지정했습니다.`, (batch, ref) => batch.update(ref, { category: bulkCategory.trim(), ...stamp }))}>분야 지정</button>
                  </div>
                  <button type="button" className="bulk-enable-button" disabled={bulkBusy} onClick={() => bulk((n) => `${n}개 문제를 출제에 포함했습니다.`, (batch, ref) => batch.update(ref, { enabled: true, ...stamp }))}>출제에 포함</button>
                  <button type="button" className="bulk-disable-button" disabled={bulkBusy} onClick={() => bulk((n) => `${n}개 문제를 출제에서 제외했습니다.`, (batch, ref) => batch.update(ref, { enabled: false, ...stamp }))}>출제 제외</button>
                  {!bulkDeleteConfirm ? (
                    <button type="button" className="bulk-delete-button" onClick={() => setBulkDeleteConfirm(true)} disabled={bulkBusy}>선택 삭제</button>
                  ) : (
                    <div className="bulk-delete-confirm">
                      <span>{selected.size}개를 삭제할까요?</span>
                      <button type="button" onClick={() => setBulkDeleteConfirm(false)} disabled={bulkBusy}>취소</button>
                      <button type="button" className="confirm" disabled={bulkBusy} onClick={() => bulk((n) => `${n}개 문제를 삭제했습니다.`, (batch, ref) => batch.delete(ref), (ids) => { if (ids.includes(editingId)) setEditingId(null); setSelected(new Set()); setBulkDeleteConfirm(false); })}>{bulkBusy ? "처리 중..." : "삭제"}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="question-scroll-box" tabIndex={0} aria-label="저장된 문제 스크롤 영역">
            {!questions.length ? (
              <div className="empty-state"><div className="empty-illustration">?</div><strong>아직 저장된 문제가 없어요.</strong><p>왼쪽에서 첫 객관식 문제를 만들거나 아래에서 엑셀 내용을 붙여넣어 보세요.</p></div>
            ) : !filtered.length ? (
              <div className="empty-state compact-empty-state"><strong>조건에 맞는 문제가 없어요.</strong><p>검색어나 필터를 바꿔보세요.</p></div>
            ) : (
              <div className="question-unit-accordion">
                {groups.map((group) => {
                  const open = filtering || expanded.has(group.key);
                  const difficultyCounts = group.items.reduce((acc, item) => { acc[item.difficulty] = (acc[item.difficulty] || 0) + 1; return acc; }, {});
                  const groupEnabled = group.items.filter((item) => item.enabled !== false).length;
                  return (
                    <section className={`question-unit-group ${open ? "open" : ""}`} key={group.key}>
                      <div className="question-unit-header">
                        <label className="soft-check question-unit-select" title={`${group.name} 전체 선택`}>
                          <input type="checkbox" checked={group.items.every((item) => selected.has(item.id))} onChange={() => toggleIds(group.items.map((item) => item.id))} /><span />
                        </label>
                        <button type="button" className="question-unit-toggle" aria-expanded={open} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next; })}>
                          <span className="question-unit-chevron">{open ? "−" : "+"}</span>
                          <span className="question-unit-main">
                            <span className="question-category-mini">{group.category}</span>
                            <strong>{group.name}</strong>
                            <small>{group.items.length}문제 · 사용 {groupEnabled}{group.items.length - groupEnabled ? ` · 제외 ${group.items.length - groupEnabled}` : ""}</small>
                          </span>
                          <span className="question-unit-difficulty-counts">{DIFFICULTIES.map((level) => difficultyCounts[level] ? <i key={level} className={`difficulty-${level}`}>{level} {difficultyCounts[level]}</i> : null)}</span>
                          <span className="question-unit-open-label">{open ? "접기" : "펼치기"}</span>
                        </button>
                      </div>

                      {open && (
                        <div className="question-unit-items">
                          {group.items.map((item) => (
                            <article className={`question-item ${editingId === item.id ? "is-editing" : ""} ${selected.has(item.id) ? "is-selected" : ""} ${item.enabled === false ? "is-disabled" : ""}`} key={item.id}>
                              <label className="soft-check question-item-select" title="문제 선택"><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleIds([item.id])} /><span /></label>
                              <div className="question-body">
                                <div className="question-topline">
                                  <div className="question-meta">
                                    <span className={`difficulty-tag difficulty-${item.difficulty}`}>{item.difficulty}</span>
                                    <span className={`use-status-tag ${item.enabled === false ? "off" : "on"}`}>{item.enabled === false ? "출제 제외" : "사용 중"}</span>
                                  </div>
                                  {confirmDeleteId !== item.id && (
                                    <div className="question-item-actions">
                                      <button type="button" className={`question-enabled-toggle ${item.enabled === false ? "off" : "on"}`} onClick={() => toggleEnabled(item)} disabled={busyId === item.id || bulkBusy}>{busyId === item.id ? "변경 중..." : item.enabled === false ? "다시 사용" : "출제 제외"}</button>
                                      <button type="button" className="edit-question-button" onClick={() => startEditing(item)}>수정</button>
                                      <button type="button" className="delete-button" onClick={() => setConfirmDeleteId(item.id)} aria-label="문제 삭제">삭제</button>
                                    </div>
                                  )}
                                </div>
                                <div className="saved-question"><MathText text={item.question} /></div>
                                <div className="saved-choice-list">
                                  {item.choices.map((choice, index) => <div key={index} className={item.correctOption === index + 1 ? "correct" : ""}><span>{CHOICE_LABELS[index]}</span><MathText text={choice} /></div>)}
                                </div>
                                {item.explanation && <div className="saved-explanation"><span>해설</span><p><MathText text={item.explanation} /></p></div>}
                                {confirmDeleteId === item.id && (
                                  <div className="delete-confirm-box">
                                    <div><strong>이 문제를 삭제할까요?</strong><p>삭제한 문제는 되돌릴 수 없어요.</p></div>
                                    <div className="delete-confirm-actions">
                                      <button type="button" className="cancel-delete-button" onClick={() => setConfirmDeleteId(null)} disabled={busyId === item.id}>취소</button>
                                      <button type="button" className="confirm-delete-button" onClick={() => deleteOne(item.id)} disabled={busyId === item.id}>{busyId === item.id ? "삭제 중..." : "삭제하기"}</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      <QuestionImporter user={user} questions={questions} />

      {deleteAll && (
        <div className="delete-all-overlay" role="presentation" onMouseDown={() => !deleteAll.busy && setDeleteAll(null)}>
          <section className="delete-all-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="delete-all-icon">!</div>
            <span className="section-pill peach">위험 작업</span>
            <h2>{deleteAll.label} {deleteAll.ids.length}개를 삭제할까요?</h2>
            <p>관리자 계정은 그대로 유지되고 문제 데이터만 지워집니다.</p>
            <p className="delete-all-warning">삭제한 문제는 되돌릴 수 없습니다.</p>
            <form onSubmit={confirmDeleteAll}>
              <label>관리자 로그인 비밀번호 다시 입력
                <input type="password" value={deleteAll.password} onChange={(e) => setDeleteAll({ ...deleteAll, password: e.target.value })} autoComplete="current-password" placeholder="현재 관리자 비밀번호" autoFocus disabled={deleteAll.busy} />
              </label>
              {deleteAll.error && <div className="error-message">{deleteAll.error}</div>}
              <div className="delete-all-actions">
                <button type="button" className="secondary-button" onClick={() => setDeleteAll(null)} disabled={deleteAll.busy}>취소</button>
                <button type="submit" className="danger-primary-button" disabled={deleteAll.busy}>{deleteAll.busy ? "삭제 중..." : `${deleteAll.ids.length}개 삭제`}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
