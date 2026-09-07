const string={type:'string'}, integer={type:'integer'}, number={type:'number'};
const array=(items,minItems=1,maxItems=20)=>({type:'array',items,minItems,maxItems});
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const base={category:string,unit:string,difficulty:{type:'string',enum:['쉬움','보통','어려움','도전']},question:string,explanation:string};
const bank={...base,choices:array(string,4,4),correctOption:{type:'integer',minimum:1,maximum:4}};
const common={...base,duration:{type:'integer',minimum:10,maximum:240}};
const types=['choice','ox','short','slider','order'];
const quizVariants={
 choice:{choices:array(string,4,4),correctIndex:{type:'integer',minimum:0,maximum:3}},
 ox:{choices:array({type:'string',enum:['O','X']},2,2),correctIndex:{type:'integer',minimum:0,maximum:1}},
 short:{answers:array(string,1,20)},
 slider:{min:number,max:number,step:number,target:number,tolerance:number,partial:{type:'boolean'}},
 order:{items:array(string,2,6)}
};
const schemas={
 bank:object({questions:array(object(bank))}),
 variant:object({variants:array(object({...bank,parentIndex:{type:'integer',minimum:1,maximum:10}}))}),
 review:object({reviews:array(object({index:integer,valid:{type:'boolean'},note:string}))}),
 quiz:object({questions:array({anyOf:types.map(type=>object({...common,type:{type:'string',enum:[type]},...quizVariants[type]}))},0),note:string})
};
schemas.bankWeb=schemas.bank;
function assertShape(value,schema){
 if(schema.anyOf){if(!schema.anyOf.some(s=>{try{assertShape(value,s);return true;}catch{return false;}}))throw Error('AI 문제 유형 형식이 잘못되었습니다.');return;}
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('AI 응답 객체가 없습니다.');
  for(const key of schema.required)if(!(key in value))throw Error('AI 응답 필드가 누락되었습니다.');
  for(const key of Object.keys(value)){if(!(key in schema.properties))throw Error('허용하지 않는 AI 응답 필드입니다.');assertShape(value[key],schema.properties[key]);}
 }else if(schema.type==='array'){
  if(!Array.isArray(value)||value.length<schema.minItems||value.length>schema.maxItems)throw Error('AI 응답 개수가 잘못되었습니다.');
  value.forEach(v=>assertShape(v,schema.items));
 }else{
  if(schema.type==='integer'?!Number.isInteger(value):typeof value!==schema.type)throw Error('AI 응답 값의 형식이 잘못되었습니다.');
  if(typeof value==='string'&&value.length>10000)throw Error('AI 응답이 너무 깁니다.');
  if(schema.enum&&!schema.enum.includes(value)||schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum)throw Error('AI 응답 값이 범위를 벗어났습니다.');
 }
}
function validateRequest(data){
 if(!data||!Object.hasOwn(schemas,data.kind))throw Error('지원하지 않는 생성 작업입니다.');
 if(typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>40000)throw Error('생성 요청은 1~40,000자로 입력하세요.');
 if(typeof data.password!=='string'||!data.password||data.password.length>4096)throw Error('생성할 때마다 로그인 비밀번호를 입력하세요.');
 if(!/^[a-zA-Z0-9-]{16,80}$/.test(data.requestId||''))throw Error('새 생성 요청이 필요합니다.');
 return {kind:data.kind,prompt:data.prompt,password:data.password,requestId:data.requestId};
}
function reserve(state,requestId,now){
 const day=new Date(now).toISOString().slice(0,10);
 const s=state&&state.day===day?state:{day,count:0,minute:[],ids:[],activeUntil:0};
 if((s.ids||[]).includes(requestId))throw Error('이미 처리한 요청입니다. 새로 생성하려면 비밀번호를 다시 입력하세요.');
 if(s.activeUntil>now)throw Error('이 계정에서 생성 중입니다. 완료 후 다시 시도하세요.');
 const minute=(s.minute||[]).filter(t=>now-t<60000);
 if(minute.length>=3||s.count>=60)throw Error('고급 AI 한도에 도달했습니다. 분당 3회, 하루 60회까지 요청할 수 있습니다.');
 return {day,count:s.count+1,minute:[...minute,now],ids:[...(s.ids||[]),requestId],activeUntil:now+210000,activeId:requestId};
}
async function verifyPassword({fetchImpl,apiKey,email,password,uid}){
 const response=await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true}),signal:AbortSignal.timeout(15000)});
 const result=await response.json();
 if(!response.ok||result.localId!==uid||!result.idToken)throw Error('로그인 비밀번호를 확인해주세요.');
 return result.idToken;
}
function makeBody(kind,prompt,model){return {model,store:false,max_output_tokens:16000,instructions:'교사용 퀴즈 초안을 한국어로 만드세요. 정답이 유일한지 직접 풀어 확인하고 짧은 해설을 쓰세요. 모든 수식은 $...$로 감싼 LaTeX를 사용하세요. 분수는 \\frac{a}{b}, 루트는 \\sqrt{x}, 제곱은 x^{2}. HTML, 매크로, 배열 환경은 사용하지 마세요. 수식은 JSON 문자열 안에서 역슬래시를 올바르게 이스케이프하세요. 자료가 부족하면 사실이나 출처를 지어내지 마세요.',input:prompt,text:{format:{type:'json_schema',name:`quiz_${kind}`,strict:true,schema:schemas[kind]}}};}
function parseResponse(data,kind){
 if(data.status!=='completed')throw Error('AI 응답이 끝까지 생성되지 않았습니다. 문제 수를 줄여 다시 시도하세요.');
 const content=(data.output||[]).flatMap(item=>item.content||[]);
 if(content.some(c=>c.type==='refusal'))throw Error('이 요청으로는 문제를 생성할 수 없습니다. 요청 내용을 바꿔주세요.');
 const parsed=JSON.parse(content.filter(c=>c.type==='output_text').map(c=>c.text).join(''));
 assertShape(parsed,schemas[kind]);return parsed;
}
function parseSearch(data){
 const content=(data.output||[]).flatMap(item=>item.content||[]);
 const text=content.filter(c=>c.type==='output_text').map(c=>c.text).join('\n');
 const sources=content.flatMap(c=>c.annotations||[]).filter(a=>a.type==='url_citation'&&/^https?:\/\//.test(a.url||'')).map(a=>({uri:a.url,title:a.title||a.url}));
 if(data.status!=='completed'||!text||!sources.length)throw Error('검색 출처를 확인하지 못했습니다. 넌센스 문제를 새로 지어내지 않고 생성을 중단했습니다.');
 return {text:text.slice(0,18000),sources:[...new Map(sources.map(s=>[s.uri,s])).values()].slice(0,8)};
}
module.exports={schemas,validateRequest,reserve,verifyPassword,makeBody,parseResponse,parseSearch};
