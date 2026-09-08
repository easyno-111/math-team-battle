import MathText from '../components/MathText';
import { TYPES } from './model';

export function QuizBrand({ subtitle = '함께 풀고, 함께 성장하는 시간' }) {
  return <div className="qm-brand">
    <span className="qm-brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><rect x="4" y="5" width="24" height="19" rx="3" stroke="currentColor" strokeWidth="2"/><path d="m11 15 3 3 7-8M10 28h12M16 24v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
    <div><strong>퀴즈 모드</strong><small>{subtitle}</small></div>
  </div>;
}

export function ChoiceMark({ index }) {
  return <span className="qm-choice-mark">{['A', 'B', 'C', 'D', 'E', 'F'][index] || index + 1}</span>;
}

export default function QuizBoard({ question: q, index = 0, total = 1, phase = 'preview', now = 0, startAt = 0, endAt = 0, showQuestion = true, submitted, participants, showChoices = false }) {
  const counting = phase === 'answer' && now < startAt;
  const answering = phase === 'answer' && !counting;
  const seconds = Math.max(0, Math.ceil(((counting ? startAt : endAt) - now) / 1000));
  const ratio = answering ? Math.max(0, Math.min(1, (endAt - now) / (Math.max(1, Number(q.duration) || 30) * 1000))) : phase === 'preview' || counting ? 1 : 0;
  const urgent = answering && seconds <= 5;
  const status = phase === 'preview' ? '문제 읽는 시간' : phase === 'grading' ? '정답 확인 중' : phase === 'reveal' ? '정답 공개' : counting ? '곧 시작해요' : seconds > 0 ? '답을 골라주세요' : '답변 마감';
  return <section className={`qm-board is-${phase}${urgent ? ' is-urgent' : ''}`} aria-label="퀴즈 문제">
    <div className="qm-board-top"><div className="qm-board-meta"><span className="qm-question-number">문제 {String(index + 1).padStart(2, '0')}<small> / {total}</small></span><span className="qm-type-chip">{TYPES[q.type]}</span></div>
      <div className={`qm-clock${counting ? ' is-countdown' : ''}`}><small>{counting ? '시작까지' : answering ? '남은 시간' : '지금은'}</small><strong>{phase === 'answer' ? <>{seconds}<span>초</span></> : phase === 'preview' ? 'READY' : phase === 'grading' ? '채점 중' : 'RESULT'}</strong></div>
    </div>
    <div className="qm-board-question"><h2><MathText text={showQuestion ? q.question : '교사 화면의 문제를 확인하세요.'}/></h2>{!showQuestion && <p>답은 아래에서 선택해 제출해요.</p>}</div>
    <div className="qm-board-footer"><span><i aria-hidden="true"/>{status}</span>{typeof participants === 'number' ? <span><b>{submitted || 0}</b> / {participants}명 제출</span> : <span>{q.type === 'order' ? '순서대로 놓고 제출해요' : q.type === 'slider' ? '움직여서 정답을 찾아요' : '정확하게 풀고, 빠르게 도전!'}</span>}</div>
    <div className="qm-time-track" role="progressbar" aria-label="남은 답변 시간" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}><span style={{ transform: `scaleX(${ratio})` }}/></div>
    {showChoices && <div className="qm-board-options">
      {q.choices && <div className="qm-host-choices">{q.choices.map((choice, i) => <div key={i} data-choice={i}><ChoiceMark index={i}/><MathText text={choice}/></div>)}</div>}
      {q.cards && <div className="qm-host-choices qm-host-order">{q.cards.map(card => <div key={card.id}><span className="qm-card-grip" aria-hidden="true">⠿</span><MathText text={card.text}/></div>)}</div>}
      {q.type === 'slider' && <p className="qm-scale-info">{q.min} <span>← 값을 골라주세요 →</span> {q.max}<small>이동 간격 {q.step}</small></p>}
      {q.type === 'short' && <p className="qm-scale-info"><span>학생 기기에 정답을 직접 입력하세요.</span></p>}
    </div>}
  </section>;
}
