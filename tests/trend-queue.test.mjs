import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTrendTier, buildTieredTrendQueue } from '../lib/trend-queue.mjs';

function baseCandidate(overrides = {}) {
  return {
    id: 'candidate-1',
    gameName: 'Unique Horror Game',
    firstSeen: new Date().toISOString(),
    discoveryScore: 9,
    sources: [{ sourceId: 'steam', kind: 'steam-popular-new', url: 'https://example.com/game' }],
    seo: { modelVersion: 5, classification: 'independent', score: 60, nameRisk: 8, entityConflict: false },
    fast: { modelVersion: 3, classification: 'pass', score: 60 },
    ...overrides,
  };
}

test('classifies strict pass candidate as strong tier', () => {
  assert.equal(classifyTrendTier(baseCandidate())?.tier, 'strong');
});

test('classifies strategic watch candidate as secondary tier', () => {
  const candidate = baseCandidate({ fast: { modelVersion: 3, classification: 'watch', score: 30 } });
  assert.equal(classifyTrendTier(candidate)?.tier, 'secondary');
});

test('rejects entity-conflicted candidates from trend queue', () => {
  const candidate = baseCandidate({ seo: { modelVersion: 5, classification: 'independent', score: 70, nameRisk: 5, entityConflict: true } });
  assert.equal(classifyTrendTier(candidate), null);
});

test('skips candidates with fresh trend data', () => {
  const candidate = baseCandidate({
    trend: { modelVersion: 4, profileVersion: 2, checkedAt: new Date().toISOString(), classification: 'rising', score: 80 },
  });
  assert.equal(classifyTrendTier(candidate), null);
});

test('builds queue in strong, secondary, strategic order', () => {
  const strong = baseCandidate({ id: 'strong' });
  const secondary = baseCandidate({ id: 'secondary', fast: { modelVersion: 3, classification: 'watch', score: 30 } });
  const strategic = baseCandidate({
    id: 'strategic',
    seo: { modelVersion: 5, classification: 'page', score: 40, nameRisk: 15, entityConflict: false },
    fast: { modelVersion: 3, classification: 'weak', score: 22 },
  });
  const queue = buildTieredTrendQueue([strategic, secondary, strong]);
  assert.deepEqual(queue.map((item) => item.tier), ['strong', 'secondary', 'strategic']);
});
