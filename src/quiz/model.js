export const TYPES = { choice: '객관식', ox: 'OX', short: '단답형', slider: '숫자 슬라이더', order: '순서 맞추기' };
export const newId = () => crypto.randomUUID();
export function blankQuestion(type = 'choice') {
  return { id:newId(), type, question:'', choices:type === 'ox' ? ['O','X'] : ['','','',''], correctIndex:0, answers:[''], min:0, max:100, step:1, target:50, tolerance:0, partial:false, items:['','',''], explanation:'', duration:30, category:'', unit:'', difficulty:'보통' };
}
export function normalizeText(value) { return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g,'').toLocaleLowerCase('ko'); }
export function validateQuestion(q) {
  const errors=[];
  if (!q || typeof q!=="object") return ["문제 형식을 확인하세요."];
  for(const [field,limit] of [['choices',300],['answers',200],['items',300]]) if(Array.isArray(q[field]) && q[field].some(value=>typeof value!=='string'||value.length>limit)) errors.push(`${field}: 각 항목은 ${limit}자 이내의 글자로 입력하세요.`);
  if (!TYPES[q.type]) errors.push('지원하는 문제 유형을 선택하세요.');
  if (!String(q.question || '').trim()) errors.push('문제를 입력하세요.');
  if (String(q.question || '').length > 2000) errors.push('문제는 2000자 이내로 입력하세요.');
  if (!Number.isFinite(Number(q.duration)) || q.duration<10 || q.duration>240) errors.push('제한시간은 10~240초입니다.');
  if (q.type==='choice' || q.type==='ox') {
    if (!Array.isArray(q.choices) || q.choices.length<2 || q.choices.length>6 || q.choices.some(c=>!String(c).trim())) errors.push('보기 2~6개를 빈칸 없이 입력하세요.');
    if (new Set((Array.isArray(q.choices) ? q.choices : []).map(normalizeText)).size !== q.choices?.length) errors.push('중복 보기를 수정하세요.');
    if (!Number.isInteger(Number(q.correctIndex)) || q.correctIndex<0 || q.correctIndex>=q.choices?.length) errors.push('정답 보기를 선택하세요.');
    if (q.type==='ox' && JSON.stringify(q.choices)!==JSON.stringify(['O','X'])) errors.push('OX 보기는 O, X로 고정됩니다.');
  }
  if (q.type==='short' && (!Array.isArray(q.answers) || !q.answers.length || q.answers.some(a=>!normalizeText(a)))) errors.push('허용 정답을 하나 이상 입력하세요.');
  if (q.type==='slider') {
    const [min,max,step,target,tolerance]=[q.min,q.max,q.step,q.target,q.tolerance].map(Number);
    if (![min,max,step,target,tolerance].every(Number.isFinite) || max<=min || step<=0 || target<min || target>max || tolerance<0) errors.push('범위·간격·정답·허용 오차를 확인하세요.');
    else if (Math.abs((target-min)/step-Math.round((target-min)/step))>1e-7) errors.push('정답을 이동 간격으로 선택할 수 없습니다.');
    if ((max-min)/step>10000) errors.push('슬라이더는 최대 10,000단계로 설정하세요.');
  }
  if (q.type==='order' && (!Array.isArray(q.items) || q.items.length<2 || q.items.length>6 || q.items.some(i=>!String(i).trim()) || new Set(q.items.map(normalizeText)).size!==q.items.length)) errors.push('서로 다른 카드 2~6개를 정답 순서대로 입력하세요.');
  return errors;
}
export function validateSet(set) {
  if (!String(set.title || '').trim() || String(set.title).length>80) return ['세트 이름을 입력하세요.'];
  if (!Array.isArray(set.questions) || !set.questions.length || set.questions.length>40) return ['문제는 1~40개로 구성하세요.'];
  return set.questions.flatMap((q,i)=>validateQuestion(q).map(e=>`${i+1}번: ${e}`));
}
export function shuffle(items) {
  const copy=[...items]; for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];} return copy;
}
export function publicQuestion(q) {
  const base={id:q.id,type:q.type,question:q.question,duration:Number(q.duration)};
  if (q.type==='choice' || q.type==='ox') base.choices=[...q.choices];
  if (q.type==='slider') Object.assign(base,{min:Number(q.min),max:Number(q.max),step:Number(q.step)});
  // Never expose original order through indexes or future question answers.
  if (q.type==='order') {
    const cards=q.items.map(text=>({id:newId(),text}));
    base.cards=shuffle(cards);
    if (base.cards.every((c,i)=>c===cards[i])) base.cards=[...cards.slice(1),cards[0]];
  }
  return base;
}
export function fromBank(q) {
  const choices=Array.isArray(q.choices) ? q.choices : [];
  return {...blankQuestion('choice'),question:String(q.question || ''), choices:choices.map(String), correctIndex:Number(q.correctOption || 1)-1, explanation:q.explanation || '',category:q.category || q.subject || '기존 문제',unit:q.unit || '',difficulty:q.difficulty || '보통'};
}
export function sliderValue(q,index) { return Number((Number(q.min)+Number(index)*Number(q.step)).toPrecision(12)); }
export function grade(q, answer, elapsedMs) {
  let accuracy=0,correct=false;
  if (q.type==='choice' || q.type==='ox') correct=Number.isInteger(answer) && answer===Number(q.correctIndex);
  if (q.type==='short') correct=typeof answer==='string' && (q.answers || []).some(a=>normalizeText(a)===normalizeText(answer));
  if (q.type==='order') correct=Array.isArray(answer) && JSON.stringify(answer)===JSON.stringify(q.items);
  if (q.type==='slider' && typeof answer==='number' && Number.isFinite(answer)) {
    const min=Number(q.min),max=Number(q.max),step=Number(q.step),target=Number(q.target),tol=Number(q.tolerance);
    const inRange=answer>=min-1e-7 && answer<=max+1e-7 && Math.abs((answer-min)/step-Math.round((answer-min)/step))<1e-6;
    if (inRange) {
      const distance=Math.abs(answer-target); correct=distance<=tol+1e-7;
      accuracy=correct ? 1 : q.partial ? Math.max(0,1-(distance-tol)/Math.max(step,max-min)) : 0;
    }
  } else accuracy=correct ? 1 : 0;
  const speed=Math.max(0,Math.min(1,1-Math.max(0,elapsedMs)/(Number(q.duration)*1000)));
  const points=q.type==='slider' ? Math.round(accuracy*(800+200*speed)) : correct ? Math.round(700+300*speed) : 0;
  return {correct,accuracy,points};
}
export function settleRound(room, q, submissions) {
  const scores={...(room.scores || {})},results={};
  for (const [uid,person] of Object.entries(room.players || {})) {
    const row=submissions?.[uid]; let answer=null,elapsedMs=null,result={correct:false,accuracy:0,points:0};
    const time=Number(row?.submittedAt);
    if (row && row.roundId===room.roundId && Number.isFinite(time) && time>=room.startAt && time<=room.endAt) {
      try {answer=JSON.parse(row.answer);result=grade(q,answer,time-room.startAt);if(answer!==null)elapsedMs=time-room.startAt;} catch { /* Invalid answers earn zero. */ }
    }
    const previous=scores[uid] || {total:0,correct:0,streak:0,maxStreak:0};
    const streak=result.correct ? Number(previous.streak || 0)+1 : 0;
    scores[uid]={total:Number(previous.total || 0)+result.points,correct:Number(previous.correct || 0)+(result.correct?1:0),streak,maxStreak:Math.max(Number(previous.maxStreak || 0),streak)};
    results[uid]={...result,answer,name:person.name,submitted:answer!==null,streak,elapsedMs,roundId:room.roundId};
  }
  const before=leaderboard(room.players,room.scores),after=leaderboard(room.players,scores);
  for(const row of after){
    const rankChange=(before.find(p=>p.id===row.id)?.rank || row.rank)-row.rank;
    results[row.id].rankChange=rankChange;
    scores[row.id].maxRise=Math.max(Number(room.scores?.[row.id]?.maxRise || 0),rankChange);
  }
  return {scores,results};
}
export function leaderboard(players={},scores={}) {
  const rows=Object.entries(players).map(([id,p])=>({id,name:p.name,...(scores[id] || {total:0,correct:0,streak:0,maxStreak:0})})).sort((a,b)=>b.total-a.total || a.name.localeCompare(b.name,'ko') || a.id.localeCompare(b.id));
  let rank=0;return rows.map((p,i)=>{if(!i || p.total!==rows[i-1].total)rank=i+1;return {...p,rank};});
}
export function answerLabel(q) {
  if (q.type==='choice' || q.type==='ox') return q.choices[q.correctIndex];
  if (q.type==='short') return q.answers.join(' / ');
  if (q.type==='slider') return `${q.target}${Number(q.tolerance)>0 ? ` (±${q.tolerance})` : ''}`;
  return q.items.join(' → ');
}
