const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {defineSecret,defineString}=require('firebase-functions/params');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getDatabase}=require('firebase-admin/database');
const {validateRequest,reserve,verifyPassword,makeBody,parseResponse,parseSearch,webKinds,searchPrompt,filterGrounded}=require('./policy.cjs');
initializeApp();
const apiKey=defineSecret('OPENAI_API_KEY');
const adminUids=defineString('AI_ADMIN_UIDS',{description:'고급 AI 사용을 허용할 Firebase Authentication 관리자 UID (여러 명은 쉼표로 구분)'});
const authKey=defineString('AUTH_WEB_API_KEY',{description:'같은 Firebase 프로젝트 웹 앱의 apiKey (OpenAI 키 아님)'});
const model=defineString('OPENAI_MODEL',{default:'gpt-4.1'});
exports.generateAdvancedQuestions=onCall({region:'asia-northeast3',secrets:[apiKey],timeoutSeconds:180,memory:'256MiB',maxInstances:2},async request=>{
 const uid=request.auth?.uid;
 if(!uid||request.auth.token.firebase?.sign_in_provider!=='password')throw new HttpsError('unauthenticated','관리자 계정으로 로그인하세요.');
 if(!adminUids.value().split(',').map(v=>v.trim()).filter(Boolean).includes(uid))throw new HttpsError('permission-denied','고급 AI 허용 관리자 UID에 등록되지 않은 계정입니다.');
 let input;
 try{input=validateRequest(request.data);}catch(e){throw new HttpsError('invalid-argument',e.message);}
 const guard=getDatabase().ref(`aiPrivate/guards/${uid}`);
 let owned=false;
 try{
  const user=await getAuth().getUser(uid);
  if(user.disabled||!user.email)throw new HttpsError('permission-denied','사용할 수 없는 관리자 계정입니다.');
  let reason='';
  const reserved=await guard.transaction(state=>{try{return reserve(state,input.requestId,Date.now());}catch(e){reason=e.message;return undefined;}});
  if(!reserved.committed)throw new HttpsError('resource-exhausted',reason||'잠시 후 다시 생성하세요.');
  owned=true;
  let token;
  try{token=await verifyPassword({fetchImpl:fetch,apiKey:authKey.value(),email:user.email,password:input.password,uid});}
  catch{throw new HttpsError('unauthenticated','비밀번호가 올바르지 않거나 인증 설정에 문제가 있습니다. 로그인 비밀번호를 다시 확인하세요.');}
  finally{input.password='';}
  // Verify this is a fresh sign-in to this Firebase project, not another project.
  const verified=await getAuth().verifyIdToken(token,true);
  if(verified.uid!==uid)throw new HttpsError('permission-denied','관리자 계정을 확인할 수 없습니다.');
  async function callOpenAI(body,timeout=90000){
   const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${apiKey.value()}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
  if(!response.ok){
   if(response.status===429)throw new HttpsError('resource-exhausted','OpenAI API 잔액 또는 요청 한도를 확인해주세요. ChatGPT 구독과 API 요금은 별개입니다.');
   if(response.status===401||response.status===403)throw new HttpsError('failed-precondition','서버의 OpenAI API 키와 사용 권한을 확인해주세요.');
   if(response.status===404)throw new HttpsError('failed-precondition','설정한 OpenAI 모델을 사용할 수 없습니다. 서버의 OPENAI_MODEL을 확인하세요.');
   throw new HttpsError('unavailable','OpenAI 응답 오류입니다. 잠시 후 다시 시도하세요.');
  }
   return response.json();
  }
  let sources=[];
  if(webKinds.has(input.kind)){
   const searchData=await callOpenAI({model:model.value(),store:false,max_output_tokens:5000,tools:[{type:'web_search',search_context_size:'low'}],tool_choice:'required',max_tool_calls:1,input:searchPrompt(input.prompt)},40000);
   let search;
   try{search=parseSearch(searchData);}catch(e){throw new HttpsError('failed-precondition',e.message);}
   sources=search.sources;
   input.prompt+=`\n[검색으로 확인한 후보 자료: 이 자료에서 확인된 문제만 재구성]\n${search.text}\n[검색 출처 번호]\n${sources.map((source,i)=>`${i+1}. ${source.title} | ${source.uri}`).join('\n')}`;
  }
  const responseData=await callOpenAI(makeBody(input.kind,input.prompt,model.value()));
  let result;
  try{result=parseResponse(responseData,input.kind);}catch(e){throw new HttpsError('failed-precondition',e instanceof SyntaxError?'AI 응답 형식이 올바르지 않습니다. 다시 생성하세요.':e.message);}
  if(webKinds.has(input.kind))result=filterGrounded(result,sources,input.kind);
  return {result:{...result,_sources:sources},model:model.value()};
 }catch(e){
  // Never log request data, passwords, tokens, or provider response bodies.
  if(e instanceof HttpsError)throw e;
  throw new HttpsError('internal','고급 AI 연결에 실패했습니다. 서버 설정을 확인하고 잠시 후 다시 시도하세요.');
 }finally{
  input.password='';
  if(owned)await guard.transaction(s=>s?.activeId===input.requestId?{...s,activeUntil:0}:undefined).catch(()=>{});
 }
});
