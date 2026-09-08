import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundAwardGroups, finalAwardGroups, awardElapsed, AWARD_MOTION_MS } from '../src/quiz/awards.js';
import { blankQuestion, settleRound } from '../src/quiz/model.js';
const player=(name)=>({name});
const result=(elapsedMs,extra={})=>({correct:true,submitted:true,roundId:'r1',elapsedMs,points:900,...extra});
const room=(results)=>({phase:'reveal',roundId:'r1',players:{a:player('가'),b:player('나'),c:player('다'),d:player('라')},results});
test('round awards rank correct submission time rather than cumulative score or rounded points',()=>{
  const input=room({a:result(3001),b:result(3000),c:result(4500),d:result(5000)});input.scores={a:{total:9000},b:{total:100}};
  const groups=roundAwardGroups(input);assert.deepEqual(groups.map(g=>g.students[0].uid),['b','a','c']);assert.deepEqual(groups.map(g=>g.rank),[1,2,3]);
});
test('only correct current-round submissions qualify; partial, missing and stale answers do not',()=>{
  const input=room({a:result(100,{correct:false,points:990}),b:result(0,{submitted:false}),c:result(100,{roundId:'old'}),d:result(500)});
  input.results.orphan=result(0);assert.deepEqual(roundAwardGroups(input).map(g=>g.students[0].uid),['d']);
  for(const elapsedMs of [null,undefined,'20',NaN,Infinity,-1])assert.equal(roundAwardGroups(room({a:result(elapsedMs)})).length,0);
});
test('ties preserve every shared winner and competition ranking skips the occupied places',()=>{
  const groups=roundAwardGroups(room({a:result(100),b:result(100),c:result(200),d:result(200)}));
  assert.deepEqual(groups.map(g=>g.rank),[1,3]);assert.equal(groups[0].students.length,2);assert.equal(groups[1].students.length,2);
  const all=roundAwardGroups(room({a:result(100),b:result(100),c:result(100),d:result(100)}));assert.equal(all.length,1);assert.equal(all[0].students.length,4);
});
test('submission settlement publishes authoritative elapsed time without altering scoring',()=>{
  const q={...blankQuestion('choice'),question:'질문',choices:['가','나','다','라']};
  const input={...room({}),startAt:1000,endAt:31000};
  const graded=settleRound(input,q,{a:{roundId:'r1',submittedAt:2345,answer:'0'},b:{roundId:'r1',submittedAt:999,answer:'0'},c:{roundId:'old',submittedAt:2000,answer:'0'},d:{roundId:'r1',submittedAt:3000,answer:'bad'}});
  assert.equal(graded.results.a.elapsedMs,1345);assert.equal(graded.results.a.roundId,'r1');assert.equal(graded.results.a.points,987);
  for(const id of ['b','c','d'])assert.equal(graded.results[id].elapsedMs,null);
});
test('awards stay hidden before reveal and animation time expires without replay on late reconnect',()=>{
  for(const phase of ['waiting','preview','answer','grading','finished'])assert.equal(roundAwardGroups({...room({a:result(100)}),phase}).length,0);
  assert.equal(awardElapsed({phase:'reveal',revealedAt:1000},1200),200);
  assert.equal(awardElapsed({phase:'reveal',revealedAt:1000},10000),AWARD_MOTION_MS);
  assert.equal(awardElapsed({phase:'finished',finishedAt:6000},6300),300);
  assert.equal(awardElapsed({phase:'reveal'},2000),AWARD_MOTION_MS);
});
test('final podium includes all tied third-place students and never awards an all-zero room',()=>{
  const rows=[{id:'a',name:'가',rank:1,total:10,correct:1},{id:'b',name:'나',rank:2,total:9,correct:1},{id:'c',name:'다',rank:3,total:8,correct:1},{id:'d',name:'라',rank:3,total:8,correct:1}];
  assert.equal(finalAwardGroups(rows)[2].students.length,2);
  assert.equal(finalAwardGroups(rows.map(r=>({...r,total:0,correct:0}))).length,0);
});
