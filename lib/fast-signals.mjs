import { classifySiteType, isOnlineSource, isWikiSource, sourcePlatformKey } from './site-type.mjs';

const FAST_MODEL_VERSION = 3;
const DAY = 86400000;
const GAME_SUGGESTION_TERMS = /\b(game|games|gameplay|walkthrough|playthrough|itch|steam|wiki|guide|controls|ending|release date|map|online|play|unblocked|fullscreen)\b/i;
const ONLINE_SUGGESTION_TERMS = /\b(play|online|unblocked|controls?|fullscreen|browser|html5)\b/i;
const WIKI_SUGGESTION_TERMS = /\b(wiki|guide|walkthrough|playthrough|ending|map|characters?|items?|builds?)\b/i;
const SHARED_HIGH_QUALITY_KINDS = new Set(['trends-rising-7d', 'trends-rising-30d', 'itch-featured', 'itch-popular', 'newgrounds-top', 'competitor-sitemap']);
const ONLINE_HIGH_QUALITY_KINDS = new Set(['crazygames-new', 'poki-new', 'y8-new', 'gamepix-new', 'lagged-new', 'newgrounds-top', 'newgrounds-new', 'itch-popular']);
const WIKI_HIGH_QUALITY_KINDS = new Set(['steam-popular-new', 'steam-new', 'itch-featured']);

function parseTime(value, fallback = 0) { const time = Date.parse(value || ''); return Number.isFinite(time) ? time : fallback; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function normalizeUrl(value = '') { try { const url = new URL(value); url.hash = ''; return url.toString(); } catch { return ''; } }
function gameSuggestions(seo = {}) { return unique((seo.suggestions || []).map(String).filter((value) => GAME_SUGGESTION_TERMS.test(value.toLowerCase())).map((value) => value.toLowerCase().trim())); }

function sourceStats(candidate, nowMs) {
  const sources = candidate.sources || [];
  const uniqueSources = new Map();
  for (const source of sources) {
    const id = source.sourceId || source.kind || source.url;
    const firstSeen = parseTime(source.firstSeen, parseTime(candidate.firstSeen, nowMs));
    const current = uniqueSources.get(id);
    if (!current || firstSeen < current.firstSeen) uniqueSources.set(id, { ...source, firstSeen });
  }
  const list = [...uniqueSources.values()];

  // A portal may expose the same game through several feeds. Count those feeds
  // once for spread and freshness signals, while retaining raw records for rank
  // changes and diagnostics.
  const evidenceFirstSeen = new Map();
  for (const source of list) {
    const key = sourcePlatformKey(source) || source.sourceId || source.kind || source.url;
    const current = evidenceFirstSeen.get(key);
    if (!Number.isFinite(current) || source.firstSeen < current) evidenceFirstSeen.set(key, source.firstSeen);
  }
  const evidenceTimes = [...evidenceFirstSeen.values()];
  const sourceAdded24h = evidenceTimes.filter((firstSeen) => nowMs - firstSeen <= DAY).length;
  const sourceAdded48h = evidenceTimes.filter((firstSeen) => nowMs - firstSeen <= 2 * DAY).length;
  const onlineSources = list.filter(isOnlineSource);
  const wikiSources = list.filter(isWikiSource);
  const onlineHighQualityCount = new Set(
    onlineSources
      .filter((source) => ONLINE_HIGH_QUALITY_KINDS.has(source.kind) || ONLINE_HIGH_QUALITY_KINDS.has(source.sourceId))
      .map(sourcePlatformKey)
      .filter(Boolean),
  ).size;
  const wikiHighQualityCount = new Set(
    wikiSources
      .filter((source) => WIKI_HIGH_QUALITY_KINDS.has(source.kind) || WIKI_HIGH_QUALITY_KINDS.has(source.sourceId))
      .map(sourcePlatformKey)
      .filter(Boolean),
  ).size;
  const sharedHighQualityCount = new Set(
    list
      .filter((source) => SHARED_HIGH_QUALITY_KINDS.has(source.kind) || SHARED_HIGH_QUALITY_KINDS.has(source.sourceId))
      .map((source) => sourcePlatformKey(source) || source.kind || source.sourceId)
      .filter(Boolean),
  ).size;
  const onlinePlatformCount = new Set(onlineSources.map(sourcePlatformKey).filter(Boolean)).size;
  const rankGains = list.map((source) => {
    const previous = Number(source.previousRank || 0), current = Number(source.currentRank || 0);
    return previous > 0 && current > 0 ? Math.max(0, previous - current) : 0;
  });
  const maxRankGain = rankGains.length ? Math.max(...rankGains) : 0;
  const bestRank = list.map((source) => Number(source.bestRank || source.currentRank || 0)).filter((value) => value > 0).sort((a, b) => a - b)[0] || 0;
  return {
    sourceCount: evidenceFirstSeen.size,
    rawSourceCount: list.length,
    sourceAdded24h,
    sourceAdded48h,
    onlineSourceCount: onlineSources.length,
    onlinePlatformCount,
    wikiSourceCount: wikiSources.length,
    onlineHighQualityCount,
    wikiHighQualityCount,
    sharedHighQualityCount,
    highQualityCount: sharedHighQualityCount + onlineHighQualityCount + wikiHighQualityCount,
    maxRankGain,
    bestRank,
  };
}

function onlineScore({ source, directRising, onlineSuggestions, newSuggestionCount, newSerpPageCount, youtubeChannels, youtubeVideos, youtubeViews, seoScore, nameRisk }) {
  let score = 0;
  if (directRising) score += 35;
  score += Math.min(30, source.sourceAdded24h * 10);
  score += Math.min(12, Math.max(0, source.sourceAdded48h - source.sourceAdded24h) * 4);
  score += Math.min(30, source.onlineHighQualityCount * 10);
  if (source.onlinePlatformCount >= 2) score += 20;
  else if (source.onlinePlatformCount === 1) score += 8;
  if (source.sourceCount >= 3) score += 6;
  score += Math.min(12, Math.round(source.maxRankGain / 3));
  if (source.bestRank > 0 && source.bestRank <= 10) score += 15;
  else if (source.bestRank > 0 && source.bestRank <= 20) score += 10;
  else if (source.bestRank > 0 && source.bestRank <= 30) score += 5;
  score += Math.min(20, onlineSuggestions.length * 5);
  score += Math.min(15, newSuggestionCount * 5);
  score += Math.min(12, newSerpPageCount * 4);
  score += Math.min(8, youtubeChannels * 2);
  if (youtubeVideos >= 6) score += 3;
  if (youtubeViews >= 20000) score += 3;
  score += Math.min(15, Math.max(0, Math.round((seoScore - 35) * 0.35)));
  score -= Math.max(0, nameRisk - 10);
  return score;
}

function wikiScore({ source, directRising, wikiSuggestions, newSuggestionCount, newSerpPageCount, youtubeChannels, youtubeVideos, youtubeViews, seoScore, nameRisk }) {
  let score = 0;
  if (directRising) score += 35;
  score += Math.min(24, source.sourceAdded24h * 8);
  score += Math.min(12, Math.max(0, source.sourceAdded48h - source.sourceAdded24h) * 4);
  score += Math.min(18, (source.wikiHighQualityCount + source.sharedHighQualityCount) * 6);
  if (source.sourceCount >= 2) score += 8;
  if (source.sourceCount >= 3) score += 6;
  score += Math.min(12, Math.round(source.maxRankGain / 3));
  if (source.bestRank > 0 && source.bestRank <= 10) score += 8;
  else if (source.bestRank > 0 && source.bestRank <= 30) score += 4;
  score += Math.min(18, wikiSuggestions.length * 5);
  score += Math.min(18, newSuggestionCount * 6);
  score += Math.min(16, newSerpPageCount * 4);
  score += Math.min(18, youtubeChannels * 3);
  if (youtubeVideos >= 8) score += 6; else if (youtubeVideos >= 3) score += 3;
  if (youtubeViews >= 100000) score += 10; else if (youtubeViews >= 20000) score += 6; else if (youtubeViews >= 3000) score += 3;
  score += Math.min(18, Math.max(0, Math.round((seoScore - 40) * 0.45)));
  score -= Math.max(0, nameRisk - 8);
  return score;
}

export function calculateFastSignals(candidate, previousFast = {}, nowMs = Date.now()) {
  const seo = candidate.seo || {};
  const kinds = new Set((candidate.sources || []).flatMap((source) => [source.kind, source.sourceId]).filter(Boolean));
  const source = sourceStats(candidate, nowMs);
  const typeInfo = candidate.siteType?.modelVersion === 2 ? candidate.siteType : classifySiteType(candidate);
  const channel = typeInfo.type || 'pending';
  const suggestions = gameSuggestions(seo);
  const onlineSuggestions = suggestions.filter((value) => ONLINE_SUGGESTION_TERMS.test(value));
  const wikiSuggestions = suggestions.filter((value) => WIKI_SUGGESTION_TERMS.test(value));
  const hasSuggestionBaseline = Array.isArray(previousFast.suggestionSnapshot);
  const previousSuggestions = new Set(previousFast.suggestionSnapshot || []);
  const newSuggestionCount = hasSuggestionBaseline ? suggestions.filter((value) => !previousSuggestions.has(value)).length : 0;
  const serpUrls = unique((seo.exactResultUrls || []).map(normalizeUrl));
  const hasSerpBaseline = Array.isArray(previousFast.serpSnapshot);
  const previousSerp = new Set(previousFast.serpSnapshot || []);
  const newSerpPageCount = hasSerpBaseline ? serpUrls.filter((value) => !previousSerp.has(value)).length : 0;
  const directRising = [...kinds].some((kind) => /^trends-rising-(7d|30d)(-|$)/.test(kind));
  const youtube = candidate.youtube || {};
  const youtubeChannels = Number(youtube.channelCount || 0);
  const youtubeVideos = Number(youtube.videoCount || 0);
  const youtubeViews = Number(youtube.totalViews || 0);
  const seoScore = Number(seo.score || 0);
  const nameRisk = Number(seo.nameRisk ?? 30);
  const entityConflict = Boolean(seo.entityConflict);
  const inputs = { source, directRising, onlineSuggestions, wikiSuggestions, newSuggestionCount, newSerpPageCount, youtubeChannels, youtubeVideos, youtubeViews, seoScore, nameRisk };

  let score = channel === 'online' ? onlineScore(inputs) : wikiScore(inputs);
  if (channel === 'pending') score = Math.round((onlineScore(inputs) + wikiScore(inputs)) / 2);
  if (entityConflict || seo.classification === 'reject') score = 0;
  score = Math.max(0, Math.min(100, score));

  let classification = 'weak';
  if (entityConflict || seo.classification === 'reject') classification = 'reject';
  else if (channel === 'online' && source.onlinePlatformCount >= 2 && seoScore >= 35 && nameRisk <= 20) classification = 'pass';
  else if (channel === 'online' && (directRising || score >= 42 || (source.sourceAdded24h >= 2 && seoScore >= 42))) classification = 'pass';
  else if (channel !== 'online' && (directRising || score >= 45 || (source.sourceAdded24h >= 2 && seoScore >= 55) || (youtubeChannels >= 5 && youtubeVideos >= 6))) classification = 'pass';
  else if (score >= 25) classification = 'watch';

  const reasons = [];
  if (channel === 'online') reasons.push('使用在线游戏专用快速热度模型');
  else if (channel === 'wiki') reasons.push('使用Wiki攻略专用内容生态模型');
  if (directRising) reasons.push('来自Google Trends相关查询上涨信号');
  if (source.onlinePlatformCount >= 2) reasons.push(`已在${source.onlinePlatformCount}个在线游戏平台出现`);
  if (source.sourceAdded24h >= 2) reasons.push(`24小时新增${source.sourceAdded24h}个独立来源`);
  else if (source.sourceAdded48h >= 2) reasons.push(`48小时新增${source.sourceAdded48h}个独立来源`);
  if (source.maxRankGain >= 5) reasons.push(`榜单最高上升${source.maxRankGain}位`);
  if (source.bestRank > 0 && source.bestRank <= 20) reasons.push(`已进入平台前${source.bestRank}名`);
  if (onlineSuggestions.length && channel === 'online') reasons.push(`出现${onlineSuggestions.length}个Play Online/Controls长尾`);
  if (wikiSuggestions.length && channel === 'wiki') reasons.push(`出现${wikiSuggestions.length}个Wiki/Guide长尾`);
  if (newSuggestionCount) reasons.push(`自动补全新增${newSuggestionCount}个游戏长尾`);
  if (newSerpPageCount) reasons.push(`SERP新增${newSerpPageCount}个相关页面`);
  if (!hasSuggestionBaseline || !hasSerpBaseline) reasons.push('已建立搜索生态基线，下一轮开始计算新增量');
  if (youtubeChannels) reasons.push(`YouTube近7天${youtubeVideos}个视频／${youtubeChannels}个频道`);
  if (classification === 'weak' && reasons.length <= 1) reasons.push('暂未形成明显扩散或搜索生态增长');
  if (classification === 'reject') reasons.push('搜索意图或实体冲突未通过');

  return {
    modelVersion: FAST_MODEL_VERSION,
    profile: channel,
    checkedAt: new Date(nowMs).toISOString(),
    score,
    classification,
    reasons,
    ...source,
    suggestionCount: suggestions.length,
    onlineSuggestionCount: onlineSuggestions.length,
    wikiSuggestionCount: wikiSuggestions.length,
    newSuggestionCount,
    newSerpPageCount,
    suggestionBaselineReady: hasSuggestionBaseline,
    serpBaselineReady: hasSerpBaseline,
    youtubeEnabled: Boolean(youtube.checkedAt),
    youtubeChannels,
    youtubeVideos,
    youtubeViews,
    suggestionSnapshot: suggestions,
    serpSnapshot: serpUrls,
  };
}

function nameMatches(title = '', gameName = '') {
  const normalize = (value) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
  const target = normalize(gameName), text = normalize(title);
  return target.length >= 3 && text.includes(target);
}

export async function verifyYoutubeSignals(gameName, apiKey) {
  if (!apiKey) return null;
  const publishedAfter = new Date(Date.now() - 7 * DAY).toISOString();
  const query = new URLSearchParams({ part: 'snippet', type: 'video', order: 'date', maxResults: '25', q: `${gameName} gameplay`, publishedAfter, key: apiKey });
  const searchResponse = await fetch(`https://www.googleapis.com/youtube/v3/search?${query}`);
  if (!searchResponse.ok) throw new Error(`YouTube search returned ${searchResponse.status}`);
  const searchData = await searchResponse.json();
  const matched = (searchData.items || []).filter((item) => nameMatches(`${item.snippet?.title || ''} ${item.snippet?.description || ''}`, gameName));
  const ids = matched.map((item) => item.id?.videoId).filter(Boolean);
  if (!ids.length) return { checkedAt: new Date().toISOString(), videoCount: 0, channelCount: 0, totalViews: 0, recent24h: 0 };
  const statsQuery = new URLSearchParams({ part: 'statistics,snippet', id: ids.join(','), key: apiKey });
  const statsResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?${statsQuery}`);
  if (!statsResponse.ok) throw new Error(`YouTube stats returned ${statsResponse.status}`);
  const statsData = await statsResponse.json();
  const items = statsData.items || [];
  return {
    checkedAt: new Date().toISOString(),
    videoCount: items.length,
    channelCount: new Set(items.map((item) => item.snippet?.channelId).filter(Boolean)).size,
    totalViews: items.reduce((sum, item) => sum + Number(item.statistics?.viewCount || 0), 0),
    recent24h: items.filter((item) => Date.now() - Date.parse(item.snippet?.publishedAt || 0) <= DAY).length,
  };
}

export { FAST_MODEL_VERSION };
