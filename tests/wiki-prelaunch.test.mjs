import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWikiPrelaunch } from '../lib/wiki-prelaunch.mjs';
import { applyFinalRecommendation } from '../lib/opportunity-finalizer.mjs';
import { parseSteamSearch } from '../lib/steam-discovery.mjs';

const NOW = Date.parse('2026-08-04T02:00:00Z');

function prelaunchCandidate(overrides = {}) {
  return {
    gameName: 'Project Emberfall',
    firstSeen: '2026-08-02T02:00:00Z',
    sources: [{
      key: 'steam-top-wishlist|https://store.steampowered.com/app/123/project_emberfall/',
      sourceId: 'steam-top-wishlist',
      kind: 'steam-top-wishlist',
      url: 'https://store.steampowered.com/app/123/project_emberfall/',
      date: 'Sep 12, 2026',
      firstSeen: '2026-08-02T02:00:00Z',
      previousRank: 32,
      currentRank: 18,
      bestRank: 18,
    }],
    seo: {
      modelVersion: 5,
      provider: 'serper-google-search',
      classification: 'independent',
      score: 79,
      nameRisk: 5,
      entityConflict: false,
      suggestions: [
        'project emberfall wiki',
        'project emberfall classes',
        'project emberfall weapons',
      ],
      exactResultUrls: ['https://store.steampowered.com/app/123/project_emberfall/'],
      gameResultUrls: ['https://www.youtube.com/watch?v=trailer'],
    },
    fast: { modelVersion: 3, classification: 'pass', score: 72 },
    trend: { modelVersion: 4, classification: 'pending', score: 0, keywordFreshness: 'unknown' },
    youtube: { checkedAt: '2026-08-04T01:00:00Z', videoCount: 8, channelCount: 6, totalViews: 120000 },
    siteType: {
      modelVersion: 2,
      type: 'wiki',
      channel: 'wiki',
      browserPlayable: false,
      onlinePlatformCount: 0,
      reasons: ['已进入Steam Top Wishlists'],
    },
    ...overrides,
  };
}

test('parses release date from Steam search result rows', () => {
  const html = `
    <a class="search_result_row ds_collapse_flag" href="https://store.steampowered.com/app/123/Project_Emberfall/">
      <div class="responsive_search_name_combined">
        <span class="title">Project Emberfall</span>
        <div class="col search_released responsive_secondrow">Sep 12, 2026</div>
      </div>
    </a>`;
  const [entry] = parseSteamSearch(html);
  assert.equal(entry.gameName, 'Project Emberfall');
  assert.equal(entry.releaseDate, 'Sep 12, 2026');
});

test('prioritizes an unreleased high-wishlist game with guide depth and trailer momentum', () => {
  const candidate = prelaunchCandidate();
  const result = analyzeWikiPrelaunch(candidate, NOW);
  assert.equal(result.classification, 'priority');
  assert.equal(result.wishlistRank, 18);
  assert.equal(result.wishlistRankGain, 14);
  assert.equal(result.releaseState, 'pre-release');
  assert.equal(result.allowsIndependent, true);
});

test('allows a verified open-market Steam prelaunch guide opportunity before Trends breaks out', () => {
  const candidate = prelaunchCandidate();
  applyFinalRecommendation(candidate);
  assert.equal(candidate.recommendation, 'independent');
  assert.equal(candidate.wikiPrelaunch.classification, 'priority');
  assert.match(candidate.siteType.reasons.join(' '), /Steam愿望单榜当前第18名/);
});

test('blocks a wishlist-hot game when a dedicated wiki already occupies the query', () => {
  const candidate = prelaunchCandidate({
    seo: {
      ...prelaunchCandidate().seo,
      exactResultUrls: [
        'https://store.steampowered.com/app/123/project_emberfall/',
        'https://projectemberfall.wiki/classes',
      ],
    },
  });
  applyFinalRecommendation(candidate);
  assert.notEqual(candidate.recommendation, 'independent');
  assert.equal(candidate.marketFreshness.status, 'occupied');
});

test('does not treat wishlist rank alone as enough when guide intent is absent', () => {
  const candidate = prelaunchCandidate({
    seo: { ...prelaunchCandidate().seo, suggestions: [] },
    youtube: { checkedAt: '2026-08-04T01:00:00Z', videoCount: 0, channelCount: 0, totalViews: 0 },
  });
  const result = analyzeWikiPrelaunch(candidate, NOW);
  assert.notEqual(result.classification, 'priority');
  assert.equal(result.hasGuideDepth, false);
});
