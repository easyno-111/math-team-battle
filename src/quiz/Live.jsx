import { useEffect, useRef, useState } from 'react';
import { get, onValue, ref, runTransaction, serverTimestamp, set, update } from 'firebase/database';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { adminRealtime, prepareStudentAuthPersistence, studentAuth, studentRealtime } from '../realtime';
import RoomQrCode from '../components/RoomQrCode';
import MathText from '../components/MathText';
import AnswerInput from './AnswerInput';
import Workshop from './Workshop';
import { answerLabel, leaderboard, newId, publicQuestion, settleRound, validateSet } from './model';
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
function Results({room,uid}) {
  const rows=leaderboard(room.players,room.scores),mine=rows.find(r=>r.id===uid),result=room.results?.[uid];
  const q=room.reveal;
  const distribution=(q?.type==='choice'||q?.type==='ox')?q.choices.map((label,i)=>({label,count:Object.values(room.results || {}).filter(r=>r.answer===i).length})):null;
  const sliderAnswers=q?.type==='slider'?Object.entries(room.results || {}).filter(([,r])=>typeof r.answer==='number'):[];
  const rise=rows.reduce((best,r)=>(r.maxRise || 0)>(best?.maxRise || 0)?r:best,null);
  const longest=rows.reduce((best,r)=>(r.maxStreak || 0)>(best?.maxStreak || 0)?r:best,null),mostCorrect=rows.reduce((best,r)=>r.correct>(best?.correct || 0)?r:best,null);
  return <div className="qm-results">
    {room.phase==='finished'?<><h2>최종 결과</h2><div className="qm-podium">{rows.slice(0,3).map(p=><article key={p.id}><small>{p.rank}위</small><strong>{p.name}</strong><b>{p.total}점</b></article>)}</div><p>{mostCorrect?`최다 정답: ${mostCorrect.name} (${mostCorrect.correct}개) · `:''}{longest?`최장 연속 정답: ${longest.name} (${longest.maxStreak}개)`:''}{rise?` · 최대 순위 상승: ${rise.name} (+${rise.maxRise}위)`:''}</p></>:<><h3>정답 공개</h3><div className="qm-correct"><MathText text={room.correctLabel || ''}/></div><MathText text={q?.explanation || ''}/></>}
    {result&&<div className={`qm-my-result ${result.correct?'correct':''}`}><strong>{result.correct?'정답!':result.points>0?'가까웠어요!':result.submitted?'다음 문제에 도전!':'미제출'}</strong><b>+{result.points}점</b>{result.streak>=2&&<span className={result.streak>=5?'qm-hot-streak':''}>{result.streak} 연속 정답!</span>}<small>현재 {mine?.rank || '-'}위 · 총 {mine?.total || 0}점 {result.rankChange>0?` · ↑${result.rankChange} 상승`:''}</small></div>}
    <p className="qm-summary">정답 {Object.values(room.results || {}).filter(r=>r.correct).length}명 · 제출 {Object.values(room.results || {}).filter(r=>r.submitted).length}명 / {rows.length}명</p>
    {distribution&&<div className="qm-distribution">{distribution.map((d,i)=><div key={i} className={i===Number(q.correctIndex)?'correct':''}><span>{d.label}</span><meter min="0" max={Math.max(1,Object.keys(room.players || {}).length)} value={d.count}/><b>{d.count}명</b></div>)}</div>}
    {q?.type==='slider'&&<div className="qm-result-slider"><div className="qm-result-track"><b style={{left:`${100*(q.target-q.min)/(q.max-q.min)}%`}}>정답 {q.target}</b>{sliderAnswers.map(([id,r],i)=><i key={id} title={`${r.name}: ${r.answer}`} style={{left:`${Math.max(0,Math.min(100,100*(r.answer-q.min)/(q.max-q.min)))}%`,top:`${25+i%4*9}px`}}/>)}</div><small>{q.min} ~ {q.max} · 점에 각 학생의 제출값을 표시합니다.</small></div>}
    <div className="qm-leaderboard"><h3>실시간 순위 <small>동점은 공동 순위</small></h3>{rows.map(p=><div className={p.id===uid?'mine':''} key={p.id}><b>{p.rank}</b><strong>{p.name}</strong><span>{p.correct}정답</span><b>{p.total}점</b></div>)}</div>
  </div>;
}
export default function QuizHost({user,questions}) {
  const [code,setCode]=useState(()=>localStorage.getItem(`qm-host:${user.uid}`)||''),[room,setRoom]=useState(null),[privateSet,setPrivateSet]=useState(null),[submissions,setSubmissions]=useState({}),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[qrLarge,setQrLarge]=useState(false);
  const [autoPaused,setAutoPaused]=useState(false);
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
    localStorage.setItem(`qm-host:${user.uid}`,roomCode);setCode(roomCode);
  }
  async function act(work) {if(lock.current)return;lock.current=true;setBusy(true);setAutoPaused(false);setMessage('');try{await work();}catch(e){setAutoPaused(true);setMessage(`진행 오류: ${e.message}\n자동 진행을 멈췄습니다. 연결 확인 후 진행 버튼을 다시 눌러주세요.`);}finally{lock.current=false;setBusy(false);}}
  async function nextRound(){await act(async()=>{
    if(privateSet?.code!==code)throw new Error('문제 자료를 불러오는 중입니다.');
    const current=(await get(ref(adminRealtime,`quizRooms/${code}`))).val();if(!current||!['waiting','reveal'].includes(current.phase))return;
    const index=Number(current.index)+1;
    if(index>=privateSet.questions.length){await update(ref(adminRealtime,`quizRooms/${code}`),{phase:'finished'});return;}
    const q=privateSet.questions[index],roundId=newId(),pub=publicQuestion(q);
    await runTransaction(ref(adminRealtime,`quizRooms/${code}`),latest=>!latest||!['waiting','reveal'].includes(latest.phase)||latest.index!==current.index?undefined:{...latest,index,roundId,phase:'preview',question:pub,previewAt:Date.now()+clock.offset,results:null,reveal:null,correctLabel:null,startAt:null,endAt:null});
  });}
  async function openAnswers(){await act(async()=>{const start=Date.now()+clock.offset+3000;await runTransaction(ref(adminRealtime,`quizRooms/${code}`),latest=>latest?.phase!=='preview'?undefined:{...latest,phase:'answer',startAt:start,endAt:start+Number(latest.question.duration)*1000});});}
  async function finishRound(){await act(async()=>{
    const current=(await get(ref(adminRealtime,`quizRooms/${code}`))).val();if(current?.phase!=='answer'||privateSet?.code!==code)return;
    // Close submissions first, then read the final authoritative set; no answer can arrive in between.
    const closed=await runTransaction(ref(adminRealtime,`quizRooms/${code}`),latest=>latest?.roundId!==current.roundId||latest.phase!=='answer'?undefined:{...latest,phase:'grading'});
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
    if(room.phase==='answer'&&clock.now>=room.startAt&&(clock.now>=room.endAt||Object.keys(submissions).filter(id=>room.players?.[id]&&submissions[id].roundId===room.roundId).length>=Object.keys(room.players||{}).length&&Object.keys(room.players||{}).length>0)) void finishRound();
    if(room.options?.autoAdvance&&room.phase==='reveal'&&clock.now>=room.revealedAt+6000)void nextRound();
    if(room.options?.autoAdvance&&room.phase==='preview'&&clock.now>=room.previewAt+5000)void openAnswers();
    },0);return()=>clearTimeout(timer);
    // Effects observe immutable room snapshots; commands guard themselves with transactions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[clock.now,clock.connected,room,privateSet,submissions,code,autoPaused]);
  if(!code)return <div className="qm-root">{message&&<p className="qm-message">{message}</p>}<Workshop user={user} questions={questions} onCreate={create}/></div>;
  if(!room)return <div className="qm-root qm-panel"><p>{message||'방 연결 중…'}</p><button onClick={()=>{setCode('');localStorage.removeItem(`qm-host:${user.uid}`);}}>세트 화면으로</button></div>;
  const players=Object.entries(room.players||{}),submitted=Object.keys(submissions).filter(uid=>room.players?.[uid]&&submissions[uid].roundId===room.roundId).length;
  const url=new URL(window.location.href);url.search='';url.hash='';url.searchParams.set('mode','quizstudent');url.searchParams.set('quiz',code);
  const remaining=Math.max(0,Math.ceil((room.endAt-clock.now)/1000));
  return <section className="qm-root qm-host"><header className="qm-title"><div><small>퀴즈 · 방 {code} · v0.12.2</small><h2>{room.title}</h2></div><b>{room.index+1} / {room.total}</b><span>{clock.connected?'연결됨':'연결 복구 중'}</span></header>{message&&<p className="qm-message">{message}</p>}
    {room.phase==='waiting'?<div className="qm-wait-grid"><div className="qm-panel"><RoomQrCode roomCode={code} joinUrl={url.toString()} onOpenLarge={setQrLarge}/><button onClick={()=>window.open(url.toString(),'_blank','noopener,noreferrer')}>학생 화면 열기</button><p>학생은 이름을 입력하면 입장합니다.</p></div><div className="qm-panel"><h3>참가 학생 {players.length}명</h3><div className="qm-player-grid">{players.map(([uid,p])=><span key={uid}>{p.name}</span>)}</div><button className="qm-primary" disabled={busy||privateSet?.code!==code||!players.length||!clock.connected} onClick={nextRound}>첫 문제 공개</button></div></div>:<div className="qm-panel qm-stage">
    {room.question&& !['finished'].includes(room.phase)&&<><div className="qm-round-head"><b>{room.phase==='preview'?'문제 읽기':room.phase==='grading'?'채점 중':room.phase==='reveal'?'결과 확인':clock.now<room.startAt?`${Math.ceil((room.startAt-clock.now)/1000)}초 후 답변 시작`:`남은 시간 ${remaining}초`}</b><span>{submitted} / {players.length}명 제출</span></div><h2><MathText text={room.question.question}/></h2>{room.question.cards&&<div className="qm-host-choices">{room.question.cards.map(c=><div key={c.id}><MathText text={c.text}/></div>)}</div>}{room.question.type==='slider'&&<p className="qm-scale-info">{room.question.min} ~ {room.question.max} 범위에서 값을 골라주세요. (간격 {room.question.step})</p>}{room.question.choices&&<div className="qm-host-choices">{room.question.choices.map((c,i)=><div key={i}><b>{i+1}</b><MathText text={c}/></div>)}</div>}</>}
    {room.phase==='preview'&&<button className="qm-primary" disabled={busy||!clock.connected} onClick={openAnswers}>답변 시작 (3초 카운트다운)</button>}
    {room.phase==='answer'&&<><div className="qm-player-grid">{players.map(([uid,p])=><span className={submissions[uid]?.roundId===room.roundId?'submitted':''} key={uid}>{p.name} {submissions[uid]?.roundId===room.roundId?'제출':'풀이 중'}</span>)}</div><button disabled={busy||!clock.connected} onClick={finishRound}>답변 마감하고 정답 공개</button></>}
    {room.phase==='grading'&&<button disabled={busy||privateSet?.code!==code||!clock.connected} onClick={()=>act(()=>completeGrading(room))}>채점 재개</button>}
    {['reveal','finished'].includes(room.phase)&&<Results room={room}/>}
    {room.phase==='reveal'&&<button className="qm-primary" disabled={busy||privateSet?.code!==code||!clock.connected} onClick={nextRound}>{room.index+1>=room.total?'최종 결과 보기':'다음 문제'}</button>}
    </div>}
    <div className="qm-row"><button disabled={busy} onClick={()=>{if(window.prompt('방과 답변 기록을 삭제하려면 “방 삭제”를 입력하세요.')!=='방 삭제')return;void act(async()=>{await update(ref(adminRealtime),{[`quizRooms/${code}`]:null,[`quizSecrets/${code}`]:null,[`quizAnswers/${code}`]:null});localStorage.removeItem(`qm-host:${user.uid}`);setCode('');setRoom(null);});}}>방 삭제</button><small>진행 중에는 교사 화면을 열어두세요. 새로고침하면 같은 방으로 복구됩니다.</small></div>
    {qrLarge&&<div className="qm-overlay"><div className="qm-panel"><button onClick={()=>setQrLarge(false)}>닫기</button><RoomQrCode roomCode={code} joinUrl={url.toString()} onOpenLarge={()=>{}}/></div></div>}
  </section>;
}

export function QuizStudent({initialCode='',version='v0.12.2'}) {
  const [user,setUser]=useState(null),[code,setCode]=useState(()=>initialCode||sessionStorage.getItem('qm-student-code')||''),[name,setName]=useState(()=>sessionStorage.getItem('qm-student-name')||''),[activeCode,setActiveCode]=useState(''),[room,setRoom]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[sent,setSent]=useState('');
  const submitLock=useRef(false),clock=useClock(studentRealtime);
  useEffect(()=>{const stop=onAuthStateChanged(studentAuth,setUser);let cancelled=false;prepareStudentAuthPersistence().then(()=>studentAuth.authStateReady()).then(()=>{if(!cancelled&&!studentAuth.currentUser)return signInAnonymously(studentAuth);}).catch(e=>setMessage(`학생 로그인 실패: ${e.message}`));return()=>{cancelled=true;stop();};},[]);
  useEffect(()=>{if(!activeCode||!studentRealtime)return undefined;return onValue(ref(studentRealtime,`quizRooms/${activeCode}`),s=>{setRoom(s.val());if(!s.exists()){setMessage('교사가 방을 닫았습니다.');setActiveCode('');sessionStorage.removeItem('qm-student-code');}},e=>setMessage(e.message));},[activeCode]);
  useEffect(()=>{if(!activeCode||!room?.roundId||!user||!studentRealtime)return undefined;return onValue(ref(studentRealtime,`quizAnswers/${activeCode}/${room.roundId}/${user.uid}`),s=>{if(s.exists())setSent(room.roundId);},e=>setMessage(e.message));},[activeCode,room?.roundId,user]);
  async function join(e){e.preventDefault();if(!studentRealtime||!user){setMessage('연결 준비 후 다시 입장해주세요.');return;}const clean=code.replace(/\D/g,'').slice(0,6);if(clean.length!==6||!name.trim()){setMessage('6자리 방 번호와 이름을 입력하세요.');return;}setBusy(true);setMessage('');try{const data=(await get(ref(studentRealtime,`quizRooms/${clean}`))).val();if(!data)throw new Error('해당 방이 없습니다.');if(!data.players?.[user.uid]){if(data.phase!=='waiting')throw new Error('이미 시작한 방입니다.');if(Object.values(data.players||{}).some(p=>p.name.trim()===name.trim()))throw new Error('같은 이름이 있습니다. 번호를 함께 입력해주세요.');await set(ref(studentRealtime,`quizRooms/${clean}/players/${user.uid}`),{uid:user.uid,name:name.trim().slice(0,20),joinedAt:serverTimestamp()});}sessionStorage.setItem('qm-student-code',clean);sessionStorage.setItem('qm-student-name',name.trim());setActiveCode(clean);}catch(error){setMessage(error.message);}finally{setBusy(false);}}
  async function submit(answer){if(submitLock.current||sent===room.roundId||!clock.connected)return;submitLock.current=true;setBusy(true);setMessage('');try{await set(ref(studentRealtime,`quizAnswers/${activeCode}/${room.roundId}/${user.uid}`),{uid:user.uid,roundId:room.roundId,answer:JSON.stringify(answer),submittedAt:serverTimestamp()});setSent(room.roundId);}catch(e){setMessage(`제출하지 못했습니다. 마감 여부나 연결을 확인하고 다시 제출하세요. (${e.code || '연결 오류'})`);}finally{submitLock.current=false;setBusy(false);}}
  if(!activeCode||!room)return <main className="qm-root qm-student"><form className="qm-panel" onSubmit={join}><small>퀴즈 학생 입장 · {version}</small><h1>함께 퀴즈 풀기</h1><label>방 번호<input inputMode="numeric" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/></label><label>이름<input maxLength={20} value={name} onChange={e=>setName(e.target.value)}/></label><button className="qm-primary" disabled={busy||!user||!clock.connected}>입장 / 이어하기</button>{message&&<p role="status">{message}</p>}</form></main>;
  const submitted=sent===room.roundId,open=room.phase==='answer'&&clock.now>=room.startAt&&clock.now<room.endAt&&clock.connected;
  const me=room.players?.[user?.uid],rank=leaderboard(room.players,room.scores).find(r=>r.id===user?.uid);
  return <main className="qm-root qm-student"><section className="qm-panel"><header className="qm-title"><div><small>{version} · 방 {activeCode}</small><h3>{me?.name || name}</h3></div><b>{rank?.rank || '-'}위 · {rank?.total || 0}점</b></header>{!clock.connected&&<p className="qm-message">연결 복구 중입니다. 제출 버튼은 연결 후 활성화됩니다.</p>}{message&&<p className="qm-message" role="status">{message}</p>}
    {room.phase==='waiting'&&<div className="qm-wait"><h2>입장 완료!</h2><p>{room.title}</p><p>교사가 문제를 시작할 때까지 기다려주세요.</p></div>}
    {['preview','answer','grading'].includes(room.phase)&&room.question&&<><div className="qm-round-head"><b>{room.index+1} / {room.total}</b><strong>{room.phase==='preview'?'문제를 읽어주세요':room.phase==='grading'?'정답 확인 중':clock.now<room.startAt?`${Math.ceil((room.startAt-clock.now)/1000)}초 후 시작`:Math.max(0,Math.ceil((room.endAt-clock.now)/1000))+'초'}</strong></div>{room.options?.showQuestion?<h2><MathText text={room.question.question}/></h2>:<p>교사 화면의 문제를 보고 답하세요.</p>}{submitted?<div className="qm-submitted"><h2>제출 완료</h2><p>모두의 답이 모이면 정답을 공개합니다.</p></div>:<AnswerInput key={room.roundId} question={room.question} disabled={!open||busy} onSubmit={submit}/>}</>}
    {['reveal','finished'].includes(room.phase)&&<Results room={room} uid={user?.uid}/>}
  </section></main>;
}
