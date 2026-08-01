import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFastSignals } from '../lib/fast-signals.mjs';

const now=Date.parse('2026-07-28T08:00:00Z');

test('passes a candidate spreading across two sources in 24 hours',()=>{
  const candidate={
    firstSeen:'2026-07-28T01:00:00Z',
    seo:{score:72,classification:'independent',nameRisk:4,suggestions:['witchspire game','witchspire map'],exactResultUrls:['https://a.test/witchspire','https://b.test/witchspire']},
    sources:[
      {sourceId:'itch',kind:'itch-popular',firstSeen:'2026-07-28T01:00:00Z',currentRank:8,bestRank:8},
      {sourceId:'steam',kind:'steam-popular-new',firstSeen:'2026-07-28T03:00:00Z',currentRank:15,bestRank:15},
    ],
  };
  const fast=calculateFastSignals(candidate,{},now);
  assert.equal(fast.classification,'pass');
  assert.equal(fast.sourceAdded24h,2);
  assert.ok(fast.score>=45);
});

test('keeps a single ordinary source out of Trends',()=>{
  const candidate={
    firstSeen:'2026-07-28T01:00:00Z',
    seo:{score:58,classification:'page',nameRisk:8,suggestions:[],exactResultUrls:['https://a.test/plain-game']},
    sources:[{sourceId:'feed',kind:'itch-new',firstSeen:'2026-07-28T01:00:00Z',currentRank:80,bestRank:80}],
  };
  const fast=calculateFastSignals(candidate,{},now);
  assert.notEqual(fast.classification,'pass');
});

test('recognizes seeded Trends Rising source IDs',()=>{
  const candidate={
    firstSeen:'2026-07-28T01:00:00Z',
    seo:{score:46,classification:'page',nameRisk:6,suggestions:[],exactResultUrls:[]},
    sources:[
      {sourceId:'y8-new',kind:'y8-new',url:'https://www.y8.com/games/rising-game',firstSeen:'2026-07-28T01:00:00Z'},
      {sourceId:'trends-rising-7d-horror-game',kind:'trends-rising-7d-horror-game',firstSeen:'2026-07-28T02:00:00Z'},
    ],
  };
  const fast=calculateFastSignals(candidate,{},now);
  assert.equal(fast.classification,'pass');
  assert.match(fast.reasons.join(' '),/Google Trends/);
});

test('does not inflate fast signals with multiple feeds from the same portal',()=>{
  const candidate={
    firstSeen:'2026-07-28T01:00:00Z',
    seo:{score:36,classification:'page',nameRisk:6,suggestions:[],exactResultUrls:[]},
    sources:[
      {sourceId:'itch-newest-web',kind:'itch-popular',url:'https://example.itch.io/game',firstSeen:'2026-07-28T01:00:00Z'},
      {sourceId:'itch-new-popular-web',kind:'itch-popular',url:'https://example.itch.io/game',firstSeen:'2026-07-28T01:30:00Z'},
    ],
  };
  const fast=calculateFastSignals(candidate,{},now);
  assert.equal(fast.onlinePlatformCount,1);
  assert.equal(fast.sourceAdded24h,1);
  assert.notEqual(fast.classification,'pass');
});

test('detects new autocomplete and SERP pages between scans',()=>{
  const previous={suggestionSnapshot:['quiet halls game'],serpSnapshot:['https://a.test/quiet']};
  const candidate={
    firstSeen:'2026-07-27T20:00:00Z',
    seo:{score:68,classification:'independent',nameRisk:5,suggestions:['quiet halls game','quiet halls map','quiet halls ending'],exactResultUrls:['https://a.test/quiet','https://b.test/quiet','https://c.test/quiet']},
    sources:[{sourceId:'steam',kind:'steam-popular-new',firstSeen:'2026-07-27T20:00:00Z',previousRank:40,currentRank:12,bestRank:12}],
  };
  const fast=calculateFastSignals(candidate,previous,now);
  assert.equal(fast.newSuggestionCount,2);
  assert.equal(fast.newSerpPageCount,2);
  assert.equal(fast.maxRankGain,28);
  assert.equal(fast.classification,'pass');
});

test('rejects entity conflicts before Trends',()=>{
  const candidate={
    firstSeen:'2026-07-28T01:00:00Z',
    seo:{score:20,classification:'reject',entityConflict:true,nameRisk:20,suggestions:[],exactResultUrls:[]},
    sources:[{sourceId:'itch',kind:'itch-popular',firstSeen:'2026-07-28T01:00:00Z'}],
  };
  const fast=calculateFastSignals(candidate,{},now);
  assert.equal(fast.classification,'reject');
  assert.equal(fast.score,0);
});
