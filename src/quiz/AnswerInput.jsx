import { useState } from 'react';
import MathText from '../components/MathText';
import { sliderValue } from './model';
export default function AnswerInput({question:q,onSubmit,disabled=false,preview=false}) {
  const [choice,setChoice]=useState(null),[text,setText]=useState(''),[index,setIndex]=useState(0),[touched,setTouched]=useState(false);
  const [cards,setCards]=useState(()=>q.cards || []),[selected,setSelected]=useState(null);
  const steps=q.type==='slider' ? Math.floor((q.max-q.min)/q.step+1e-7) : 0;
  const value=q.type==='slider' ? sliderValue(q,index) : 0;
  function move(from,to) { if(disabled || to<0 || to>=cards.length)return;const next=[...cards];next.splice(to,0,next.splice(from,1)[0]);setCards(next);setTouched(true);setSelected(null); }
  const ready=q.type==='choice'||q.type==='ox' ? choice!==null : q.type==='short' ? text.trim().length>0 : q.type==='slider' ? touched : cards.length>0;
  function submit(e) {e.preventDefault();if(!ready||disabled)return;onSubmit(q.type==='choice'||q.type==='ox' ? choice : q.type==='short' ? text : q.type==='slider' ? value : cards.map(c=>c.text));}
  return <form className={`qm-answer qm-type-${q.type}`} onSubmit={submit}>
    {(q.type==='choice'||q.type==='ox') && <div className="qm-choices">{q.choices.map((c,i)=><button type="button" className={choice===i?'selected':''} key={i} disabled={disabled} onClick={()=>setChoice(i)}><b>{q.type==='ox' ? c : ['①','②','③','④','⑤','⑥'][i]}</b>{q.type!=='ox' && <MathText text={c}/>}</button>)}</div>}
    {q.type==='short' && <label>답 입력<input value={text} onChange={e=>setText(e.target.value)} maxLength={200} disabled={disabled} autoComplete="off" placeholder="정답을 입력하세요" /></label>}
    {q.type==='slider' && <div className="qm-slider"><output>{value}</output><div className="qm-slider-controls"><button type="button" aria-label="값 줄이기" disabled={disabled||index<=0} onClick={()=>{setIndex(i=>i-1);setTouched(true);}}>−</button><input aria-label="답 숫자 조절" type="range" min="0" max={steps} step="1" value={index} disabled={disabled} onChange={e=>{setIndex(Number(e.target.value));setTouched(true);}} onPointerDown={()=>!disabled&&setTouched(true)} /><button type="button" aria-label="값 늘리기" disabled={disabled||index>=steps} onClick={()=>{setIndex(i=>i+1);setTouched(true);}}>+</button></div><div className="qm-range-labels"><span>{q.min}</span><span>{q.max}</span></div><small>손잡이 또는 − / +로 값을 정한 뒤 제출하세요.</small></div>}
    {q.type==='order' && <div className="qm-order"><p>카드를 선택한 뒤 다른 위치를 누르거나 ↑ ↓로 옮기세요.</p>{cards.map((card,i)=><div key={card.id} className={selected===i?'selected':''} draggable={!disabled} onDragStart={()=>setSelected(i)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(selected!==null)move(selected,i);}}><button type="button" disabled={disabled} onClick={()=>selected===null?setSelected(i):move(selected,i)}><span className="qm-order-position">{i+1}번째</span><span className="qm-order-value"><MathText text={card.text}/></span></button><button type="button" aria-label={`${card.text} 위로 이동`} disabled={disabled||i===0} onClick={()=>move(i,i-1)}>↑</button><button type="button" aria-label={`${card.text} 아래로 이동`} disabled={disabled||i===cards.length-1} onClick={()=>move(i,i+1)}>↓</button></div>)}</div>}
    <button className="qm-primary qm-submit" disabled={disabled||!ready}>{preview?'미리보기 답 확인':'이 답으로 제출'}</button>
  </form>;
}
