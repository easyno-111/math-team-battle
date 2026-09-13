import MathText from '../components/MathText';
import { TYPES } from './model';
import { QUESTION_PREVIEW_MS } from './flow';

export function QuizBrand({ subtitle = '함께 풀고, 함께 성장하는 시간' }) {
  return <div className="qm-brand">
    <span className="qm-brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><rect x="4" y="5" width="24" height="19" rx="3" stroke="currentColor" strokeWidth="2"/><path d="m11 15 3 3 7-8M10 28h12M16 24v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
    <div><strong>퀴즈 모드</strong><small>{subtitle}</small></div>
  </div>;
}

export function ChoiceMark({ index }) {
  return <span className="qm-choice-mark">{['A', 'B', 'C', 'D', 'E', 'F'][index] || index + 1}</span>;
}

export default function QuizBoard({ question: q, index = 0, total = 1, phase = 'preview', now = 0, previewAt = 0, startAt = 0, endAt = 0, showQuestion = true, compact = false, submitted, participants, showChoices = false }) {
  const counting = phase === 'preview' || (phase === 'answer' && now < startAt);
  const answering = phase === 'answer' && !counting;
  const previewEnd = startAt || (previewAt ? previewAt + QUESTION_PREVIEW_MS : 0);
  const seconds = Math.max(0, Math.ceil(((counting ? previewEnd : endAt) - now) / 1000));
  const ratio = Math.max(0, Math.min(1, counting ? previewEnd ? (previewEnd - now) / QUESTION_PREVIEW_MS : 1 : answering ? (endAt - now) / (Math.max(1, Number(q.duration) || 30) * 1000) : 0));
  const urgent = answering && seconds <= 5;
  const status = counting ? '문제 먼저! 잠시 후 보기가 나와요' : phase === 'grading' ? '정답 확인 중' : phase === 'reveal' ? '정답 공개' : seconds > 0 ? '답을 골라주세요' : '답변 마감 · 정답을 확인하고 있어요';
  return <section className={`qm-board is-${phase}${urgent ? ' is-urgent' : ''}${compact ? ' is-compact' : ''}`} aria-label={compact ? '답변 시간' : '퀴즈 문제'}>
    <div className="qm-board-top"><div className="qm-board-meta"><span className="qm-question-number">문제 {String(index + 1).padStart(2, '0')}<small> / {total}</small></span><span className="qm-type-chip">{TYPES[q.type]}</span></div>
      <div className={`qm-clock${counting ? ' is-countdown' : ''}`}><small>{counting ? '보기 공개까지' : answering ? '남은 시간' : '지금은'}</small><strong>{answering || counting && previewEnd ? <>{seconds}<span>초</span></> : counting ? 'READY' : phase === 'grading' ? '채점 중' : 'RESULT'}</strong></div>
    </div>
    {showQuestion && <div className="qm-board-question"><h2><MathText text={q.question}/></h2></div>}
    <div className="qm-board-footer"><span><i aria-hidden="true"/>{status}</span>{typeof participants === 'number' ? <span><b>{submitted || 0}</b> / {participants}명 제출</span> : !counting && <span>{compact ? '문제는 큰 화면에서' : q.type === 'order' ? '순서대로 놓고 제출해요' : q.type === 'slider' ? '움직여서 정답을 찾아요' : '정확하게 풀고, 빠르게 도전!'}</span>}</div>
    <div className="qm-time-track" role="progressbar" aria-label={counting ? '보기 공개까지 남은 시간' : '남은 답변 시간'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}><span style={{ transform: `scaleX(${ratio})` }}/></div>
    {showChoices && !counting && <div className="qm-board-options">
      {q.choices && <div className="qm-host-choices">{q.choices.map((choice, i) => <div key={i} data-choice={i}><ChoiceMark index={i}/><MathText text={choice}/></div>)}</div>}
      {q.cards && <div className="qm-host-choices qm-host-order">{q.cards.map(card => <div key={card.id}><span className="qm-card-grip" aria-hidden="true">⠿</span><MathText text={card.text}/></div>)}</div>}
      {q.type === 'slider' && <p className="qm-scale-info">{q.min} <span>← 값을 골라주세요 →</span> {q.max}<small>이동 간격 {q.step}</small></p>}
      {q.type === 'short' && <p className="qm-scale-info"><span>학생 기기에 정답을 직접 입력하세요.</span></p>}
    </div>}
  </section>;
}
