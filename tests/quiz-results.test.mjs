import { test } from 'node:test';
import assert from 'node:assert/strict';
import { responseGroup, roundAnalytics, studentAnswerLabel } from '../src/quiz/roundResults.js';
const room = (question,results,players={a:{name:'1번 가'},b:{name:'2번 나'},c:{name:'10번 다'},d:{name:'20번 라'}}) => ({phase:'reveal',reveal:question,players,results});
const answer = (value,correct=false,points=0) => ({answer:value,correct,points,submitted:value!==null});
const choice = {type:'choice',choices:['sqrt(2)','2sqrt(2)','3','4'],correctIndex:0};
test('correct ratio includes absent submissions, preserves option zero and only counts participants',()=>{
 const data=roundAnalytics(room(choice,{a:answer(0,true,950),b:answer(1,false),c:answer(0,true,850),outsider:answer(0,true,1000)}));
 assert.equal(data.total,4);assert.equal(data.correct,2);assert.equal(data.correctPercent,50);assert.equal(data.wrong,1);assert.equal(data.missing,1);
 assert.deepEqual(responseGroup(data,'correct').rows.map(r=>r.uid),['a','c']);assert.deepEqual(responseGroup(data,'choice:0').rows.map(r=>r.uid),['a','c']);assert.deepEqual(responseGroup(data,'choice:1').rows.map(r=>r.uid),['b']);assert.equal(responseGroup(data,'missing').rows[0].uid,'d');
});
test('raw answers are not exposed by analytics before the reveal phase',()=>{
 for(const phase of ['waiting','preview','answer','grading']){const data=roundAnalytics({...room(choice,{a:answer(0,true)}),phase});assert.equal(data.ready,false);assert.deepEqual(data.rows,[]);assert.deepEqual(data.groups,[]);}
});
test('malformed choice inputs stay in the other-answer group, never the zero option',()=>{
 const data=roundAnalytics(room(choice,{a:answer('0'),b:answer(9),c:answer(0,true),d:answer(null)}));
 assert.equal(responseGroup(data,'choice:0').rows.length,1);assert.equal(responseGroup(data,'other').rows.length,2);assert.equal(data.groups.reduce((n,g)=>n+g.rows.length,0),3);
});
test('short answers group normalized equivalents but preserve each original submission',()=>{
 const data=roundAnalytics(room({type:'short'},{a:answer(' A B ',true,900),b:answer('ａｂ',true,800),c:answer('다른 답'),d:answer(null)}));
 assert.equal(data.groups.length,2);assert.equal(data.groups[0].rows.length,2);assert.equal(data.groups[0].rows[0].label,' A B ');assert.equal(data.groups[0].rows[1].label,'ａｂ');
});
test('slider zero, tolerance and partial credit retain the graded correctness',()=>{
 const data=roundAnalytics(room({type:'slider',target:0,tolerance:1},{a:answer(0,true,1000),b:answer(1,true,950),c:answer(2,false,800),d:answer(null)}));
 assert.equal(data.correct,2);assert.equal(data.wrong,1);assert.equal(responseGroup(data,'wrong').rows[0].points,800);assert.equal(data.rows[0].label,'0');assert.equal(data.groups.reduce((n,g)=>n+g.rows.length,0),3);
});
test('order answers distinguish permutations and show numeric cards without fused numbering',()=>{
 const data=roundAnalytics(room({type:'order'},{a:answer(['12','23','33'],true,900),b:answer(['23','12','33']),c:answer(null),d:answer(null)}));
 assert.equal(data.groups.length,2);assert.equal(data.rows[0].label,'12 → 23 → 33');assert.equal(data.rows[1].label,'23 → 12 → 33');
});
test('empty rooms and empty response groups have finite counts',()=>{
 const data=roundAnalytics(room(choice,{},{}));assert.equal(data.correctPercent,0);assert.equal(data.total,0);assert.deepEqual(responseGroup(data,'correct').rows,[]);assert.equal(responseGroup(data,'unknown'),null);
 assert.equal(studentAnswerLabel(choice,null),'미제출');assert.equal(studentAnswerLabel({type:'ox',choices:['O','X']},0),'O');
});
