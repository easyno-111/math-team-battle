import { useEffect, useMemo, useState } from 'react';
import MathText from '../components/MathText';
import { ChoiceMark } from './QuizBoard';
import { responseGroup, roundAnalytics } from './roundResults';

export default function RoundBreakdown({ room, interactive = false, onInspectChange }) {
  const analytics = useMemo(() => roundAnalytics(room), [room]);
  const [selection, setSelection] = useState(null);
  const roundKey = room.roundId || String(room.index ?? room.reveal?.id ?? 'round');
  const selectedKey = selection?.roundKey === roundKey ? selection.key : null;
  const selectedGroup = selectedKey ? responseGroup(analytics, selectedKey) : null;
  const inspectorId = `qm-response-${roundKey}`;
  useEffect(() => () => { onInspectChange?.(false); }, [onInspectChange]);
  if (!analytics.ready) return null;
  function inspect(key) {
    const next = selectedKey === key ? null : key;
    setSelection(next ? { roundKey, key: next } : null); onInspectChange?.(Boolean(next));
  }
  const metrics = [
    { key: 'correct', label: '정답 비율', value: `${analytics.correctPercent}%`, detail: `${analytics.correct}명 정답` },
    { key: 'wrong', label: '오답·부분 점수', value: `${analytics.wrong}명`, detail: '제출한 답안 기준' },
    { key: 'missing', label: '미제출', value: `${analytics.missing}명`, detail: '답안을 내지 않은 학생' },
  ];
  return <section className="qm-round-breakdown" aria-label="이번 문제 답변 분석">
    <div className="qm-response-metrics">{metrics.map(metric => {
      const content = <><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small>{interactive && <i aria-hidden="true">명단 {selectedKey === metric.key ? '접기 −' : '보기 +'}</i>}</>;
      return interactive ? <button type="button" className={selectedKey === metric.key ? 'active' : ''} key={metric.key} onClick={() => inspect(metric.key)} aria-expanded={selectedKey === metric.key} aria-controls={inspectorId}>{content}</button> : <div key={metric.key}>{content}</div>;
    })}</div>
    <p className="qm-response-caption">전체 참가 {analytics.total}명 기준 · 미제출 포함{interactive ? ' · 비율이나 답안을 누르면 학생 명단이 열려요.' : ''}</p>
    <div className="qm-response-distribution">{analytics.groups.map(group => {
      const percent = analytics.total ? Math.round(group.rows.length / analytics.total * 100) : 0;
      const content = <>{group.choiceIndex !== undefined ? <ChoiceMark index={group.choiceIndex}/> : <span className="qm-answer-dot" aria-hidden="true"/>}<span className="qm-response-label"><MathText text={group.label}/>{group.correct && <small>정답</small>}</span><span className="qm-response-bar" aria-hidden="true"><span style={{ width: `${percent}%` }}/></span><strong>{group.rows.length}명<small>{percent}%</small></strong>{interactive && <span className="qm-response-more" aria-hidden="true">{selectedKey === group.key ? '−' : '+'}</span>}</>;
      const className = `${group.correct ? 'correct ' : ''}${selectedKey === group.key ? 'is-selected' : ''}`;
      return interactive ? <button type="button" key={group.key} className={className} aria-label={`${group.choiceIndex !== undefined ? String.fromCharCode(65 + group.choiceIndex) + ' 보기' : group.label} ${group.rows.length}명, 학생 명단 보기`} aria-expanded={selectedKey === group.key} aria-controls={inspectorId} onClick={() => inspect(group.key)}>{content}</button> : <div key={group.key} className={className}>{content}</div>;
    })}</div>
    {interactive && selectedGroup && <section id={inspectorId} className="qm-response-inspector" aria-label="선택한 답변의 학생 명단"><div className="qm-section-head"><div><small>선택한 답변의 학생</small><h4><MathText text={selectedGroup.label}/> <span>{selectedGroup.rows.length}명</span></h4></div><button type="button" onClick={() => inspect(selectedKey)}>명단 닫기</button></div>{room.options?.autoAdvance && <p className="qm-inspect-pause">명단을 보는 동안 자동 진행을 잠시 멈춥니다. 닫으면 이어서 진행해요.</p>}<div className="qm-response-students" tabIndex={0} aria-label="학생별 제출 답안">{selectedGroup.rows.length ? selectedGroup.rows.map(row => <article key={row.uid}><div><strong>{row.name}</strong><small className={row.correct ? 'correct' : ''}>{row.correct ? '정답' : !row.submitted ? '미제출' : row.points > 0 ? '부분 점수' : '오답'}</small></div><p><MathText text={row.label}/></p><b>+{row.points.toLocaleString()}점</b></article>) : <p className="qm-empty-responses">해당하는 학생이 없습니다.</p>}</div></section>}
  </section>;
}
