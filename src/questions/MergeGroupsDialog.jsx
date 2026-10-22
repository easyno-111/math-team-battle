import { useEffect, useMemo, useRef, useState } from "react";
import { classificationGroups, executeGroupMerge, planGroupMerge } from "./mergeGroups";

export default function MergeGroupsDialog({ questions, initialCategory, initialSourceKeys = [], onCommit, onClose, onMerged }) {
  const dialogRef = useRef(null);
  const groups = useMemo(() => classificationGroups(questions), [questions]);
  const [sourceKeys, setSourceKeys] = useState(() => new Set(initialSourceKeys));
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(initialCategory || "");
  const [unit, setUnit] = useState("");
  const [mode, setMode] = useState("unit");
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completedBefore, setCompletedBefore] = useState(0);
  const [error, setError] = useState("");
  const running = useRef(false);
  const chosen = groups.filter((group) => sourceKeys.has(group.key));
  const keyword = search.trim().toLocaleLowerCase("ko");
  const visible = groups.filter((group) => `${group.category} ${group.unit}`.toLocaleLowerCase("ko").includes(keyword));
  const categories = [...new Set(groups.map((group) => group.category))];
  const units = [...new Set(groups.filter((group) => group.category === category.trim()).map((group) => group.unit).filter(Boolean))];

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const preview = (event) => {
    event.preventDefault();
    try {
      setPlan(planGroupMerge(questions, { sourceKeys, category, unit, mode }));
      setProgress(0);
      setCompletedBefore(0);
      setError("");
    } catch (problem) { setError(problem.message); }
  };

  const execute = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const count = await executeGroupMerge(plan, onCommit, setProgress);
      onMerged({ ...plan, completed: completedBefore + count });
      onClose();
    } catch (problem) {
      const detail = problem.code === "permission-denied" ? "분류 변경 권한이 없습니다. 관리자 계정을 확인해주세요."
        : problem.code === "merge-conflict" ? problem.message : "연결 또는 저장 오류가 발생했어요. 남은 문제를 다시 시도할 수 있어요.";
      setError(`${completedBefore + problem.completed}개 처리 완료 · ${problem.remaining.length}개 남음. ${detail}`);
      setCompletedBefore((current) => current + problem.completed);
      setPlan((current) => ({ ...current, changes: problem.remaining }));
      setProgress(0);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="merge-groups-dialog" aria-labelledby="merge-groups-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className="merge-groups-heading"><div><span className="section-pill mint">문제은행 정리</span><h2 id="merge-groups-title">분류 합치기</h2></div><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>닫기</button></div>
      {!plan ? (
        <form onSubmit={preview}>
          <p>분야·주제를 선택해 하나로 묶어요. 목록 필터와 관계없이 해당 분류의 전체 문제를 포함합니다.</p>
          <label className="merge-field">합칠 분류 검색<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="분야 또는 주제 이름" autoFocus /></label>
          <div className="merge-group-options" role="group" aria-label="합칠 분류 선택">
            {visible.map((group) => <label className="merge-group-option" key={group.key}>
              <input type="checkbox" checked={sourceKeys.has(group.key)} onChange={(event) => { setSourceKeys((current) => { const next = new Set(current); if (event.target.checked) next.add(group.key); else next.delete(group.key); return next; }); if (!category) setCategory(group.category); }} />
              <span><small>{group.category}</small><strong>{group.unit || "주제 미지정"}</strong></span><b>{group.count}문제</b>
            </label>)}
            {!visible.length && <p>조건에 맞는 분류가 없어요.</p>}
          </div>
          <p className="merge-selection-summary">{chosen.length}개 분류 · {chosen.reduce((sum, group) => sum + group.count, 0)}문제 선택 (출제 제외 포함)</p>
          <fieldset className="merge-mode"><legend>합치는 방식</legend>
            <label><input type="radio" name="merge-mode" checked={mode === "unit"} onChange={() => setMode("unit")} />주제까지 하나로 합치기</label>
            <label><input type="radio" name="merge-mode" checked={mode === "category"} onChange={() => setMode("category")} />분야만 합치고 주제 유지</label>
          </fieldset>
          <div className="merge-target-fields">
            <label className="merge-field">합칠 분야 / 과목<input list="merge-category-options" value={category} onChange={(event) => setCategory(event.target.value)} maxLength={100} placeholder="기존 분야 선택 또는 새 이름" required /></label>
            {mode === "unit" && <label className="merge-field">합칠 주제 / 단원<input list="merge-unit-options" value={unit} onChange={(event) => setUnit(event.target.value)} maxLength={100} placeholder="예: 방정식" required /></label>}
          </div>
          <datalist id="merge-category-options">{categories.map((name) => <option key={name} value={name} />)}</datalist>
          <datalist id="merge-unit-options">{units.map((name) => <option key={name} value={name} />)}</datalist>
          {error && <p className="merge-error" role="alert">{error}</p>}
          <div className="merge-actions"><button type="submit" className="primary-button" disabled={!chosen.length}>합칠 내용 미리보기</button></div>
        </form>
      ) : (
        <div>
          <ul className="merge-source-summary">{plan.sources.map((group) => <li key={group.key}>{group.category} / {group.unit || "주제 미지정"} · {group.count}문제</li>)}</ul>
          <div className="merge-target-summary"><span>합친 후</span><strong>{plan.category} / {plan.mode === "unit" ? plan.unit : "기존 주제 유지"}</strong><b>분류 변경 대상 {plan.changes.length}문제</b></div>
          <p>확인한 문제들의 분류 이름을 변경합니다. 문제 내용·정답·난이도·출제 여부는 그대로 유지됩니다. 저장된 퀴즈 세트는 별도로 보관됩니다.</p>
          {busy && <p role="status" aria-live="polite">{progress} / {plan.changes.length}문제 처리 중…</p>}
          {error && <p className="merge-error" role="alert">{error}</p>}
          <div className="merge-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => { setPlan(null); setError(""); }}>분류 다시 선택</button><button type="button" className="primary-button" disabled={busy} onClick={execute}>{busy ? "합치는 중…" : `${plan.changes.length}문제 분류 합치기`}</button></div>
        </div>
      )}
    </dialog>
  );
}
