import { useEffect, useRef, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { auth } from '../firebase';
import { PasswordDialog } from '../components/AdvancedAI';

export function useAdvancedAI(){
 const [asking,setAsking]=useState(false);
 const pending=useRef(null),active=useRef(false);
 useEffect(()=>()=>{pending.current?.(null);pending.current=null;},[]);
 function finish(password){const resolve=pending.current;pending.current=null;setAsking(false);resolve?.(password);}
 async function run({kind,prompt}){
  if(active.current)throw new Error('진행 중인 요청을 먼저 완료하세요.');
  if(!auth.currentUser?.email)throw new Error('관리자 계정으로 다시 로그인하세요.');
  active.current=true;
  try{
   const password=await new Promise(resolve=>{pending.current=resolve;setAsking(true);});
   if(password===null)throw new Error('고급 AI 생성을 취소했습니다.');
   const call=httpsCallable(getFunctions(app,'asia-northeast3'),'generateAdvancedQuestions',{timeout:185000});
   const {data}=await call({kind,prompt,password,requestId:crypto.randomUUID()});
   return {...data.result,_aiModel:data.model};
  }catch(e){
   if(['functions/not-found','functions/unavailable','functions/internal'].includes(e.code))throw new Error('OpenAI 서버 연결을 확인해주세요. OPENAI_SETUP.md의 설정 후 Functions를 배포해야 합니다.',{cause:e});
   throw e;
  }finally{active.current=false;}
 }
 return {run,dialog:asking?<PasswordDialog onComplete={finish}/>:null};
}
