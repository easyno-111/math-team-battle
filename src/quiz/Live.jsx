import { useEffect, useRef, useState } from 'react';
import { get, onValue, ref, runTransaction, serverTimestamp, set, update } from 'firebase/database';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { adminRealtime, prepareStudentAuthPersistence, studentAuth, studentRealtime } from '../realtime';
import RoomQrCode from '../components/RoomQrCode';
import MathText from '../components/MathText';
import Workshop from './Workshop';
import QuizDialog from './QuizDialog';
import RoundBreakdown from './RoundBreakdown';
import QuizAwards from './QuizAwards';
import QuizRevealEffect from './QuizRevealEffect';
import QuizRoundStage from './QuizRoundStage';
import QuizBoard, { QuizBrand } from './QuizBoard';
import { answerLabel, leaderboard, newId, publicQuestion, settleRound, validateSet } from './model';
import { answerWindowOpen, canAdvanceRound, QUESTION_PREVIEW_MS, quizPhase, roundReadyToGrade, scheduleRound } from './flow';
import { VERSION } from '../version';
import './quiz.css';

function useClock(db) {
  const [clock,setClock]=useState({now:0,offset:0,connected:false});
  useEffect(()=>{if(!db)return undefined;let offset=0,connected=false;
    const refresh=()=>setClock({now:Date.now()+offset,offset,connected});
    const stopOffset=onValue(ref(db,'.info/serverTimeOffset'),s=>{offset=Number(s.val() || 0);refresh();});
    const stopConnected=onValue(ref(db,'.info/connected'),s=>{connected=Boolean(s.val());refresh();});
    const timer=setInterval(refresh,200);return()=>{clearInterval(timer);stopOffset();stopConnected();};
  },[db]);return clock;
}
function Results({ room, uid, canInspect = false, onInspectChange, now }) {
  const rows = leaderboard(room.players, room.scores), mine = rows.find(r => r.id === uid), result = room.results?.[uid];
  const q = room.reveal, finished = room.phase === 'finished';
  const sliderAnswers = q?.type === 'slider' ? Object.entries(room.results || {}).filter(([, r]) => typeof r.answer === 'number') : [];
  const rise = rows.reduce((best, r) => (r.maxRise || 0) > (best?.maxRise || 0) ? r : best, null);
  const longest = rows.reduce((best, r) => (r.maxStreak || 0) > (best?.maxStreak || 0) ? r : best, null);
  const mostCorrect = rows.reduce((best, r) => r.correct > (best?.correct || 0) ? r : best, null);
  return <div className={`qm-results${finished ? ' is-final' : ''}`}>
    <QuizRevealEffect room={room} uid={uid} host={canInspect} now={now}/>
    <QuizAwards room={room} uid={uid} now={now}/>
    <div className="qm-result-main">
      {finished ? <><div className="qm-result-heading"><small>오늘의 퀴즈 완료</small><h2>모두 수고했어요!</h2><p>{room.title}</p></div><div className="qm-highlights">{mostCorrect && <span>최다 정답 <b>{mostCorrect.name}</b><small>{mostCorrect.correct}개</small></span>}{longest && <span>최장 연속 정답 <b>{longest.name}</b><small>{longest.maxStreak}개</small></span>}{rise && <span>최대 순위 상승 <b>{rise.name}</b><small>↑ {rise.maxRise}위</small></span>}</div></> : <><div className="qm-result-heading"><small>정답을 확인해요</small><h2>이렇게 풀면 돼요</h2></div><div className="qm-correct"><span className="qm-correct-icon" aria-hidden="true">✓</span><MathText text={room.correctLabel || ''}/></div>{q?.explanation && <div className="qm-explanation"><small>해설</small><MathText text={q.explanation}/></div>}</>}
      {mine && finished ? <div className="qm-my-result correct"><strong>나의 최종 기록</strong><b>{mine.rank}위 · {mine.total.toLocaleString()}점</b><small>{mine.correct}문제 정답</small></div> : result && <div className={`qm-my-result ${result.correct ? 'correct' : ''}`} role="status"><strong>{result.correct ? '정답이에요!' : result.points > 0 ? '가까웠어요!' : result.submitted ? '다음 문제에 도전!' : '이번 문제는 미제출'}</strong><b>+{result.points.toLocaleString()}<small>점</small></b>{result.streak >= 2 && <span className={result.streak >= 5 ? 'qm-hot-streak' : ''}>{result.streak} 연속 정답!</span>}<small>현재 {mine?.rank || '-'}위 · 총 {mine?.total || 0}점 {result.rankChange > 0 ? ` · ↑${result.rankChange} 상승` : ''}</small></div>}
      {!finished && <><RoundBreakdown room={room} interactive={canInspect} onInspectChange={onInspectChange}/>
        {q?.type === 'slider' && <div className="qm-result-slider"><div className="qm-result-track"><b style={{ left: `${100 * (q.target - q.min) / (q.max - q.min)}%` }}>정답 {q.target}</b>{sliderAnswers.map(([id, r], i) => <i key={id} title={`${r.name}: ${r.answer}`} style={{ left: `${Math.max(0, Math.min(100, 100 * (r.answer - q.min) / (q.max - q.min)))}%`, top: `${25 + i % 4 * 9}px` }}/>)}</div><small>{q.min} ~ {q.max} · 점은 학생들이 제출한 값이에요.</small></div>}
      </>}
    </div>
    <section className="qm-rank-panel"><div className="qm-section-head"><h3>{finished ? '최종 순위' : '실시간 순위'}</h3><small>{rows.length}명 · 동점은 공동 순위</small></div><div className="qm-leaderboard" tabIndex={0} aria-label="학생 순위 목록">{rows.map(p => <div className={p.id === uid ? 'mine' : ''} key={p.id}><b className="qm-rank-number">{p.rank}</b><strong>{p.name}{p.id === uid && <small>나</small>}</strong><span>{p.correct}정답</span><b>{p.total.toLocaleString()}<small>점</small></b></div>)}</div></section>
  </div>;
}
export default function QuizHost({user,questions,importNotice='',onImportNoticeClear}) {
  const [code,setCode]=useState(()=>localStorage.getItem(`qm-host:${user.uid}`)||''),[room,setRoom]=useState(null),[privateSet,setPrivateSet]=useState(null),[submissions,setSubmissions]=useState({}),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[qrLarge,setQrLarge]=useState(false);
  const [autoPaused,setAutoPaused]=useState(false);
  const [inspectingResults,setInspectingResults]=useState(false);
  const lock=useRef(false);const clock=useClock(adminRealtime);
  useEffect(()=>{if(!code||!adminRealtime)return undefined;const stop=onValue(ref(adminRealtime,`quizRooms/${code}`),s=>{const value=s.val();if(!value){setCode('');localStorage.removeItem(`qm-host:${user.uid}`);setRoom(null);}else if(value.hostUid===user.uid)setRoom(value);else{setMessage('이 방의 교사가 아닙니다.');setCode('');}},e=>setMessage(`방 연결 오류: ${e.message}`));
    const secret=onValue(ref(adminRealtime,`quizSecrets/${code}`),s=>setPrivateSet(s.val()?{...s.val(),code}:null),e=>setMessage(`진행 자료 연결 오류: ${e.message}`));return()=>{stop();secret();};
  },[code,user.uid]);
  useEffect(()=>{if(!room?.roundId||!code||!adminRealtime)return undefined;return onValue(ref(adminRealtime,`quizAnswers/${code}/${room.roundId}`),s=>setSubmissions(s.val()||{}),e=>setMessage(e.message));},[code,room?.roundId]);
  async function create(draft,options) {
    if(!adminRealtime)throw new Error('Realtime Database URL을 설정해주세요.');
    const errors=validateSet(draft);if(errors.length)throw new Error(errors.join('\n'));
    let roomCode='';for(let i=0;i<8;i++){const attempt=String(100000+Math.floor(Math.random()*900000));const r=await runTransaction(ref(adminRealtime,`quizRooms/${attempt}`),current=>current?undefined:{hostUid:user.uid,title:draft.title,phase:'waiting',index:-1,total:draft.questions.length,createdAt:serverTimestamp(),options});if(r.committed){roomCode=attempt;break;}}
    if(!roomCode)throw new Error('방 번호 생성에 실패했습니다. 다시 시도하세요.');
    try {await set(ref(adminRealtime,`quizSecrets/${roomCode}`),{hostUid:user.uid,questions:draft.questions,title:draft.title});}
    catch(e){await set(ref(adminRealtime,`quizRooms/${roomCode}`),null).catch(()=>{});throw e;}
    localStorage.setItem(`qm-host:${user.uid}`,roomCode);setCode(roomCode);onImportNoticeClear?.();
  }
  async function act(work) {if(lock.current)return;lock.current=true;setBusy(true);setAutoPaused(false);setMessage('');try{await work();}catch(e){setAutoPaused(true);setMessage(`진행 오류: ${e.message}\n자동 진행을 멈췄습니다. 연결 확인 후 진행 버튼을 다시 눌러주세요.`);}finally{lock.current=false;setBusy(false);}}
  async function nextRound(){await act(async()=>{
    if(privateSet?.code!==code)throw new Error('문제 자료를 불러오는 중입니다.');
    const current=(await get(ref(adminRealtime,`quizRooms/${code}`))).val();if(!current||!['waiting','reveal'].includes(current.phase))return;
    const index=Number(current.index)+1;
    if(index>=privateSet.questions.length){await runTransaction(ref(adminRealtime,`quizRooms/${code}`),latest=>!canAdvanceRound(latest,current)?undefined:{...latest,phase:'finished',finishedAt:Date.now()+clock.offset});return;}
    const q=privateSet.questions[index],roundId=newId(),pub=publicQuestion(q);
    await runTransaction(ref(adminRealtime,`quizRooms/${code}`),latest=>!canAdvanceRound(latest,current)?undefined:scheduleRound(latest,pub,roundId,Date.now()+clock.offset));
  });}
  // Resume a preview created before v0.16. New rounds need no timed DB writes
  // between the intro, question preview and opening the answer window.
  async function openAnswers(){await act(async()=>{await runTransaction(ref(adminRealtime,`quizRooms/${code}`),latest=>{
    const start=Date.now()+clock.offset;
    if(latest?.phase!=='preview'||latest.roundId!==room.roundId||start<latest.previewAt+QUESTION_PREVIEW_MS)return undefined;
    return {...latest,phase:'answer',startAt:start,endAt:start+Number(latest.question.duration)*1000};
  });});}
  async function finishRound(){await act(async()=>{
    const current=(await get(ref(adminRealtime,`quizRooms/${code}`))).val();if(!roundReadyToGrade(current,Date.now()+clock.offset)||privateSet?.code!==code)return;
    // Close submissions first, then read the final authoritative set; no answer can arrive in between.
    const closed=await runTransaction(ref(adminRealtime,`quizRooms/${code}`),latest=>latest?.roundId!==current.roundId||!roundReadyToGrade(latest,Date.now()+clock.offset)?undefined:{...latest,phase:'grading'});
    if(!closed.committed)return;
    await completeGrading(closed.snapshot.val());
  });}
  async function completeGrading(current){
    const answers=(await get(ref(adminRealtime,`quizAnswers/${code}/${current.roundId}`))).val()||{};
    const q=privateSet.questions[current.index],result=settleRound(current,q,answers);
    await runTransaction(ref(adminRealtime,`quizRooms/${code}`),latest=>latest?.roundId!==current.roundId||latest.phase!=='grading'?undefined:{...latest,...result,phase:'reveal',revealedAt:Date.now()+clock.offset,reveal:q,correctLabel:answerLabel(q)});
  }
  useEffect(()=>{
    if(!room||privateSet?.code!==code||!clock.connected||lock.current||autoPaused)return undefined;
    const timer=setTimeout(()=>{
    if(roundReadyToGrade(room,clock.now)) void finishRound();
    if(room.phase==='grading')void act(()=>completeGrading(room));
    if(room.options?.autoAdvance&&!inspectingResults&&room.phase==='reveal'&&clock.now>=room.revealedAt+6000)void nextRound();
    if(room.phase==='preview'&&clock.now>=room.previewAt+QUESTION_PREVIEW_MS)void openAnswers();
    },0);return()=>clearTimeout(timer);
    // Effects observe immutable room snapshots; commands guard themselves with transactions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[clock.now,clock.connected,room,privateSet,code,autoPaused,inspectingResults]);
  if(!code)return <div className="qm-root">{message&&<p className="qm-message">{message}</p>}<Workshop user={user} questions={questions} onCreate={create} importNotice={importNotice} onImportNoticeClear={onImportNoticeClear}/></div>;
  if(!room)return <div className="qm-root qm-panel"><p>{message||'방 연결 중…'}</p><button onClick={()=>{setCode('');localStorage.removeItem(`qm-host:${user.uid}`);}}>세트 화면으로</button></div>;
  const players=Object.entries(room.players||{}),submitted=Object.keys(submissions).filter(uid=>room.players?.[uid]&&submissions[uid].roundId===room.roundId).length;
  const phase=quizPhase(room,clock.now);
  const url=new URL(window.location.href);url.search='';url.hash='';url.searchParams.set('mode','quizstudent');url.searchParams.set('quiz',code);
  return <section className="qm-root qm-host">
    <header className="qm-title qm-live-title"><QuizBrand subtitle={room.title}/><div className="qm-session-meta"><span className={`qm-connection ${clock.connected ? 'online' : ''}`}><i/>{clock.connected ? '연결됨' : '연결 복구 중'}</span><span className="qm-room-pin">방 번호 <b>{code}</b></span><small>{VERSION}</small></div></header>
    {importNotice && <p className="qm-message" role="status">{importNotice}<br/>진행 중인 방은 그대로 유지됩니다. 담은 문제는 다음 퀴즈 초안에서 확인할 수 있어요. {onImportNoticeClear&&<button type="button" onClick={onImportNoticeClear}>확인</button>}</p>}
    {message && <p className="qm-message" role="status">{message}</p>}
    {room.phase === 'waiting' ? <div className="qm-wait-grid">
      <section className="qm-panel qm-join-panel"><small className="qm-eyebrow">오늘의 퀴즈 교실</small><h2>함께 풀 준비됐나요?</h2><p>QR을 찍거나 학생 화면에<br/>방 번호를 입력해주세요.</p><div className="qm-room-code" aria-label={`방 번호 ${code}`}>{code}</div><RoomQrCode roomCode={code} joinUrl={url.toString()} onOpenLarge={setQrLarge}/><button onClick={()=>window.open(url.toString(),'_blank','noopener,noreferrer')}>학생 화면 열기 <span aria-hidden="true">↗</span></button><small>{room.total}문제 · 정확도와 속도로 점수가 올라가요</small></section>
      <section className="qm-panel qm-attendance"><div className="qm-section-head"><div><small className="qm-eyebrow">참가 학생</small><h2>우리 반이 모이고 있어요</h2></div><b className="qm-count-badge">{players.length}<small>명</small></b></div><div className="qm-player-grid" tabIndex={0} aria-label="입장한 학생 목록">{players.length ? players.map(([uid,p],i)=><span key={uid} title={p.name}><b className="qm-player-avatar">{String(i+1).padStart(2,'0')}</b><strong>{p.name}</strong><i aria-hidden="true">✓</i></span>) : <div className="qm-empty-state"><span aria-hidden="true">＋</span><h3>첫 번째 학생을 기다려요</h3><p>입장하면 이곳에 이름이 나타납니다.</p></div>}</div><div className="qm-start-session"><p>모두 입장했으면 첫 문제를 공개해주세요.</p><button className="qm-primary" disabled={busy||privateSet?.code!==code||!players.length||!clock.connected} onClick={nextRound}>퀴즈 시작하기 <span aria-hidden="true">→</span></button></div></section>
    </div> : <div className={`qm-stage${room.phase === 'reveal' ? ' is-reveal' : ''}`}>
      <QuizRoundStage room={room} now={clock.now} submitted={submitted} participants={players.length} followStage/>
      {room.question && room.phase === 'reveal' && <QuizBoard question={room.question} index={room.index} total={room.total} phase="reveal" now={clock.now} submitted={submitted} participants={players.length}/>}
      {room.phase === 'preview' && autoPaused && <div className="qm-control-bar"><p>연결을 확인하고 진행을 재개해주세요.</p><button disabled={busy||!clock.connected||clock.now<room.previewAt+QUESTION_PREVIEW_MS} onClick={openAnswers}>답변 진행 재개</button></div>}
      {phase === 'answer' && <section className="qm-panel qm-response-panel"><div className="qm-section-head"><h3>우리 반의 답변</h3><b>{submitted} <small>/ {players.length}명</small></b></div><progress aria-label="답변 제출 현황" value={submitted} max={Math.max(1,players.length)}/><details><summary>학생별 제출 현황 보기</summary><div className="qm-player-grid">{players.map(([uid,p])=><span className={submissions[uid]?.roundId===room.roundId?'submitted':''} key={uid} title={p.name}><strong>{p.name}</strong><small>{submissions[uid]?.roundId===room.roundId?'✓ 제출':'풀이 중'}</small></span>)}</div></details><div className="qm-control-bar"><small>{submitted===players.length?'모두 제출했어요. ':''}설정한 시간이 끝나면 정답을 공개합니다.</small>{roundReadyToGrade(room,clock.now)&&<button disabled={busy||!clock.connected} onClick={finishRound}>정답 공개 다시 시도</button>}</div></section>}
      {room.phase === 'grading' && <div className="qm-control-bar"><p>제출한 답안을 확인하고 있어요.</p><button disabled={busy||privateSet?.code!==code||!clock.connected} onClick={()=>act(()=>completeGrading(room))}>채점 재개</button></div>}
      {['reveal','finished'].includes(room.phase) && <Results key={room.roundId} room={room} canInspect onInspectChange={setInspectingResults} now={clock.now}/>}
      {room.phase === 'reveal' && <div className="qm-control-bar"><p>{inspectingResults?'학생 명단 확인 중 · 자동 진행을 잠시 멈췄어요.':room.options?.autoAdvance?'잠시 후 다음으로 자동 진행됩니다.':'결과를 함께 확인하고 다음으로 넘어가세요.'}</p><button className="qm-primary" disabled={busy||privateSet?.code!==code||!clock.connected} onClick={nextRound}>{room.index+1>=room.total?'최종 결과 보기':'다음 문제'} <span aria-hidden="true">→</span></button></div>}
    </div>}
    <footer className="qm-session-footer"><small>진행 중에는 교사 화면을 열어두세요. 새로고침해도 같은 방으로 돌아옵니다.</small><button className="qm-text-button" disabled={busy} onClick={()=>{if(window.prompt('방과 답변 기록을 삭제하려면 “방 삭제”를 입력하세요.')!=='방 삭제')return;void act(async()=>{await update(ref(adminRealtime),{[`quizRooms/${code}`]:null,[`quizSecrets/${code}`]:null,[`quizAnswers/${code}`]:null});localStorage.removeItem(`qm-host:${user.uid}`);setCode('');setRoom(null);});}}>방 삭제</button></footer>
    {qrLarge && <QuizDialog title={`방 번호 ${code}`} onClose={()=>setQrLarge(false)} className="qm-qr-modal"><RoomQrCode roomCode={code} joinUrl={url.toString()} onOpenLarge={()=>{}}/></QuizDialog>}
  </section>;
}

export function QuizStudent({initialCode='',version=VERSION}) {
  const [user,setUser]=useState(null),[code,setCode]=useState(()=>initialCode||sessionStorage.getItem('qm-student-code')||''),[name,setName]=useState(()=>sessionStorage.getItem('qm-student-name')||''),[activeCode,setActiveCode]=useState(''),[room,setRoom]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[sent,setSent]=useState('');
  const submitLock=useRef(false),clock=useClock(studentRealtime);
  useEffect(()=>{const stop=onAuthStateChanged(studentAuth,setUser);let cancelled=false;prepareStudentAuthPersistence().then(()=>studentAuth.authStateReady()).then(()=>{if(!cancelled&&!studentAuth.currentUser)return signInAnonymously(studentAuth);}).catch(e=>setMessage(`학생 로그인 실패: ${e.message}`));return()=>{cancelled=true;stop();};},[]);
  useEffect(()=>{if(!activeCode||!studentRealtime)return undefined;return onValue(ref(studentRealtime,`quizRooms/${activeCode}`),s=>{setRoom(s.val());if(!s.exists()){setMessage('교사가 방을 닫았습니다.');setActiveCode('');sessionStorage.removeItem('qm-student-code');}},e=>setMessage(e.message));},[activeCode]);
  useEffect(()=>{if(!activeCode||!room?.roundId||!user||!studentRealtime)return undefined;return onValue(ref(studentRealtime,`quizAnswers/${activeCode}/${room.roundId}/${user.uid}`),s=>{if(s.exists())setSent(room.roundId);},e=>setMessage(e.message));},[activeCode,room?.roundId,user]);
  async function join(e){e.preventDefault();if(!studentRealtime||!user){setMessage('연결 준비 후 다시 입장해주세요.');return;}const clean=code.replace(/\D/g,'').slice(0,6);if(clean.length!==6||!name.trim()){setMessage('6자리 방 번호와 이름을 입력하세요.');return;}setBusy(true);setMessage('');try{const data=(await get(ref(studentRealtime,`quizRooms/${clean}`))).val();if(!data)throw new Error('해당 방이 없습니다.');if(!data.players?.[user.uid]){if(data.phase!=='waiting')throw new Error('이미 시작한 방입니다.');if(Object.values(data.players||{}).some(p=>p.name.trim()===name.trim()))throw new Error('같은 이름이 있습니다. 번호를 함께 입력해주세요.');await set(ref(studentRealtime,`quizRooms/${clean}/players/${user.uid}`),{uid:user.uid,name:name.trim().slice(0,20),joinedAt:serverTimestamp()});}sessionStorage.setItem('qm-student-code',clean);sessionStorage.setItem('qm-student-name',name.trim());setActiveCode(clean);}catch(error){setMessage(error.message);}finally{setBusy(false);}}
  async function submit(answer){if(submitLock.current||!user||!room||sent===room.roundId||!clock.connected||!answerWindowOpen(room,Date.now()+clock.offset))return;submitLock.current=true;setBusy(true);setMessage('');try{await set(ref(studentRealtime,`quizAnswers/${activeCode}/${room.roundId}/${user.uid}`),{uid:user.uid,roundId:room.roundId,answer:JSON.stringify(answer),submittedAt:serverTimestamp()});setSent(room.roundId);}catch(e){setMessage(`제출하지 못했습니다. 마감 여부나 연결을 확인하고 다시 제출하세요. (${e.code || '연결 오류'})`);}finally{submitLock.current=false;setBusy(false);}}
  if(!activeCode||!room)return <main className="qm-root qm-student qm-join-page"><QuizBrand/><form className="qm-panel qm-student-login" onSubmit={join}><div className="qm-login-intro"><span className="qm-eyebrow">LET’S QUIZ</span><h1>오늘도, 한 문제씩<br/>함께 풀어볼까요?</h1><p>선생님이 알려준 방 번호로 입장해요.</p></div><div className="qm-login-fields"><label>방 번호<input className="qm-pin-input" inputMode="numeric" maxLength={6} value={code} placeholder="6자리 번호" required onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/></label><label>이름<input maxLength={20} value={name} required placeholder="친구들이 알아볼 수 있는 이름" onChange={e=>setName(e.target.value)}/></label><button className="qm-primary qm-submit" disabled={busy||!user||!clock.connected}>{busy?'입장하는 중…':'퀴즈 교실 입장'}<span aria-hidden="true">→</span></button>{message&&<p className="qm-message" role="status">{message}</p>}</div></form><small className="qm-version">퀴즈 모드 · {version}</small></main>;
  const submitted=sent===room.roundId;
  const me=room.players?.[user?.uid],rank=leaderboard(room.players,room.scores).find(r=>r.id===user?.uid);
  return <main className="qm-root qm-student"><header className="qm-title qm-student-header"><QuizBrand subtitle={`방 ${activeCode} · ${me?.name || name}`}/><div className="qm-score-badge"><span>내 순위 <b>{rank?.rank || '-'}<small>위</small></b></span><span>누적 점수 <b>{(rank?.total || 0).toLocaleString()}<small>점</small></b></span></div></header>
    {!clock.connected&&<p className="qm-message" role="status">연결 복구 중입니다. 연결되면 다시 제출할 수 있어요.</p>}{message&&<p className="qm-message" role="status">{message}</p>}
    {room.phase==='waiting'&&<section className="qm-student-wait"><div className="qm-welcome-board"><span className="qm-wait-check" aria-hidden="true">✓</span><small>퀴즈 교실 입장 완료</small><h1>{me?.name || name}님,<br/>반가워요!</h1><p>{room.title}</p><div className="qm-wait-status"><i/>선생님이 곧 문제를 시작해요</div></div><div className="qm-wait-tips"><div><b>01</b><strong>문제를 읽어요</strong><small>큰 화면과 내 화면에서 확인</small></div><div><b>02</b><strong>답을 정해요</strong><small>고르고, 적고, 움직여서 풀기</small></div><div><b>03</b><strong>빠르게 제출!</strong><small>정답에 속도 점수까지</small></div></div></section>}
    <QuizRoundStage room={room} now={clock.now} student answerSent={submitted} disabled={!clock.connected||busy} disabledLabel={busy?'답안을 보내는 중…':!clock.connected?'연결 복구 중':''} onSubmit={submit} followStage/>
    {['reveal','finished'].includes(room.phase)&&<Results key={room.roundId} room={room} uid={user?.uid} now={clock.now}/>}
    <footer className="qm-student-footer"><small>퀴즈 모드 · {version}</small><span className={`qm-connection ${clock.connected?'online':''}`}><i/>{clock.connected?'연결됨':'연결 복구 중'}</span></footer>
  </main>;
}
