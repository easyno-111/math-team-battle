import { useState } from 'react';
import { QUIZ_INTRO_MS } from './flow';

export default function QuizIntro({ introAt, now, total }) {
  // A returning device joins the existing animation rather than replaying it.
  // Freeze the delay at mount; updating it on each clock tick would speed it up.
  const [elapsed] = useState(() => Math.max(0, Math.min(QUIZ_INTRO_MS, now - introAt)));
  const remaining = Math.max(1, Math.ceil((introAt + QUIZ_INTRO_MS - now) / 1000));
  return <section className="qm-intro" aria-label="퀴즈 시작" style={{ '--intro-elapsed': `${-elapsed}ms` }}>
    <div className="qm-intro-cards" aria-hidden="true"><span>A</span><span>?</span><span>B</span></div>
    <p className="qm-intro-kicker">지금부터, 우리 반 퀴즈</p>
    <h1><span>재미있는 퀴즈</span><strong>한번 시작해 볼까요?</strong></h1>
    <div className="qm-intro-rule" aria-hidden="true"/>
    <p className="qm-intro-caption">총 {total}문제 · 문제를 읽고, 보기가 나오면 도전!</p>
    <div className="qm-intro-count" aria-label={`첫 문제까지 ${remaining}초`}><span key={remaining}>{remaining > 3 ? 'READY' : remaining}</span><small>잠시 후 첫 문제가 나와요</small></div>
  </section>;
}
