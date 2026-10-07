import { useEffect, useMemo, useState } from 'react';
import { onValue, ref, set, remove, serverTimestamp } from 'firebase/database';
import { adminRealtime } from '../realtime';
import { TYPES, blankQuestion, grade, newId, publicQuestion, validateQuestion, validateSet } from './model';
import AnswerInput from './AnswerInput';
import QuizBoard, { QuizBrand } from './QuizBoard';
import QuizDialog from './QuizDialog';
import MathText from '../components/MathText';
import BankBrowser from './BankBrowser';
import AutoComposer from './AutoComposer';
import { appendBankQuestions, prepareBank, QUIZ_LIMIT } from './bank';
import { VERSION } from '../version';

function readDraft(uid) {try{const data=JSON.parse(localStorage.getItem(`qm-draft:${uid}`));return data && Array.isArray(data.questions) && typeof data.title==='string' ? data : {id:newId(),title:'새 퀴즈 세트',questions:[]};}catch{return {id:newId(),title:'새 퀴즈 세트',questions:[]};}}
export default function Workshop({user,questions,onCreate,importNotice='',onImportNoticeClear}) {
  const [draft,setDraft]=useState(()=>readDraft(user.uid)),[saved,setSaved]=useState([]),[selected,setSelected]=useState(0),[mode,setMode]=useState('simple');
  const [bankOpen,setBankOpen]=useState(false);
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[undo,setUndo]=useState(null),[preview,setPreview]=useState(null),[previewResult,setPreviewResult]=useState('');
  const [options,setOptions]=useState({autoAdvance:false});
  const q=draft.questions[selected];
  const bank=useMemo(()=>prepareBank(questions),[questions]);
  useEffect(()=>{try{localStorage.setItem(`qm-draft:${user.uid}`,JSON.stringify(draft));}catch{/* Manual cloud save remains available. */}},[draft,user.uid]);
  useEffect(()=>{if(!adminRealtime)return undefined;return onValue(ref(adminRealtime,`quizSets/${user.uid}`),s=>setSaved(Object.entries(s.val() || {}).map(([id,item])=>({...item,id})).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))),e=>setMessage(`세트 불러오기 실패: ${e.message}`));},[user.uid]);
  function edit(patch) {setDraft(d=>({...d,questions:d.questions.map((item,i)=>i===selected?{...item,...patch}:item)}));}
  function add(type='choice') {setUndo(draft);setSelected(draft.questions.length);setDraft(d=>({...d,questions:[...d.questions,blankQuestion(type)]}));setMode('custom');}
  function move(index,delta) {const next=[...draft.questions],to=index+delta;if(to<0||to>=next.length)return;[next[index],next[to]]=[next[to],next[index]];setUndo(draft);setDraft({...draft,questions:next});setSelected(to);}
  async function save(copy=false) {
    const errors=validateSet(draft);if(errors.length){setMessage(errors.join('\n'));return;}
    if(!adminRealtime){setMessage('Realtime Database 설정이 필요합니다.');return;}
    setBusy(true);try{const data={...draft,id:copy?newId():draft.id};await set(ref(adminRealtime,`quizSets/${user.uid}/${data.id}`),{...data,updatedAt:serverTimestamp()});setDraft(data);onImportNoticeClear?.();setMessage('문제 세트를 저장했습니다.');}catch(e){setMessage(`저장 실패: ${e.message}`);}finally{setBusy(false);}
  }
  function importQuestions(chosen) {
    if (busy) return;
    const result=appendBankQuestions(draft,chosen);
    if(!result.added)throw new Error('선택한 문제는 이미 초안에 담겨 있어요.');
    setUndo(draft);setDraft(result.draft);setSelected(draft.questions.length);setBankOpen(false);setMode('custom');
    setMessage(`${result.added}문제를 가져왔습니다. 현재 ${result.draft.questions.length}문제입니다.${result.skipped?` 중복 ${result.skipped}문제는 제외했습니다.`:''}`);
  }
  function applyComposition(questions,placement) {
    if(busy)return;
    if(!questions.length||questions.length>QUIZ_LIMIT)throw new Error('구성할 문제 수를 확인해주세요.');
    const next=placement==='replace'?{...draft,questions}:appendBankQuestions(draft,questions).draft;
    if(placement!=='replace'&&next.questions.length!==draft.questions.length+questions.length)throw new Error('중복 문제가 생겼습니다. 다시 미리 구성해주세요.');
    setUndo(draft);setDraft(next);setSelected(placement==='replace'?0:draft.questions.length);
    setMessage(`${questions.length}문제를 ${placement==='replace'?'새로 구성':'추가'}했습니다. 현재 ${next.questions.length}문제입니다.`);
  }
  async function create(){const errors=validateSet(draft);if(errors.length){setMessage(errors.join('\n'));return;}setBusy(true);try{if(!adminRealtime)throw new Error('Realtime Database 설정이 필요합니다.');await set(ref(adminRealtime,`quizSets/${user.uid}/${draft.id}`),{...draft,updatedAt:serverTimestamp()});await onCreate(draft,options);}catch(e){setMessage(`방 만들기 실패: ${e.message}`);}finally{setBusy(false);}}
  return <section className="qm-workshop">
    <header className="qm-title"><QuizBrand subtitle="선생님의 퀴즈 스튜디오"/><small className="qm-version">{VERSION}</small></header>
    <section className="qm-studio-banner"><div><small className="qm-eyebrow">오늘의 수업을 조금 더 즐겁게</small><h1>우리 반 퀴즈를 준비해볼까요?</h1><p>좋은 문제 하나에서 시작되는, 함께 배우는 시간.</p></div><div className="qm-studio-stat"><strong>{draft.questions.length}<small> / 40</small></strong><span>준비된 문제</span></div></section>
    <div className="qm-mode-picker" aria-label="퀴즈 구성 방식"><button className={mode==='simple'?'active':''} aria-pressed={mode==='simple'} onClick={()=>setMode('simple')}><span className="qm-mode-icon" aria-hidden="true">⚡</span><span><strong>단순 모드</strong><small>여러 단원과 문제 수를 정해 한 번에 구성</small></span><i aria-hidden="true">{mode==='simple'?'✓':'→'}</i></button><button className={mode==='custom'?'active':''} aria-pressed={mode==='custom'} onClick={()=>setMode('custom')}><span className="qm-mode-icon" aria-hidden="true">✎</span><span><strong>커스텀 모드</strong><small>다양한 유형으로 직접 만들기</small></span><i aria-hidden="true">{mode==='custom'?'✓':'→'}</i></button></div>
    {importNotice&&<p className="qm-message" role="status">{importNotice} {onImportNoticeClear&&<button type="button" onClick={onImportNoticeClear}>확인</button>}</p>}
    {message&&<p className="qm-message" role="status">{message}</p>}
    <div className="qm-workgrid"><aside className="qm-panel qm-library"><div className="qm-section-head"><h3>내 퀴즈 세트</h3><span className="qm-pill">{saved.length}</span></div><button disabled={busy} onClick={()=>{setUndo(draft);setDraft({id:newId(),title:'새 퀴즈 세트',questions:[]});setSelected(0);}}>새 세트 만들기</button><div className="qm-saved">{!saved.length&&<p className="qm-library-empty">저장한 세트가 여기에 모여요.<br/>한 번 만든 퀴즈를 다음 수업에도!</p>}{saved.map(item=><button key={item.id} disabled={busy} className={draft.id===item.id?'selected':''} onClick={()=>{setUndo(draft);setDraft({...item,questions:item.questions||[]});setSelected(0);}}><b>{item.title}</b><small>{item.questions?.length||0}문제 · 불러오기</small></button>)}</div><small>초안은 이 기기에 자동 보관됩니다. ‘세트 저장’하면 다른 기기에서도 불러올 수 있습니다.</small></aside>
    <div className="qm-panel qm-editor">
      <div className="qm-section-head"><div><small className="qm-eyebrow">{mode==='simple'?'빠르게 구성하기':'나만의 문제 구성'}</small><h2>퀴즈 편집</h2></div><span className="qm-pill">{draft.questions.length}문제</span></div>
      <label>세트 이름<input maxLength={80} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
      <div className="qm-bank-entry"><div><strong>저장해 둔 문제를 바로 가져와요</strong><small>검색하고, 단원별로 고르고, 여러 문제를 한 번에 담으세요.</small></div><button type="button" disabled={busy} onClick={()=>setBankOpen(true)}>문제은행 열기 <span className="qm-pill">{bank.length}</span></button></div>
      <div hidden={mode!=='simple'}><AutoComposer bank={bank} existing={draft.questions} onApply={applyComposition} disabled={busy}/></div>
      <div className="qm-row"><b>{draft.questions.length}문제</b><button disabled={busy||draft.questions.length>=40} onClick={()=>add()}>문제 추가</button><button disabled={!undo||busy} onClick={()=>{setDraft(undo);setSelected(0);setUndo(null);}}>이전 편집으로 되돌리기</button></div>
      <div className="qm-question-strip">{draft.questions.map((item,i)=><button key={item.id} disabled={busy} className={i===selected?'selected':''} onClick={()=>{setSelected(i);}}>{i+1}. {TYPES[item.type]}</button>)}</div>
      {!q&&<div className="qm-editor-empty"><span aria-hidden="true">✎</span><h3>첫 문제부터 시작해요</h3><p>{mode==='simple'?'위에서 단원별 문제 수를 정하거나 문제은행에서 직접 골라보세요.':'문제 유형을 골라 직접 만들어보세요.'}</p><div className="qm-add-types">{Object.entries(TYPES).map(([type,label])=><button key={type} disabled={busy} onClick={()=>add(type)}>＋ {label}</button>)}</div></div>}
      {q&&<fieldset disabled={busy}><legend>{selected+1}번 문제</legend><div className="qm-fields"><label>문제 유형<select value={q.type} onChange={e=>{edit({...blankQuestion(e.target.value),id:q.id,question:q.question,explanation:q.explanation});}}>{Object.entries(TYPES).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label><label>제한시간(초)<input type="number" min="10" max="240" value={q.duration} onChange={e=>edit({duration:Number(e.target.value)})}/></label></div>
      <label>문제<textarea rows="3" maxLength={2000} value={q.question} onChange={e=>edit({question:e.target.value})}/></label><div className="math-edit-preview qm-mini-board"><small>칠판 미리보기</small><MathText text={q.question}/></div>
      {(q.type==='choice'||q.type==='ox')&&<div className="qm-choice-edit">{q.choices.map((c,i)=><label key={i}><input type="radio" name="correct" checked={Number(q.correctIndex)===i} onChange={()=>edit({correctIndex:i})}/><span>{i+1}</span><input aria-label={`${i+1}번 보기`} readOnly={q.type==='ox'} value={c} maxLength={300} onChange={e=>edit({choices:q.choices.map((v,j)=>i===j?e.target.value:v)})}/></label>)}<small>정답 보기의 원을 선택하세요.</small></div>}
      {q.type==='short'&&<label>허용 정답 (줄마다 하나)<textarea value={q.answers.join('\n')} onChange={e=>edit({answers:e.target.value.split('\n')})}/><small>띄어쓰기·영문 대소문자 차이는 자동 허용합니다. 분수와 소수 등 다른 표기는 직접 추가하세요.</small></label>}
      {q.type==='slider'&&<><div className="qm-fields">{[['min','최솟값'],['max','최댓값'],['step','이동 간격'],['target','정답'],['tolerance','허용 오차']].map(([key,label])=><label key={key}>{label}<input type="number" step="any" value={q[key]} onChange={e=>edit({[key]:Number(e.target.value)})}/></label>)}</div><label className="qm-check"><input type="checkbox" checked={q.partial} onChange={e=>edit({partial:e.target.checked})}/>정답에 가까울수록 부분 점수</label></>}
      {q.type==='order'&&<label>카드 내용 (정답 순서대로, 한 줄에 하나)<textarea rows="6" value={q.items.join('\n')} onChange={e=>edit({items:e.target.value.split('\n')})}/><small>2~6개를 입력하세요. 학생에게는 섞어서 보여줍니다.</small></label>}
      <label>해설<textarea rows="2" value={q.explanation} onChange={e=>edit({explanation:e.target.value})}/></label><div className="math-edit-preview"><small>해설 미리보기</small><MathText text={q.explanation}/></div>
      <div className="qm-row"><button onClick={()=>move(selected,-1)} disabled={selected===0}>앞으로</button><button onClick={()=>move(selected,1)} disabled={selected===draft.questions.length-1}>뒤로</button><button onClick={()=>{const errors=validateQuestion(q);if(errors.length){setMessage(errors.join('\n'));return;}setPreview({q,public:publicQuestion(q),mode:'question'});setPreviewResult('');}}>학생 화면 미리보기</button><button onClick={()=>{setUndo(draft);setDraft({...draft,questions:draft.questions.filter((_,i)=>i!==selected)});setSelected(Math.max(0,selected-1));}}>문제 삭제</button></div>
      {validateQuestion(q).length>0&&<p className="qm-validation">{validateQuestion(q).join(' · ')}</p>}
      </fieldset>}

      <div className="qm-launch"><div className="qm-section-head"><h3>수업 준비 마무리</h3><small>저장하고 바로 시작해요</small></div><div className="qm-flow-guide"><strong>시작 연출 → 문제만 3초 → 답변 → 정답 공개</strong><p>답변 시간에는 교사 화면에 문제와 보기, 학생 화면에는 보기·입력만 표시됩니다. 제한시간은 보기가 나올 때부터 셉니다.</p></div><label className="qm-check"><input type="checkbox" checked={options.autoAdvance} onChange={e=>setOptions({...options,autoAdvance:e.target.checked})}/>정답 공개 6초 후 다음 문제 자동 진행</label><div className="qm-row"><button disabled={busy} onClick={()=>save()}>세트 저장</button><button disabled={busy} onClick={()=>save(true)}>복사본 저장</button><button className="qm-primary" disabled={busy||!draft.questions.length} onClick={create}>이 구성으로 방 만들기</button><button disabled={busy||!saved.some(s=>s.id===draft.id)} onClick={async()=>{if(window.prompt('저장된 세트를 삭제하려면 “세트 삭제”를 입력하세요.')!=='세트 삭제')return;try{await remove(ref(adminRealtime,`quizSets/${user.uid}/${draft.id}`));setMessage('저장된 세트를 삭제했습니다. 현재 초안은 남아 있습니다.');}catch(e){setMessage(e.message);}}}>저장 세트 삭제</button></div></div>
    </div></div>
    {bankOpen&&<BankBrowser bank={bank} existing={draft.questions} onImport={importQuestions} onClose={()=>setBankOpen(false)} disabled={busy}/>}
    {preview&&<QuizDialog title="학생 화면 미리보기" onClose={()=>setPreview(null)} className="qm-preview">
      <div className="qm-preview-tabs"><button aria-pressed={preview.mode==='question'} onClick={()=>setPreview({...preview,mode:'question'})}>문제 화면 · 3초</button><button aria-pressed={preview.mode==='answer'} onClick={()=>setPreview({...preview,mode:'answer'})}>답변 화면</button></div>
      <p className="qm-help-text">실제 수업에서는 문제만 3초간 보여준 뒤 답변 화면으로 자동 전환됩니다.</p>
      <QuizBoard question={preview.public} index={selected} total={draft.questions.length} phase={preview.mode==='question'?'preview':'answer'} startAt={preview.mode==='question'?3000:0} endAt={preview.public.duration*1000} showQuestion={preview.mode==='question'} compact={preview.mode==='answer'}/>
      {preview.mode==='answer'&&<div className="qm-panel qm-answer-panel"><AnswerInput key={preview.q.id} question={preview.public} preview onSubmit={a=>{const r=grade(preview.q,a,0);setPreviewResult(`${r.correct?'정답':'정답이 아닙니다'} · ${r.points}점 (속도 최대 기준)`);}}/>{previewResult&&<p className="qm-preview-result" role="status">{previewResult}</p>}</div>}
    </QuizDialog>}
  </section>;
}
