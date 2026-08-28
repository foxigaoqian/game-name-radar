import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOnlineSocialBuzz } from '../lib/social-buzz.mjs';

const checkedAt = '2026-08-04T00:00:00Z';
const provider = (data) => ({ configured: true, checkedAt, ...data });

test('passes cross-platform social promotion', () => {
  const result = analyzeOnlineSocialBuzz({ social: { providers: {
    youtube: provider({ videoCount: 8, channelCount: 5, totalViews: 50000, totalLikes: 3000, totalComments: 500, recent24h: 3 }),
    reddit: provider({ postCount: 5, subredditCount: 3, authorCount: 4, totalScore: 200, totalComments: 100, recent24h: 1 }),
    x: {},
    tiktok: {},
  } } });
  assert.equal(result.classification, 'pass');
  assert.equal(result.allowsIndependent, true);
  assert.equal(result.crossPlatformCount, 2);
  assert.equal(result.hasExternalSpillover, true);
});

test('keeps platform-only candidates pending without social checks', () => {
  const result = analyzeOnlineSocialBuzz({});
  assert.equal(result.classification, 'pending');
  assert.equal(result.allowsIndependent, false);
  assert.equal(result.allowsTest, true);
});

test('does not pass one weak social provider', () => {
  const result = analyzeOnlineSocialBuzz({ social: { providers: {
    youtube: provider({ videoCount: 1, channelCount: 1, totalViews: 300 }),
    reddit: {},
    x: {},
    tiktok: {},
  } } });
  assert.notEqual(result.classification, 'pass');
  assert.equal(result.allowsIndependent, false);
});

test('does not treat one very strong provider as independent spillover', () => {
  const result = analyzeOnlineSocialBuzz({ social: { providers: {
    youtube: provider({ videoCount: 12, channelCount: 7, totalViews: 180000, totalLikes: 9000, totalComments: 1300, recent24h: 4 }),
    reddit: {},
    x: {},
    tiktok: {},
  } } });
  assert.equal(result.classification, 'watch');
  assert.equal(result.hasExternalSpillover, false);
  assert.equal(result.hasSinglePlatformMomentum, true);
  assert.equal(result.allowsTest, true);
  assert.equal(result.allowsIndependent, false);
});
