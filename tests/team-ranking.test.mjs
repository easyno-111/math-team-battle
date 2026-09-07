import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankTeam } from '../src/utils/teamRanking.js';
const people=[{id:'a',name:'가'},{id:'b',name:'나'},{id:'c',name:'다'}];
test('contribution, not registration order, determines rank',()=>{const rows=rankTeam(people,{a:{attackPower:2},b:{attackPower:9},c:{attackPower:4}});assert.deepEqual(rows.map(p=>p.id),['b','c','a']);assert.deepEqual(rows.map(p=>p.rank),[1,2,3]);});
test('ties use competition ranking and stable order',()=>{const rows=rankTeam(people,{a:{attackPower:9},b:{attackPower:9},c:{attackPower:0}});assert.deepEqual(rows.map(p=>p.rank),[1,1,3]);assert.deepEqual(rows.map(p=>p.tied),[true,true,false]);});
test('missing state and no participants are handled',()=>{assert.equal(rankTeam(people).every(p=>p.rank===1),true);assert.deepEqual(rankTeam(),[]);});
