import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendBankQuestions, composeBankRecipe, matchesBank, prepareBank, questionFingerprint, readQuizDraft, uniqueAvailableBank } from '../src/quiz/bank.js';
import { validateSet, publicQuestion } from '../src/quiz/model.js';
const raw = (id, unit = '좌표평면', patch = {}) => ({ id, category: '공통수학2', unit, difficulty: '보통', question: `${unit} 문제 ${id}`, choices: ['1','2','3','4'], correctOption: 2, ...patch });
const row = (unit, count, patch = {}) => ({ category: '', unit, difficulty: '', count, duration: 30, ...patch });
const exampleBank = () => prepareBank([...Array.from({length:6},(_,i)=>raw('a'+i)),...Array.from({length:7},(_,i)=>raw('b'+i,'직선의 방정식'))]);
test('compose 4 coordinate problems plus 5 line-equation problems with exact quotas and per-row timing',()=>{
 const result=composeBankRecipe(exampleBank(),[row('좌표평면',4,{duration:20}),row('직선의 방정식',5,{duration:45})],{shuffleAll:false,random:()=>.3});
 assert.equal(result.questions.length,9);assert.deepEqual(result.questions.map(q=>q.unit),[...Array(4).fill('좌표평면'),...Array(5).fill('직선의 방정식')]);
 assert.deepEqual(result.questions.map(q=>q.duration),[...Array(4).fill(20),...Array(5).fill(45)]);
 assert.equal(new Set(result.questions.map(q=>q.sourceBankId)).size,9);
 assert.deepEqual(validateSet({title:'9문제 복습',questions:result.questions}),[]);
 assert.ok(!('sourceBankId' in publicQuestion(result.questions[0])));
});
test('overlapping broad and narrow rows reassign candidates instead of starving a required unit',()=>{
 const bank=prepareBank([raw('a1'),raw('a2'),raw('b1','직선의 방정식'),raw('b2','직선의 방정식')]);
 const result=composeBankRecipe(bank,[row('',2),row('좌표평면',2)],{shuffleAll:false,random:()=>.999});
 assert.equal(result.questions.length,4);assert.deepEqual(result.questions.slice(0,2).map(q=>q.unit),['직선의 방정식','직선의 방정식']);assert.ok(result.questions.slice(2).every(q=>q.unit==='좌표평면'));
});
test('individual and shared shortages are explicit and never return a smaller quiz silently',()=>{
 assert.throws(()=>composeBankRecipe(exampleBank(),[row('좌표평면',7)]),/요청 7문제 \/ 사용 가능 6문제/);
 assert.throws(()=>composeBankRecipe(exampleBank(),[row('좌표평면',4),row('좌표평면',4)]),/같은 문제를 공유/);
});
test('append excludes existing originals and legacy copies lacking bank IDs',()=>{
 const bank=exampleBank(),existing=[{...bank[0],id:'old-import',sourceBankId:''}];
 const result=composeBankRecipe(bank,[row('좌표평면',5)],{existing});
 assert.equal(result.questions.length,5);assert.ok(result.questions.every(q=>questionFingerprint(q)!==questionFingerprint(existing[0])));
 assert.throws(()=>composeBankRecipe(bank,[row('좌표평면',6)],{existing}),/사용 가능 5문제/);
});
test('content duplicates, reordered choices and duplicate source IDs count only once',()=>{
 const first=raw('a1');const reordered={...first,id:'a2',choices:['4','3','2','1'],correctOption:3};
 const sameSource={...first,question:'같은 원본의 변경 내용'};
 const bank=prepareBank([first,reordered,sameSource]);
 assert.equal(uniqueAvailableBank(bank).length,1);assert.throws(()=>composeBankRecipe(bank,[row('좌표평면',2)]),/사용 가능 1문제/);
});
test('manual import appends fresh IDs and independent copies, preserving title and existing items',()=>{
 const bank=exampleBank(),draft={id:'set',title:'선생님 이름',questions:[bank[0]]};
 const result=appendBankQuestions(draft,[bank[0],bank[1],bank[2]]);
 assert.equal(result.added,2);assert.equal(result.skipped,1);assert.equal(result.draft.title,draft.title);assert.equal(draft.questions.length,1);
 assert.notEqual(result.draft.questions[1].id,bank[1].id);result.draft.questions[1].choices[0]='수정';assert.equal(bank[1].choices[0],'1');
});
test('40-question limit is enforced atomically for both composition and import',()=>{
 const bank=prepareBank(Array.from({length:50},(_,i)=>raw('p'+i)));
 assert.throws(()=>composeBankRecipe(bank,[row('',3)],{existing:bank.slice(0,38)}),/최대 40문제/);
 const draft={id:'s',title:'원본',questions:bank.slice(0,39)};
 assert.throws(()=>appendBankQuestions(draft,bank.slice(39,41)),/최대 40문제/);assert.equal(draft.questions.length,39);
 assert.equal(appendBankQuestions(draft,[bank[39]]).draft.questions.length,40);
});
test('invalid counts and durations fail before altering any draft',()=>{
 for(const count of ['',0,-1,1.2,41,NaN,Infinity])assert.throws(()=>composeBankRecipe(exampleBank(),[row('',count)]),/문제 수/);
 for(const duration of ['',0,9,241,30.5,Infinity])assert.throws(()=>composeBankRecipe(exampleBank(),[row('',1,{duration})]),/제한시간/);
 assert.throws(()=>composeBankRecipe(exampleBank(),[]),/출제 조건/);
});
test('bank excludes disabled and invalid questions, and keeps stable source identity',()=>{
 const bank=prepareBank([raw('valid'),raw('off','좌표평면',{enabled:false}),raw('empty','좌표평면',{choices:['','','','']}),
  ...[undefined,null,0,-1,1.5,5,''].map((correctOption,i)=>raw('bad-answer'+i,'좌표평면',{correctOption}))]);
 assert.equal(bank.length,1);assert.equal(bank[0].sourceBankId,'valid');assert.equal(bank[0].id,prepareBank([raw('valid')])[0].id);
});
test('search combines category/unit/difficulty and literal normalized terms',()=>{
 const q=prepareBank([raw('a','좌표평면',{question:'두 점 A와 B의 거리는?',choices:['sqrt(2)','2','3','4']})])[0];
 assert.equal(matchesBank(q,{search:'두 점 sqrt(2)',category:'공통수학2',unit:'좌표평면',difficulty:'보통'}),true);
 assert.equal(matchesBank(q,{search:'.*'}),false);assert.equal(matchesBank(q,{unit:'직선의 방정식'}),false);
});
test('saved draft parsing refuses malformed existing drafts instead of overwriting them',()=>{
 const original={id:'s',title:'기존 세트',questions:[]};assert.deepEqual(readQuizDraft(JSON.stringify(original)),original);
 assert.throws(()=>readQuizDraft('{'));assert.throws(()=>readQuizDraft('{"title":"세트"}'),/초안을 읽지 못/);
 assert.deepEqual(readQuizDraft(null).questions,[]);
});
test('a large bank can compose a full 40-question mixed quiz without repeats',()=>{
 const bank=prepareBank(Array.from({length:3000},(_,i)=>raw('bulk'+i,'단원'+i%6)));
 const result=composeBankRecipe(bank,Array.from({length:4},(_,i)=>row('단원'+i,10)));
 assert.equal(result.questions.length,40);assert.equal(new Set(result.questions.map(q=>q.sourceBankId)).size,40);
});
