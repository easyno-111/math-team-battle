import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAiReviews, isNonsenseRequest, safeSources, searchNonsense, verifyNonsenseDrafts } from '../src/utils/aiQuestionPolicy.js';
test('nonsense detection covers direct prompts and source metadata without selecting explicit exclusions',()=>{
  for(const request of [{mode:'nonsense'},{prompt:'쉬운 넌센스 퀴즈 5개'},{prompt:'아재 개그로 만들어줘'},{source:{category:'넌센스',unit:'생활'}},{source:[{unit:'언어유희'}]}])assert.equal(isNonsenseRequest(request),true);
  for(const prompt of ['함수 문제 4개','넌센스 말고 계산 문제','말장난 퀴즈는 제외하고 과학 문제'])assert.equal(isNonsenseRequest({prompt}),false);
});
test('Gemini search must return real web metadata, not just text that claims to have searched',async()=>{
  let calls=0;
  const ai={models:{generateContent:async()=>{calls++;return {text:'검색했다고 주장하는 후보'};}}};
  await assert.rejects(searchNonsense(ai,'test','넌센스',4),/출처/);assert.equal(calls,1);
  ai.models.generateContent=async()=>({text:'문제와 정답 후보',candidates:[{groundingMetadata:{groundingChunks:[{web:{uri:'https://example.org/quiz',title:'참고'}}]}}]});
  const result=await searchNonsense(ai,'test','넌센스',4);assert.equal(result.sources.length,1);assert.equal(result.sources[0].uri,'https://example.org/quiz');
});
test('reference links exclude unsafe protocols and duplicate entries',()=>{
  assert.deepEqual(safeSources([{uri:'javascript:alert(1)'},{uri:'file:///private'},{uri:'https://user:password@example.org/'},{uri:'https://example.org/q',title:'원문'},{uri:'https://example.org/q'}]),[{uri:'https://example.org/q',title:'원문'}]);
});
test('unverified source indexes and unexplained drafts are removed without inventing replacements',()=>{
  const sources=[{uri:'https://example.org/q'}],good={sourceIndex:1,explanation:'질문의 단어와 정답이 같은 발음으로 연결됩니다.'};
  const result=verifyNonsenseDrafts({questions:[good,{...good,sourceIndex:2},{...good,sourceIndex:'1'},{...good,explanation:'그냥'}],note:''},sources);
  assert.equal(result.questions.length,1);assert.match(result.note,/3문제/);
  assert.throws(()=>verifyNonsenseDrafts({questions:[]},sources),/후보/);
  assert.throws(()=>verifyNonsenseDrafts({questions:[good]},[]),/출처/);
});
const draft=(id,extra={})=>({id,question:'질문 '+id,choices:['가','나','다','라'],correctOption:1,explanation:'설명',selected:true,...extra});
test('AI review failures and missing reviews are automatically deselected by captured ID',()=>{
  const targets=[draft('a'),draft('b'),draft('c')];
  const result=applyAiReviews([targets[2],targets[0],targets[1]],targets,[{index:1,valid:true,note:'확인'},{index:2,valid:false,note:'답이 모호함'}]);
  assert.equal(result.find(q=>q.id==='a').selected,true);
  assert.equal(result.find(q=>q.id==='b').selected,false);
  assert.equal(result.find(q=>q.id==='c').selected,false);
  assert.ok(targets.every(q=>q.selected));
});
test('late reviews cannot certify edited questions and duplicate review indexes fail closed',()=>{
  const targets=[draft('a')],edited=[draft('a',{question:'교사가 고친 문제',review:null})];
  assert.deepEqual(applyAiReviews(edited,targets,[{index:1,valid:true}]),edited);
  const result=applyAiReviews(targets,targets,[{index:1,valid:true},{index:1,valid:true}]);assert.equal(result[0].selected,false);
});
