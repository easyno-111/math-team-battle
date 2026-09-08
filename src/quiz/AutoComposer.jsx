import { useMemo, useState } from 'react';
import MathText from '../components/MathText';
import { newId } from './model';
import { bankOptions, composeBankRecipe, matchesBank, QUIZ_LIMIT, uniqueAvailableBank } from './bank';

const emptyRecipeRow = (category = '') => ({ id: newId(), category, unit: '', difficulty: '', count: 5, duration: 30 });
export default function AutoComposer({ bank, existing, onApply, disabled = false }) {
  const [recipe, setRecipe] = useState(() => [{ ...emptyRecipeRow(), count: 10 }]);
  const [placement, setPlacement] = useState('append'), [shuffleAll, setShuffleAll] = useState(true);
  const [preview, setPreview] = useState(null), [message, setMessage] = useState('');
  const available = useMemo(() => uniqueAvailableBank(bank, placement === 'append' ? existing : []), [bank, existing, placement]);
  const total = recipe.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
  const existingCount = placement === 'append' ? existing.length : 0;
  function invalidate() { setPreview(null); setMessage(''); }
  function edit(id, patch) { setRecipe(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row)); invalidate(); }
  function build() {
    try { setPreview(composeBankRecipe(bank, recipe, { existing: placement === 'append' ? existing : [], shuffleAll })); setMessage(''); }
    catch (error) { setPreview(null); setMessage(error.message); }
  }
  function apply() {
    try {
      if (placement === 'append' && uniqueAvailableBank(preview.questions, existing).length !== preview.questions.length) throw new Error('미리 구성한 문제 중 이미 초안에 담긴 문제가 있어요. 다시 미리 구성해주세요.');
      onApply(preview.questions, placement); setPreview(null); setMessage('구성한 문제를 편집기에 담았습니다. 아래에서 확인하고 세트를 저장하세요.');
    } catch (error) { setMessage(error.message); }
  }
  return <section className="qm-composer"><div className="qm-section-head"><div><h3>여러 단원을 한 세트로</h3><p className="qm-help-text">단원마다 문제 수와 난이도를 정해주세요. 예: 좌표평면 4문제 + 직선의 방정식 5문제</p></div><span className="qm-pill">총 {total}문제</span></div>
    <div className="qm-recipe-list">{recipe.map((row, i) => {
      const availableCount = available.filter(q => matchesBank(q, row)).length;
      const shortage = Number(row.count) > availableCount;
      return <fieldset key={row.id} className="qm-recipe-row" disabled={disabled}><legend>출제 조건 {i + 1}</legend><div className="qm-recipe-fields"><label>분야 / 과목<select value={row.category} onChange={e => edit(row.id, { category: e.target.value, unit: '' })}><option value="">전체 분야</option>{bankOptions(bank, 'category').map(category => <option key={category}>{category}</option>)}</select></label><label>단원<select value={row.unit} onChange={e => edit(row.id, { unit: e.target.value })}><option value="">전체 단원</option>{bankOptions(bank.filter(q => !row.category || q.category === row.category), 'unit').map(unit => <option key={unit}>{unit}</option>)}</select></label><label>난이도<select value={row.difficulty} onChange={e => edit(row.id, { difficulty: e.target.value })}><option value="">전체 난이도</option>{bankOptions(bank, 'difficulty').map(level => <option key={level}>{level}</option>)}</select></label><label>문제 수<input type="number" min="1" max="40" step="1" value={row.count} onChange={e => edit(row.id, { count: e.target.value })}/></label><label>제한시간(초)<input type="number" min="10" max="240" step="1" value={row.duration} onChange={e => edit(row.id, { duration: e.target.value })}/></label></div><div className="qm-recipe-row-footer"><small className={shortage ? 'is-shortage' : ''}>사용 가능 {availableCount}문제{shortage ? ` · ${Number(row.count) - availableCount}문제 부족` : ''}</small><button type="button" className="qm-text-button" disabled={recipe.length === 1} onClick={() => { setRecipe(rows => rows.filter(r => r.id !== row.id)); invalidate(); }} aria-label={`출제 조건 ${i + 1} 삭제`}>조건 삭제</button></div></fieldset>;
    })}</div>
    <button type="button" className="qm-add-recipe" disabled={disabled || recipe.length >= QUIZ_LIMIT} onClick={() => { setRecipe(rows => [...rows, emptyRecipeRow(rows[rows.length - 1]?.category)]); invalidate(); }}>＋ 단원 / 출제 조건 추가</button>
    <div className="qm-composer-options"><label>기존 초안 처리<select disabled={disabled} value={placement} onChange={e => { setPlacement(e.target.value); invalidate(); }}><option value="append">기존 {existing.length}문제 뒤에 추가</option><option value="replace">새 구성으로 교체</option></select></label><label>출제 순서<select disabled={disabled} value={shuffleAll ? 'shuffle' : 'groups'} onChange={e => { setShuffleAll(e.target.value === 'shuffle'); invalidate(); }}><option value="shuffle">여러 단원을 섞어서 출제</option><option value="groups">위의 조건 순서대로 출제</option></select></label></div>
    <div className="qm-composer-total"><span>기존 <b>{existingCount}</b> + 구성 <b>{total}</b> = <strong>{existingCount + total}문제</strong></span><small>최대 40문제 · 같은 문제는 한 번만</small></div>
    <button type="button" className="qm-primary qm-compose-button" disabled={disabled} onClick={build}>{total}문제 미리 구성 <span aria-hidden="true">→</span></button>
    {message && <p className="qm-message" role="status">{message}</p>}
    {preview && <section className="qm-composition-preview"><div className="qm-section-head"><h4>이렇게 출제해요</h4><span className="qm-pill">{preview.questions.length}문제</span></div><div className="qm-composition-groups">{preview.groups.map(row => <span key={row.rowIndex}>{row.unit || row.category || '전체'} · {row.difficulty || '난이도 전체'} <b>{row.count}문제</b></span>)}</div><ol>{preview.questions.map(q => <li key={q.id}><small>{q.unit} · {q.difficulty} · {q.duration}초</small><MathText text={q.question}/></li>)}</ol><button type="button" className="qm-primary qm-compose-button" disabled={disabled} onClick={apply}>{placement === 'replace' ? `초안을 이 ${preview.questions.length}문제로 교체` : `이 ${preview.questions.length}문제 추가하기`} <span aria-hidden="true">→</span></button></section>}
  </section>;
}
