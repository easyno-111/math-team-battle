import { useEffect, useRef } from 'react';
import AnswerInput from './AnswerInput';
import QuizBoard from './QuizBoard';
import QuizIntro from './QuizIntro';
import { answerWindowOpen, quizPhase } from './flow';

export default function QuizRoundStage({ room, now, student = false, submitted, participants, answerSent = false, disabled = false, disabledLabel = '', onSubmit, followStage = false }) {
  const phase = quizPhase(room, now), stage = useRef(null);
  useEffect(() => {
    if (followStage && ['intro', 'preview', 'answer'].includes(phase)) {
      stage.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }, [room.roundId, phase, followStage]);
  if (phase === 'intro') return <div ref={stage} className="qm-round-stage"><QuizIntro key={`${room.roundId}:${now > 0 ? 'ready' : 'pending'}`} introAt={room.introAt} now={now} total={room.total}/></div>;
  if (!room.question || !['preview', 'answer', 'grading'].includes(phase)) return null;
  const open = answerWindowOpen(room, now);
  const label = disabledLabel || (phase === 'grading' ? '정답 확인 중' : '답변 마감');
  return <div ref={stage} className={`qm-round-stage is-${phase}${student ? ' is-student' : ''}`}>
    <QuizBoard question={room.question} index={room.index} total={room.total} phase={phase} now={now}
      previewAt={room.previewAt} startAt={room.startAt} endAt={room.endAt}
      submitted={submitted} participants={participants}
      showQuestion={!student || phase === 'preview'} compact={student && phase !== 'preview'}
      showChoices={!student && ['answer', 'grading'].includes(phase)}/>
    {student && phase !== 'preview' && (answerSent ? <div className="qm-submitted" role="status">
      <span className="qm-wait-check" aria-hidden="true">✓</span><h2>답안이 도착했어요!</h2>
      <p>남은 시간이 끝나면 정답을 공개해요.</p><small>큰 화면을 보며 풀이를 생각해보세요.</small>
    </div> : <div className="qm-panel qm-answer-panel">
      <AnswerInput key={room.roundId} question={room.question} disabled={!open || disabled} disabledLabel={label} onSubmit={onSubmit}/>
    </div>)}
  </div>;
}
