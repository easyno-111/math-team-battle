import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattleTimeline, motionProfile, characterPosition } from '../src/utils/battleAnimation.js';
const event = (i, now=1000, team=i%2?'B':'A') => ({ attackerUid:`p${i}`,attackerName:`학생${i}`,attackerTeam:team,targetUid:`p${i+1}`,combo:1,attack:2,at:now });
test('30 simultaneous answers retain all participants and damage in two team attacks',()=>{
 const t=createBattleTimeline();t.ingest(Object.fromEntries(Array.from({length:30},(_,i)=>['e'+i,event(i)])),{A:30,B:30},1000);
 const f=t.tick(1100);assert.equal(f.active.length,2);assert.equal(f.pendingCount,0);
 assert.equal(f.active.reduce((n,e)=>n+e.members.size,0),30);assert.equal(f.active.reduce((n,e)=>n+e.attack,0),60);
});
test('sustained bursts keep at most four effects and drain without dropping damage',()=>{
 const t=createBattleTimeline();let total=0,maxPending=0;const ids=new Set();
 for(let now=1000;now<10000;now+=100){if(now<6000)t.ingest(Object.fromEntries(Array.from({length:6},(_,i)=>[`e${now}-${i}`,event(now+i,now)])),{A:now,B:now},now);
 const f=t.tick(now);assert.ok(f.active.length<=4);assert.ok(f.pendingCount<=2);maxPending=Math.max(maxPending,f.pendingCount);
 for(const e of f.active)if(!ids.has(e.id)){ids.add(e.id);total+=e.attack;assert.ok(now-e.at<=1200);}}
 assert.equal(total,50*6*2);assert.ok(maxPending>0);assert.equal(t.tick(11000).active.length,0);
});
test('duplicate snapshots and event pruning never replay retained events',()=>{
 const t=createBattleTimeline(),events={e:event(1)};t.ingest(events,{A:2},1000);t.tick(1000);t.ingest(events,{A:2},1100);t.tick(2200);t.ingest(events,{A:2},2300);assert.equal(t.tick(2300).active.length,0);
});
test('scores move at impact and never regress when a slower earlier attack lands later',()=>{
 const t=createBattleTimeline();t.ingest({a:{...event(1),combo:10}},{A:2},1000);t.tick(1000);t.ingest({b:event(2,1100)},{A:4},1100);t.tick(1100);
 const fastImpact=1100+motionProfile(1).impact, slowImpact=1000+motionProfile(10).impact;assert.equal(t.tick(fastImpact-1).visualScores,null);assert.equal(t.tick(fastImpact).visualScores.A,4);assert.equal(t.tick(slowImpact).visualScores.A,4);
});
test('stale events are not replayed after reconnect',()=>{const t=createBattleTimeline();t.ingest({old:event(1,1000)},{},5000);assert.equal(t.tick(5000).active.length,0);});
test('clear cancels active and queued events; remount can initialize cleanly',()=>{const t=createBattleTimeline();const e={x:event(1)};t.ingest(e,{},1000);t.tick(1000);t.clear();assert.equal(t.tick(1000).active.length,0);t.ingest(e,{},1000);assert.equal(t.tick(1000).active.length,1);});
test('every projectile lands before its impact and recovery window ends',()=>{for(const combo of [1,2,3,5,7,10]){const p=motionProfile(combo);assert.equal(p.impact,p.windup+p.flight);assert.ok(p.duration>=p.impact+(p.shots-1)*p.stagger+300);}});
test('30 students occupy unique mirrored positions on three rows',()=>{const points=Array.from({length:15},(_,i)=>characterPosition('left',i,15));assert.equal(new Set(points.map(p=>p.y)).size,3);assert.equal(new Set(points.map(p=>`${p.x},${p.y}`)).size,15);points.forEach((p,i)=>{assert.equal(p.x+characterPosition('right',i,15).x,1000);assert.ok(p.y<460 && p.x<460);});});

test('six combo thresholds have distinct attack types and fever has a larger impact',()=>{const profiles=[1,2,3,5,7,10].map(c=>motionProfile(c));assert.equal(new Set(profiles.map(p=>p.type)).size,6);assert.ok(profiles[5].radius>profiles[3].radius);assert.ok(profiles[3].radius>profiles[0].radius);});
test('coalescing keeps the strongest attacker and its intended target',()=>{const t=createBattleTimeline();t.ingest({a:{...event(1,1000,'A'),combo:10,targetUid:'target1'},b:{...event(2,1000,'A'),combo:1,targetUid:'target2'}},{A:4},1000);const e=t.tick(1000).active[0];assert.equal(e.attackerUid,'p1');assert.equal(e.targetUid,'target1');assert.equal(e.combo,10);assert.equal(e.members.size,2);assert.equal(e.attack,4);});
