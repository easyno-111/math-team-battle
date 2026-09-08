import { useMemo, useState } from 'react';
import MathText from '../components/MathText';
import QuizDialog from './QuizDialog';
import { ChoiceMark } from './QuizBoard';
import { alreadyInSet, bankOptions, existingBankIndex, matchesBank, QUIZ_LIMIT, uniqueAvailableBank } from './bank';

const BANK_PAGE_SIZE = 12;
export default function BankBrowser({ bank, existing, onImport, onClose, disabled = false }) {
  const [filters, setFilters] = useState({ search: '', category: '', unit: '', difficulty: '' });
  const [picks, setPicks] = useState(() => new Set());
  const [page, setPage] = useState(0), [hideAdded, setHideAdded] = useState(true), [message, setMessage] = useState('');
  const catalog = useMemo(() => uniqueAvailableBank(bank), [bank]);
  const used = useMemo(() => existingBankIndex(existing), [existing]);
  const rows = useMemo(() => catalog.map(q => ({ q, included: alreadyInSet(q, used) })), [catalog, used]);
  const selected = rows.filter(row => picks.has(row.q.id) && !row.included).map(row => row.q);
  const roomLeft = Math.max(0, QUIZ_LIMIT - existing.length);
  const categoryPool = catalog.filter(q => !filters.category || q.category === filters.category);
  const units = bankOptions(categoryPool, 'unit');
  const filtered = rows.filter(({ q, included }) => (!hideAdded || !included) && matchesBank(q, filters));
  const pages = Math.max(1, Math.ceil(filtered.length / BANK_PAGE_SIZE)), currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * BANK_PAGE_SIZE, (currentPage + 1) * BANK_PAGE_SIZE);
  const selectable = visible.filter(row => !row.included).map(row => row.q.id);
  const pageSelected = selectable.length > 0 && selectable.every(id => picks.has(id));
  function filter(patch) { setFilters(current => ({ ...current, ...patch })); setPage(0); setMessage(''); }
  function toggle(id) {
    if (disabled) return;
    const next = new Set(selected.map(q => q.id));
    if (next.has(id)) next.delete(id);
    else { if (next.size >= roomLeft) { setMessage(`지금은 ${roomLeft}문제까지 더 담을 수 있어요. 선택한 문제를 줄여주세요.`); return; } next.add(id); }
    setPicks(next); setMessage('');
  }
  function selectPage() {
    const next = new Set(selected.map(q => q.id));
    selectable.forEach(id => pageSelected ? next.delete(id) : next.add(id));
    if (next.size > roomLeft) { setMessage(`이 페이지를 모두 선택하면 40문제를 넘어요. ${roomLeft}문제 이내로 선택해주세요.`); return; }
    setPicks(next); setMessage('');
  }
  function apply() { try { onImport(selected); } catch (error) { setMessage(error.message); } }
  return <QuizDialog title="문제은행에서 가져오기" onClose={onClose} className="qm-bank-dialog">
    <div className="qm-bank-search"><label>문제 검색<input type="search" value={filters.search} onChange={e => filter({ search: e.target.value })} placeholder="문제 내용, 단원, 보기의 단어로 검색"/></label><div className="qm-fields"><label>분야 / 과목<select value={filters.category} onChange={e => filter({ category: e.target.value, unit: '' })}><option value="">전체 분야</option>{bankOptions(catalog, 'category').map(category => <option key={category}>{category}</option>)}</select></label><label>난이도<select value={filters.difficulty} onChange={e => filter({ difficulty: e.target.value })}><option value="">전체 난이도</option>{bankOptions(catalog, 'difficulty').map(level => <option key={level}>{level}</option>)}</select></label></div></div>
    <div className="qm-bank-browser"><aside className="qm-bank-units" aria-label="단원별 문제"><button type="button" aria-pressed={!filters.unit} onClick={() => filter({ unit: '' })}><strong>전체 단원</strong><small>{categoryPool.length}</small></button>{units.map(unit => <button type="button" key={unit} aria-pressed={filters.unit === unit} onClick={() => filter({ unit })}><span>{unit}</span><small>{categoryPool.filter(q => q.unit === unit).length}</small></button>)}</aside>
      <section className="qm-bank-matches"><div className="qm-bank-list-tools"><strong>{filtered.length}문제 <small>· {currentPage + 1} / {pages}쪽</small></strong><label className="qm-check"><input type="checkbox" checked={hideAdded} onChange={e => { setHideAdded(e.target.checked); setPage(0); }}/>이미 담긴 문제 숨기기</label><button type="button" disabled={disabled || !selectable.length} onClick={selectPage}>{pageSelected ? '이 페이지 선택 해제' : '이 페이지 선택'}</button></div>
        <div className="qm-bank-list" key={`${filters.category}:${filters.unit}:${filters.difficulty}:${filters.search}:${currentPage}:${hideAdded}`}>
          {!visible.length && <div className="qm-empty-state"><h3>{!catalog.length ? '가져올 문제가 아직 없어요' : '조건에 맞는 문제가 없어요'}</h3><p>{!catalog.length ? '문제은행에 객관식 문제를 저장하고 출제에 포함해주세요.' : '검색 조건을 바꾸거나 이미 담긴 문제 숨기기를 꺼보세요.'}</p></div>}
          {visible.map(({ q, included }) => <article key={q.id} className={`qm-bank-question${picks.has(q.id) && !included ? ' is-picked' : ''}${included ? ' is-included' : ''}`}><label className="qm-bank-question-pick"><input type="checkbox" checked={included || picks.has(q.id)} disabled={disabled || included || !picks.has(q.id) && selected.length >= roomLeft} onChange={() => toggle(q.id)} aria-label={`${q.unit}: ${q.question} 선택`}/><span><small className="qm-bank-question-meta">{q.category} · {q.unit} <b>{q.difficulty}</b>{included && <em>이미 담긴 문제</em>}</small><span className="qm-bank-question-text"><MathText text={q.question}/></span></span></label><details><summary>문제 전체 · 보기 · 정답 확인</summary><div className="qm-bank-full-question"><MathText text={q.question}/></div><div className="qm-bank-detail-choices">{q.choices.map((choice, i) => <div key={i} className={Number(q.correctIndex) === i ? 'correct' : ''}><ChoiceMark index={i}/><MathText text={choice}/>{Number(q.correctIndex) === i && <small>정답</small>}</div>)}</div>{q.explanation && <p className="qm-bank-detail-explanation"><MathText text={q.explanation}/></p>}</details></article>)}
        </div>
        <div className="qm-bank-pagination"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>이전</button><span>{currentPage + 1} / {pages}</span><button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>다음</button></div>
      </section>
    </div>
    <footer className="qm-bank-basket">{message && <p className="qm-message" role="status">{message}</p>}<div className="qm-bank-basket-head"><div><strong>{selected.length}문제 선택</strong><small>현재 {existing.length}문제 + 선택 {selected.length}문제 / 최대 40문제</small></div><button type="button" className="qm-text-button" disabled={!selected.length || disabled} onClick={() => { setPicks(new Set()); setMessage(''); }}>선택 비우기</button></div>{selected.length > 0 && <div className="qm-picked-list" aria-label="선택한 문제 목록">{selected.map((q, i) => <button type="button" disabled={disabled} key={q.id} title={q.question} onClick={() => toggle(q.id)}><span>{i + 1}. {q.unit}</span><b aria-label="선택 취소">×</b></button>)}</div>}<button type="button" className="qm-primary qm-bank-import" disabled={!selected.length || selected.length > roomLeft || disabled} onClick={apply}>선택한 {selected.length}문제 가져오기 <span aria-hidden="true">→</span></button></footer>
  </QuizDialog>;
}
