import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMarketFreshness } from '../lib/market-freshness.mjs';
import { applyFinalRecommendation } from '../lib/opportunity-finalizer.mjs';

const NOW = Date.parse('2026-08-01T08:00:00Z');
const SOCIAL_CHECKED_AT = '2026-08-01T07:30:00Z';

function baseCandidate(overrides = {}) {
  return {
    gameName: 'Witchspire',
    firstSeen: '2026-07-31T08:00:00Z',
    seo: {
      modelVersion: 5,
      provider: 'serper+autocomplete',
      classification: 'independent',
      score: 82,
      nameRisk: 4,
      entityConflict: false,
      exactResultUrls: [
        'https://store.steampowered.com/app/123/witchspire/',
        'https://creator.itch.io/witchspire',
      ],
      gameResultUrls: [],
    },
    fast: { classification: 'pass', score: 80, onlinePlatformCount: 2, sourceAdded24h: 2, onlineSuggestionCount: 2 },
    trend: {
      modelVersion: 4,
      classification: 'breakout',
      score: 88,
      keywordFreshness: 'new',
    },
    social: {
      checkedAt: SOCIAL_CHECKED_AT,
      providers: {
        youtube: { configured: true, checkedAt: SOCIAL_CHECKED_AT, videoCount: 8, channelCount: 5, totalViews: 50000, totalLikes: 3000, totalComments: 500, recent24h: 3 },
        reddit: { configured: true, checkedAt: SOCIAL_CHECKED_AT, postCount: 5, subredditCount: 3, authorCount: 4, totalScore: 200, totalComments: 100, recent24h: 1 },
        x: { configured: false },
        tiktok: { configured: false },
      },
    },
    siteType: {
      modelVersion: 2,
      type: 'online',
      browserPlayable: true,
      onlinePlatformCount: 2,
      reasons: ['已在2个浏览器游戏平台出现'],
    },
    ...overrides,
  };
}

test('treats an exact-match wiki domain as an occupied keyword, not a new opportunity', () => {
  const candidate = baseCandidate({
    gameName: 'Mistfall Hunter',
    seo: {
      ...baseCandidate().seo,
      exactResultUrls: [
        'https://store.steampowered.com/app/3282300/mistfall_hunter/',
        'https://mistfallhunter.wiki/classes',
      ],
    },
    trend: {
      modelVersion: 4,
      classification: 'breakout',
      score: 63,
      keywordFreshness: 'unknown',
    },
    siteType: {
      modelVersion: 2,
      type: 'wiki',
      browserPlayable: false,
      onlinePlatformCount: 0,
      reasons: ['已发现Steam下载型来源'],
    },
  });

  const market = analyzeMarketFreshness(candidate, NOW);
  assert.equal(market.status, 'occupied');
  assert.deepEqual(market.dedicatedDomains, ['mistfallhunter.wiki']);
  assert.equal(market.allowsIndependent, false);

  applyFinalRecommendation(candidate);
  assert.notEqual(candidate.recommendation, 'independent');
  assert.match(candidate.siteType.reasons[0], /mistfallhunter\.wiki/);
});

test('treats a historically established term as mature even when it rises again', () => {
  const candidate = baseCandidate({
    gameName: 'Palworld',
    trend: {
      modelVersion: 4,
      classification: 'rising',
      score: 69,
      keywordFreshness: 'existing',
    },
    siteType: {
      modelVersion: 2,
      type: 'wiki',
      browserPlayable: false,
      onlinePlatformCount: 0,
      reasons: ['已发现Steam下载型来源'],
    },
  });

  const market = analyzeMarketFreshness(candidate, NOW);
  assert.equal(market.status, 'established');
  assert.equal(market.allowsIndependent, false);

  applyFinalRecommendation(candidate);
  assert.notEqual(candidate.recommendation, 'independent');
  assert.match(candidate.siteType.reasons[0], /老词|成熟词/);
});

test('allows a genuinely new online term when market and social evidence both pass', () => {
  const candidate = baseCandidate();
  const market = analyzeMarketFreshness(candidate, NOW);
  assert.equal(market.status, 'greenfield');
  assert.equal(market.dedicatedDomains.length, 0);
  assert.equal(market.allowsIndependent, true);

  applyFinalRecommendation(candidate);
  assert.equal(candidate.recommendation, 'independent');
  assert.equal(candidate.social.allowsIndependent, true);
});

test('routes an unknown-history rising term to test-now instead of strict independent', () => {
  const candidate = baseCandidate({
    firstSeen: '2026-08-27T08:00:00Z',
    trend: {
      modelVersion: 4,
      classification: 'breakout',
      score: 90,
      keywordFreshness: 'unknown',
    },
    social: {
      checkedAt: SOCIAL_CHECKED_AT,
      providers: {
        youtube: { configured: true, checkedAt: SOCIAL_CHECKED_AT, videoCount: 2, channelCount: 2, totalViews: 3000 },
        reddit: { configured: true, checkedAt: SOCIAL_CHECKED_AT, postCount: 1, subredditCount: 1, totalScore: 8, totalComments: 2 },
        x: { configured: false },
        tiktok: { configured: false },
      },
    },
  });

  const market = analyzeMarketFreshness(candidate, NOW);
  assert.equal(market.status, 'unconfirmed-new');
  assert.equal(market.allowsIndependent, false);

  applyFinalRecommendation(candidate);
  assert.equal(candidate.recommendation, 'test-now');
  assert.equal(candidate.opportunity.allowsIndependent, false);
  assert.equal(candidate.opportunity.allowsTest, true);
});
