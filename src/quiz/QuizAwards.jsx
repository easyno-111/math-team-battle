import { useEffect, useState } from 'react';
import { leaderboard } from './model';
import { AWARD_MOTION_MS, awardElapsed, finalAwardGroups, roundAwardGroups } from './awards';

function AwardMoment({ groups, uid, final, elapsed }) {
  const [initialElapsed]=useState(elapsed);
  const [celebrating,setCelebrating]=useState(elapsed<AWARD_MOTION_MS);
  useEffect(()=>{
    if(initialElapsed>=AWARD_MOTION_MS)return undefined;
    const timer=setTimeout(()=>setCelebrating(false),AWARD_MOTION_MS-initialElapsed);
    return()=>clearTimeout(timer);
  },[initialElapsed]);
  const mine=groups.find(group=>group.students.some(student=>student.uid===uid));
  return <section className={`qm-awards${celebrating?' is-celebrating':''}${mine?' has-my-award':''}`} style={{'--qm-award-seek':`${-initialElapsed}ms`}} aria-label={final?'최종 1~3위':'이번 문제 빠른 정답 1~3위'}>
    {celebrating&&<div className="qm-award-sparks" aria-hidden="true">{Array.from({length:14},(_,i)=><i key={i} style={{'--spark-x':`${5+i*6.7}%`,'--spark-turn':`${(i%3-1)*85}deg`,'--spark-delay':`${i%5*90}ms`}}/>)}</div>}
    <div className="qm-award-heading"><div><small>{final?'오늘의 주인공':'정확하게, 누구보다 빠르게'}</small><h3>{final?'최종 TOP 3':'이번 문제 · 빠른 정답 TOP 3'}</h3></div>{mine&&<strong className="qm-personal-award" role="status">{mine.students.length>1?'공동 ':''}{mine.rank}위, {final?'끝까지 잘했어요!':'멋지게 맞혔어요!'}</strong>}</div>
    <div className="qm-award-grid" data-count={groups.length}>{groups.map(group=><article className={`qm-award-card rank-${group.rank}${group.students.some(s=>s.uid===uid)?' is-mine':''}`} key={group.rank}>
      <div className="qm-award-emblem" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="m13 25-5-13 10 6 6-12 6 12 10-6-5 13H13Z" fill="currentColor"/><path d="M14 31h20M18 37h12" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/></svg></div>
      <b className="qm-award-place">{group.students.length>1&&<small>공동 </small>}{group.rank}<span>위</span></b>
      <div className="qm-award-names" tabIndex={group.students.length>3?0:undefined}>{group.students.map(student=><strong key={student.uid}>{student.name}{student.uid===uid&&<small>나</small>}</strong>)}</div>
      <span className="qm-award-record">{final?`${group.students[0].points.toLocaleString()}점`:`${(group.elapsedMs/1000).toFixed(3)}초`}</span>
    </article>)}</div>
    <p className="qm-award-caption">{final?'누적 점수 기준 · 동점은 공동 순위':'이번 문제 정답자의 제출 시간 기준 · 같은 시간은 공동 순위'}</p>
  </section>;
}
export default function QuizAwards({ room, uid, now = 0 }) {
  const final=room.phase==='finished';
  const groups=final?finalAwardGroups(leaderboard(room.players,room.scores)):roundAwardGroups(room);
  if(!groups.length)return null;
  return <AwardMoment key={`${room.roundId}:${room.phase}:${now>0?'ready':'pending'}`} groups={groups} uid={uid} final={final} elapsed={awardElapsed(room,now)}/>;
}
