import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { auth } from '../firebase';

export function ProviderPicker({value,onChange,disabled=false}) {
  return <div className="ai-provider-grid"><button type="button" disabled={disabled} aria-pressed={value==='gemini'} className={`ai-provider-card ${value==='gemini'?'selected':''}`} onClick={()=>onChange('gemini')}><span>기본</span><b>Gemini</b><small>개인 API 키 사용</small></button><button type="button" disabled={disabled} aria-pressed={value==='openai'} className={`ai-provider-card ${value==='openai'?'selected':''}`} onClick={()=>onChange('openai')}><span>고급</span><b>OpenAI</b><small>생성마다 비밀번호 확인</small></button></div>;
}
export function PasswordDialog({onComplete}) {
  const dialog=useRef(null),input=useRef(null);
  const [password,setPassword]=useState('');
  useEffect(()=>{const node=dialog.current;node.showModal();input.current?.focus();return()=>node.close();},[]);
  return createPortal(<dialog className="advanced-ai-dialog" ref={dialog} aria-labelledby="advanced-ai-title" onCancel={e=>{e.preventDefault();onComplete(null);}}><form onSubmit={e=>{e.preventDefault();if(password){onComplete(password);setPassword('');}}}>
    <h3 id="advanced-ai-title">고급 AI 생성 확인</h3><p>관리자 로그인에 사용한 비밀번호를 입력하세요.</p><p className="advanced-ai-note">이번 요청에 OpenAI API 사용료가 발생합니다. 비밀번호는 저장하지 않습니다.</p>
    <label>로그인 비밀번호<input ref={input} type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)} required maxLength={4096}/></label>
    <div className="advanced-ai-actions"><button type="button" onClick={()=>onComplete(null)}>취소</button><button className="primary-button" disabled={!password} type="submit">비밀번호 확인 후 생성</button></div>
  </form></dialog>,document.body);
}
export function AdvancedHelp() {
 return <div className="advanced-ai-note"><p>OpenAI API는 서버에 등록한 키로 연결합니다. ChatGPT 구독과 API 요금은 별개입니다.</p><p>최초 연결: 패치의 OPENAI_SETUP.md 안내를 따라 설정하세요.</p><small>현재 관리자 UID: <code>{auth.currentUser?.uid || '로그인 필요'}</code></small></div>;
}
