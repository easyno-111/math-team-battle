const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const {reserve,parseResponse,parseSearch,makeBody}=require('./policy.cjs');
const question={category:'수학',unit:'다항식',difficulty:'보통',question:'$x^{2}$',choices:['1','2','3','4'],correctOption:1,explanation:'계산하면 1'};
const output=result=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});
function harness({wrong=false,disabled=false,otherProject=false}={}){
 const state={guards:{},calls:[]};
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const env={AI_ADMIN_UIDS:'teacher',AUTH_WEB_API_KEY:'fake-firebase-key',OPENAI_MODEL:'gpt-4.1',OPENAI_API_KEY:'test-only'};
 const auth={getUser:async()=>({email:'teacher@example.invalid',disabled}),verifyIdToken:async()=>{if(otherProject)throw Error('wrong project');return {uid:'teacher'};}};
 const modules={
  'firebase-functions/v2/https':{onCall:(options,handler)=>{state.options=options;return handler;},HttpsError},
  'firebase-functions/params':{defineString:k=>({value:()=>env[k]}),defineSecret:k=>({value:()=>env[k]})},
  'firebase-admin/app':{initializeApp:()=>{}},'firebase-admin/auth':{getAuth:()=>auth},
  'firebase-admin/database':{getDatabase:()=>({ref:path=>({transaction:async fn=>{const next=fn(state.guards[path]||null);if(next===undefined)return {committed:false};state.guards[path]=next;return {committed:true};}})})},
  './policy.cjs':require('./policy.cjs')
 };
 const exports={};
 vm.runInNewContext(readFileSync(__dirname+'/index.cjs','utf8'),{exports,require:name=>modules[name],Date,AbortSignal,fetch:async(url,options)=>{
  const body=JSON.parse(options.body);state.calls.push({url,body});
  if(url.includes('identitytoolkit'))return {ok:!wrong,json:async()=>wrong?{error:{}}:{localId:'teacher',idToken:'verified-token'}};
  if(body.tools)return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'확인된 후보',annotations:[{type:'url_citation',url:'https://example.org/quiz',title:'출처'}]}]}]})};
  return {ok:true,json:async()=>output({questions:[question]})};
 }});
 return {...state,handler:exports.generateAdvancedQuestions};
}
const request=(id='request-00000000001')=>({auth:{uid:'teacher',token:{firebase:{sign_in_provider:'password'}}},data:{kind:'bank',prompt:'문제 하나',password:'example-password',requestId:id}});
test('anonymous, non-allowlisted, disabled users and missing password never call OpenAI',async()=>{
 for(const mutate of [r=>{r.auth=null;},r=>{r.auth.uid='student';},r=>{r.auth.token.firebase.sign_in_provider='anonymous';},r=>{delete r.data.password;}]){
  const h=harness(),r=request();mutate(r);await assert.rejects(h.handler(r));assert.equal(h.calls.length,0);
 }
 const h=harness({disabled:true});await assert.rejects(h.handler(request()));assert.equal(h.calls.length,0);
});
test('incorrect password and cross-project credentials never call OpenAI',async()=>{
 for(const opts of [{wrong:true},{otherProject:true}]){const h=harness(opts);await assert.rejects(h.handler(request()));assert.equal(h.calls.length,1);assert.ok(h.calls[0].url.includes('identitytoolkit'));}
});
test('every generation rechecks the password and never persists or returns credentials',async()=>{
 const h=harness();const a=await h.handler(request());await h.handler(request('request-00000000002'));
 assert.equal(h.calls.filter(c=>c.url.includes('identitytoolkit')).length,2);
 assert.equal(h.calls.filter(c=>c.url.includes('api.openai.com')).length,2);
 assert.ok(!JSON.stringify(h.guards).includes('example-password'));assert.ok(!JSON.stringify(a).includes('test-only'));
 assert.equal(h.calls[1].body.store,false);assert.equal(h.calls[1].body.text.format.strict,true);
});
test('duplicate requests and concurrent generation are blocked before additional paid calls',async()=>{
 const h=harness();const r=request();await h.handler(r);await assert.rejects(h.handler(request()),/이미 처리/);assert.equal(h.calls.length,2);
 const state=reserve(null,'request-00000000001',1000000);
 assert.throws(()=>reserve(state,'request-00000000002',1000001),/생성 중/);
});
test('server enforces minute/day limits across new request IDs',()=>{
 let s=null;for(let i=0;i<3;i++){s=reserve(s,`id${i}`,1000000+i);s.activeUntil=0;}
 assert.throws(()=>reserve(s,'id4',1000004),/한도/);
 assert.throws(()=>reserve({...s,count:60,minute:[]},'id5',1000005),/한도/);
 assert.equal(reserve(s,'nextday',1000000+86400000).count,1);
});
test('truncated, refused or malformed AI responses cannot enter the editor',()=>{
 assert.throws(()=>parseResponse({status:'incomplete'},'bank'));
 assert.throws(()=>parseResponse({status:'completed',output:[{content:[{type:'refusal'}]}]},'bank'));
 assert.throws(()=>parseResponse(output({questions:[{...question,correctOption:7}]}),'bank'));
 assert.throws(()=>parseResponse(output({questions:[{...question,choices:['1']}]}),'bank'));
 assert.deepEqual(parseResponse(output({questions:[question]}),'bank').questions[0],question);
});
test('all five quiz schemas parse their matching response fields',()=>{
 const common={category:'수학',unit:'수',difficulty:'보통',question:'문제',explanation:'해설',duration:30};
 const values={choice:{choices:['1','2','3','4'],correctIndex:0},ox:{choices:['O','X'],correctIndex:1},short:{answers:['50']},slider:{min:40,max:60,step:1,target:50,tolerance:0,partial:false},order:{items:['12','23','33','44']}};
 for(const [type,fields]of Object.entries(values))assert.equal(parseResponse(output({questions:[{...common,type,...fields}],note:''}),'quiz').questions[0].type,type);
});
test('web-backed nonsense generation requires real citation metadata',async()=>{
 assert.throws(()=>parseSearch({status:'completed',output:[{content:[{type:'output_text',text:'invented'}]}]}),/출처/);
 const h=harness(),r=request();r.data.kind='bankWeb';const result=await h.handler(r);
 assert.equal(h.calls.length,3);assert.equal(h.calls[1].body.tools[0].type,'web_search');assert.equal(result.result._sources[0].uri,'https://example.org/quiz');
});
test('schema and output budgets are controlled on the server',()=>{
 const body=makeBody('quiz','request','gpt-4.1');assert.equal(body.max_output_tokens,16000);assert.equal(body.text.format.schema.additionalProperties,false);assert.equal(body.text.format.schema.properties.questions.maxItems,20);
 const rules=JSON.parse(readFileSync(__dirname+'/../database.rules.json','utf8')).rules;
 assert.deepEqual(rules.aiPrivate,{'.read':false,'.write':false});assert.equal(rules['.write'],false);
});
test('example environment does not use Firebase reserved names',()=>{
 const lines=readFileSync(__dirname+'/.env.example','utf8').split(/\r?\n/).filter(line=>line&&!line.startsWith('#'));
 const keys=lines.map(line=>line.split('=')[0]);
 assert.ok(keys.includes('AUTH_WEB_API_KEY'));
 assert.ok(keys.every(key=>!key.startsWith('FIREBASE_')&&!key.startsWith('X_GOOGLE_')&&!key.startsWith('EXT_')));
});
