import { GoogleGenAI } from '@google/genai';
import { checkAndRecordAiRequest } from '../utils/aiSafety';
import { blankQuestion, TYPES, validateQuestion } from './model';
export async function generateQuiz({apiKey,model,prompt,types,source,action='new',advanced}) {
  if (!advanced && !apiKey.trim()) throw new Error('Gemini API 키를 입력하세요.');
  if (!prompt.trim()) throw new Error('원하는 문제와 조건을 입력하세요.');
  if (!types.length || types.length>20) throw new Error('AI 생성은 한 번에 1~20문제로 설정하세요.');
  checkAndRecordAiRequest();
  const ai=advanced?null:new GoogleGenAI({apiKey:apiKey.trim()});
  const instruction=`교사용 퀴즈 초안을 한국어로 작성하세요. 요청한 유형 순서를 지키세요: ${JSON.stringify(types)}.
사용자 요청: ${prompt}
작업: ${action}. 원본: ${JSON.stringify(source || null)}
문제가 요청 유형에 적합하지 않으면 억지 변환하지 말고 questions:[], note에 이유와 대안을 작성하세요.
오직 JSON {"questions":[...],"note":""} 반환.
각 문제 공통 필드: type(choice|ox|short|slider|order), question, explanation, duration(10~240초), category, unit, difficulty(쉬움|보통|어려움|도전).
choice: choices(중복 없는 보기 4개), correctIndex(0부터 시작).
ox: choices:["O","X"], correctIndex:0 또는 1.
short: answers(허용 정답 문자열 배열, 명확한 단답형). 서로 다른 표기만 허용하고 틀린 답은 포함하지 않음.
slider: min,max,step,target,tolerance(정확 채점은0),partial(boolean). target은 범위 내 선택 가능한 값, 범위 중앙이 항상 정답이 되지 않게 구성.
order: items(정답 순서의 서로 다른 카드 문자열 2~6개). 학습적으로 유일한 순서가 성립해야 함.
정답과 해설을 스스로 계산·검증하세요. 현재 정보가 필요한 문제, 애매한 정답, 억지 말장난은 피하세요.
choices 작업은 원본 문제 문장·유형을 유지하고 보기/정답/해설만 수정. explanation 작업은 해설만 수정.
출력 필드에 HTML을 넣지 마세요. 학생이 이해할 짧은 해설, 수식은 $...$로 감싼 LaTeX 사용. 제곱 x^{2}, 분수 \\frac{a}{b}, 루트 \\sqrt{x}로 쓰고 HTML이나 배열 환경은 사용하지 마세요.`;
  let timer;
  try {
    const parsed=advanced ? await advanced({kind:'quiz',prompt:instruction}) : await (async()=>{const response=await Promise.race([ai.models.generateContent({model:model.trim(),contents:instruction,config:{responseMimeType:'application/json',temperature:.55}}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('AI 응답이 지연됩니다. 잠시 후 다시 시도하세요.')),65000);})]);
    return JSON.parse(String(response.text || '').replace(/^```json\s*|```$/g,'').trim());})();
    if (!Array.isArray(parsed.questions) || !parsed.questions.length) throw new Error(parsed.note || '생성된 문제가 없습니다.');
    if (parsed.questions.length!==types.length) throw new Error('요청한 문제 수와 AI 결과 수가 다릅니다. 조건을 줄여 다시 생성하세요.');
    const questions=parsed.questions.map((q,i)=>{
      if (!TYPES[q.type] || q.type!==types[i]) throw new Error(`${i+1}번의 문제 유형이 요청과 다릅니다.`);
      const clean={...blankQuestion(types[i])};
      for(const key of Object.keys(clean)) if(key!=='id' && q[key]!==undefined) clean[key]=q[key];
      for (const key of ['choices','answers','items']) {
        if (!Array.isArray(clean[key]) || clean[key].some(value=>typeof value!=='string')) throw new Error(`${i+1}번의 보기/정답 형식이 잘못되었습니다. 다시 생성하세요.`);
      }
      for (const key of ['question','explanation','category','unit','difficulty']) clean[key]=String(clean[key] || '');
      for (const key of ['correctIndex','min','max','step','target','tolerance','duration']) {clean[key]=Number(clean[key]);if(!Number.isFinite(clean[key]))throw new Error(`${i+1}번의 수치 설정이 올바르지 않습니다.`);}
      clean.partial=clean.partial===true;
      if (source && action==='explanation') return {...source,explanation:String(clean.explanation)};
      if (source && action==='choices') return {...source,choices:clean.choices,correctIndex:clean.correctIndex,explanation:clean.explanation};
      return clean;
    });
    const errors=questions.flatMap((q,i)=>validateQuestion(q).map(e=>`${i+1}번: ${e}`));
    return {questions,errors,note:String(parsed.note || '')};
  } catch(error) {
    if (error instanceof SyntaxError) throw new Error('AI 응답 형식이 올바르지 않습니다. 다시 생성해주세요.', {cause:error});
    throw error;
  } finally {clearTimeout(timer);}
}
