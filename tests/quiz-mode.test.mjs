import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blankQuestion, validateQuestion, validateSet, publicQuestion, grade, settleRound, sliderValue, leaderboard, fromBank } from '../src/quiz/model.js';
const question=type=>({...blankQuestion(type),question:'문제',choices:type==='ox'?['O','X']:['가','나','다','라'],answers:['정답'],items:['가','나','다']});
test('all five question types pass validation',()=>{for(const t of ['choice','ox','short','slider','order'])assert.deepEqual(validateQuestion(question(t)),[]);});
test('invalid arrays, inaccessible slider targets, duplicate cards and invalid indexes are rejected',()=>{
 for(const q of [{...question('choice'),choices:'wrong'},{...question('short'),answers:[]},{...question('slider'),min:0,max:10,step:3,target:5},{...question('order'),items:['같음','같음']},{...question('slider'),step:0},{...question('choice'),correctIndex:5}])assert.ok(validateQuestion(q).length);
 assert.ok(validateSet({title:'세트',questions:[]}).length);
});
test('public questions never expose solutions or original order',()=>{
 for(const t of ['choice','ox','short','slider','order']){const p=publicQuestion(question(t));for(const key of ['correctIndex','answers','target','tolerance','partial','explanation','items'])assert.ok(!(key in p),`${t}.${key}`);if(t==='order'){assert.notDeepEqual(p.cards.map(c=>c.text),question(t).items);assert.equal(new Set(p.cards.map(c=>c.id)).size,3);}}
});
test('speed only rewards correct answers, with a 700-point floor',()=>{const q=question('choice');assert.equal(grade(q,0,0).points,1000);assert.equal(grade(q,0,15000).points,850);assert.equal(grade(q,0,30000).points,700);assert.equal(grade(q,1,0).points,0);assert.equal(grade(q,'0',0).points,0);});
test('OX, normalized short answers, strict ordering',()=>{assert.equal(grade(question('ox'),0,0).correct,true);assert.equal(grade({...question('short'),answers:['Hello World']},' ＨＥＬＬＯ world ',0).correct,true);assert.equal(grade(question('order'),['가','나','다'],0).correct,true);assert.equal(grade(question('order'),['다','나','가'],0).correct,false);});
test('slider exact, tolerance and partial credit respect bounds and step',()=>{const q={...question('slider'),min:40,max:60,step:1,target:50};assert.equal(grade(q,50,0).points,1000);assert.equal(grade(q,49,0).points,0);assert.equal(grade({...q,tolerance:1},49,0).correct,true);assert.equal(grade({...q,partial:true},49,0).points,950);assert.equal(grade({...q,partial:true},61,0).points,0);assert.equal(grade({...q,partial:true},50.5,0).points,0);assert.equal(sliderValue({min:.1,step:.1},2),.3);});
test('settlement rejects stale rounds, early/late submissions and malformed answers',()=>{const room={players:{a:{name:'가'},b:{name:'나'},c:{name:'다'},d:{name:'라'}},roundId:'r',startAt:1000,endAt:31000,scores:{}};const answers={a:{roundId:'r',submittedAt:1000,answer:'0'},b:{roundId:'r',submittedAt:31001,answer:'0'},c:{roundId:'old',submittedAt:1000,answer:'0'},d:{roundId:'r',submittedAt:1000,answer:'bad'}};const r=settleRound(room,question('choice'),answers);assert.equal(r.scores.a.total,1000);for(const id of ['b','c','d'])assert.equal(r.scores[id].total,0);answers.a.submittedAt=999;assert.equal(settleRound(room,question('choice'),answers).scores.a.total,0);});
test('streak, rank rise and ties are tracked without mutating previous totals',()=>{const room={players:{a:{name:'가'},b:{name:'나'}},roundId:'r',startAt:1000,endAt:31000,scores:{a:{total:0,correct:0,streak:0,maxStreak:0},b:{total:100,correct:1,streak:1,maxStreak:1}}};const r=settleRound(room,question('choice'),{a:{roundId:'r',submittedAt:1000,answer:'0'}});assert.equal(r.results.a.rankChange,1);assert.equal(r.scores.a.maxRise,1);assert.equal(room.scores.a.total,0);assert.equal(r.scores.b.streak,0);assert.deepEqual(leaderboard(room.players,{a:{total:10},b:{total:10}}).map(p=>p.rank),[1,1]);});
test('bank imports preserve the correct option',()=>{const q=fromBank({question:'문제',choices:['가','나','다','라'],correctOption:3,unit:'함수'});assert.equal(q.correctIndex,2);assert.deepEqual(validateQuestion(q),[]);});
test('rules restrict private data and require one server-timestamped answer',()=>{const rules=JSON.parse(readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')).rules;assert.equal(rules['.read'],false);assert.ok(rules.quizSets.$uid['.read'].includes('auth.uid == $uid'));assert.ok(rules.quizSecrets.$code['.read'].includes("data.child('hostUid').val() == auth.uid"));const sub=rules.quizAnswers.$code.$round.$uid;for(const clause of ['!data.exists()',"phase').val() == 'answer'",'now >=','now <='])assert.ok(sub['.write'].includes(clause));assert.ok(sub.submittedAt['.validate'].includes('newData.val() == now'));assert.equal(sub.$other['.validate'],false);});
test('question rules use supported methods and accept only indexes 0 through 39',()=>{
 const raw=readFileSync(new URL('../database.rules.json',import.meta.url),'utf8');
 assert.ok(!raw.includes('numChildren'));
 const set=JSON.parse(raw).rules.quizSets.$uid.$setId;
 assert.ok(set['.validate'].includes("newData.child('questions').hasChild('0')"));
 const expression=set.questions.$index['.validate'];
 const regex=new RegExp(expression.slice(expression.indexOf('/')+1,expression.lastIndexOf('/')));
 for(let i=0;i<40;i++)assert.ok(regex.test(String(i)));
 for(const key of ['40','41','100','-1','01','1.5','foo',''])assert.equal(regex.test(key),false);
 const allowed=new Set(['exists','val','child','parent','hasChild','hasChildren','isString','isNumber','isBoolean','getPriority','matches']);
 for(const match of raw.matchAll(/\.([A-Za-z]+)\(/g))assert.ok(allowed.has(match[1]),`Unsupported rule method: ${match[1]}`);
});
