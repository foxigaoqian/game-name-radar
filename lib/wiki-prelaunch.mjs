const WISHLIST_SOURCE_IDS = new Set(['steam-top-wishlist']);
const WISHLIST_KINDS = new Set(['steam-top-wishlist']);
const GUIDE_TERMS = /\b(wiki|guide|walkthrough|map|maps|build|builds|class|classes|character|characters|weapon|weapons|item|items|boss|bosses|quest|quests|craft|crafting|recipe|recipes|skill|skills|ending|endings|location|locations)\b/i;
const UNKNOWN_RELEASE = /\b(coming soon|to be announced|tba|tbd|q[1-4]\s+\d{4}|\d{4})\b/i;
const DAY = 86400000;

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sourceAliases(source = {}) {
  return [source.sourceId, source.kind, source.id].filter(Boolean);
}

function isWishlistSource(source = {}) {
  return sourceAliases(source).some((value) => WISHLIST_SOURCE_IDS.has(value) || WISHLIST_KINDS.has(value));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseReleaseWindow(value = '', nowMs = Date.now()) {
  const raw = String(value || '').trim();
  if (!raw) return { state: 'unknown', days: null, raw: '' };
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    const days = Math.ceil((parsed - nowMs) / DAY);
    return { state: days >= -2 ? 'pre-release' : 'released', days, raw };
  }
  if (UNKNOWN_RELEASE.test(raw)) return { state: 'pre-release', days: null, raw };
  return { state: 'unknown', days: null, raw };
}

function guideIntentSuggestions(candidate = {}) {
  return unique((candidate.seo?.suggestions || [])
    .map((value) => String(value).toLowerCase().trim())
    .filter((value) => GUIDE_TERMS.test(value)));
}

function rankScore(rank) {
  if (!rank) return 0;
  if (rank <= 10) return 30;
  if (rank <= 25) return 26;
  if (rank <= 50) return 22;
  if (rank <= 100) return 16;
  if (rank <= 200) return 10;
  return 4;
}

function rankMomentumScore(gain) {
  if (gain >= 30) return 16;
  if (gain >= 15) return 12;
  if (gain >= 8) return 8;
  if (gain >= 3) return 4;
  return 0;
}

function trailerScore(youtube = {}) {
  const views = number(youtube.totalViews);
  const videos = number(youtube.videoCount);
  const channels = number(youtube.channelCount);
  let score = 0;
  if (views >= 250000) score += 18;
  else if (views >= 100000) score += 15;
  else if (views >= 20000) score += 10;
  else if (views >= 5000) score += 5;
  if (channels >= 8) score += 7;
  else if (channels >= 4) score += 4;
  else if (videos >= 3) score += 2;
  return score;
}

function releaseWindowScore(window) {
  if (window.state !== 'pre-release') return 0;
  if (window.days === null) return 5;
  if (window.days >= 21 && window.days <= 180) return 12;
  if (window.days >= 7 && window.days < 21) return 7;
  if (window.days > 180 && window.days <= 365) return 7;
  if (window.days >= 0) return 4;
  return 0;
}

export function analyzeWikiPrelaunch(candidate = {}, nowMs = Date.now()) {
  const sources = candidate.sources || [];
  const wishlistSources = sources.filter(isWishlistSource);
  const ranks = wishlistSources
    .map((source) => number(source.currentRank || source.bestRank))
    .filter((value) => value > 0);
  const wishlistRank = ranks.length ? Math.min(...ranks) : 0;
  const wishlistBestRank = wishlistSources
    .map((source) => number(source.bestRank || source.currentRank))
    .filter((value) => value > 0)
    .sort((a, b) => a - b)[0] || 0;
  const wishlistRankGain = wishlistSources.reduce((max, source) => {
    const previous = number(source.previousRank);
    const current = number(source.currentRank);
    return Math.max(max, previous > 0 && current > 0 ? Math.max(0, previous - current) : 0);
  }, 0);
  const firstWishlistSeen = wishlistSources
    .map((source) => Date.parse(source.firstSeen || ''))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0] || 0;
  const wishlistAgeDays = firstWishlistSeen ? Math.max(0, Math.floor((nowMs - firstWishlistSeen) / DAY)) : null;
  const releaseTexts = unique(wishlistSources.map((source) => source.date || source.releaseDate));
  const releaseWindows = releaseTexts.map((value) => parseReleaseWindow(value, nowMs));
  const releaseWindow = releaseWindows.find((item) => item.state === 'pre-release')
    || releaseWindows.find((item) => item.state === 'released')
    || { state: wishlistSources.length ? 'pre-release' : 'unknown', days: null, raw: '' };
  const guideSuggestions = guideIntentSuggestions(candidate);
  const youtube = candidate.youtube || {};
  const youtubeViews = number(youtube.totalViews);
  const youtubeVideos = number(youtube.videoCount);
  const youtubeChannels = number(youtube.channelCount);

  let score = 0;
  score += rankScore(wishlistRank || wishlistBestRank);
  score += rankMomentumScore(wishlistRankGain);
  score += trailerScore(youtube);
  score += releaseWindowScore(releaseWindow);
  if (wishlistAgeDays !== null && wishlistAgeDays <= 7) score += 8;
  else if (wishlistAgeDays !== null && wishlistAgeDays <= 21) score += 4;
  if (guideSuggestions.length >= 5) score += 18;
  else if (guideSuggestions.length >= 3) score += 13;
  else if (guideSuggestions.length >= 1) score += 7;
  if (candidate.trend?.keywordFreshness === 'new') score += 8;
  if (['rising', 'breakout'].includes(candidate.trend?.classification)) score += 8;
  score = Math.max(0, Math.min(100, score));

  const hasWishlistEvidence = wishlistSources.length > 0 && (wishlistRank > 0 || wishlistBestRank > 0);
  const hasDemandAcceleration = wishlistRankGain >= 3 || youtubeViews >= 20000 || youtubeChannels >= 4 || ['rising', 'breakout'].includes(candidate.trend?.classification);
  const hasGuideDepth = guideSuggestions.length >= 1;

  let classification = 'weak';
  if (hasWishlistEvidence && releaseWindow.state === 'pre-release' && wishlistRank <= 100 && hasGuideDepth && hasDemandAcceleration && score >= 60) classification = 'priority';
  else if (hasWishlistEvidence && releaseWindow.state === 'pre-release' && wishlistRank <= 200 && score >= 42) classification = 'prepare';
  else if (hasWishlistEvidence || score >= 25) classification = 'watch';

  const reasons = [];
  if (wishlistRank) reasons.push(`Steam愿望单榜当前第${wishlistRank}名`);
  if (wishlistRankGain >= 3) reasons.push(`愿望单榜较上轮上升${wishlistRankGain}位`);
  if (wishlistAgeDays !== null && wishlistAgeDays <= 7) reasons.push('最近7天首次进入愿望单监控榜');
  if (releaseWindow.state === 'pre-release') reasons.push(releaseWindow.raw ? `尚未发售：${releaseWindow.raw}` : 'Steam预发布游戏');
  if (guideSuggestions.length) reasons.push(`已出现${guideSuggestions.length}个Wiki/攻略型搜索长尾`);
  if (youtubeViews >= 5000) reasons.push(`近7天相关视频累计约${youtubeViews.toLocaleString('en-US')}次播放`);
  if (!hasWishlistEvidence) reasons.push('尚未进入Steam Top Wishlists监控榜');
  if (hasWishlistEvidence && !hasGuideDepth) reasons.push('愿望单有热度，但攻略型搜索需求仍不足');
  if (releaseWindow.state === 'released') reasons.push('游戏已经发售，不再按预发布抢跑机会处理');

  return {
    modelVersion: 1,
    checkedAt: new Date(nowMs).toISOString(),
    score,
    classification,
    reasons,
    wishlistRank,
    wishlistBestRank,
    wishlistRankGain,
    wishlistAgeDays,
    releaseState: releaseWindow.state,
    releaseDateText: releaseWindow.raw,
    releaseDays: releaseWindow.days,
    guideIntentCount: guideSuggestions.length,
    guideSuggestions,
    youtubeViews,
    youtubeVideos,
    youtubeChannels,
    hasWishlistEvidence,
    hasDemandAcceleration,
    hasGuideDepth,
    allowsIndependent: classification === 'priority',
  };
}

export function wikiPrelaunchLabel(classification) {
  return {
    priority: 'Steam预发布·优先抢跑',
    prepare: 'Steam预发布·先建观察页',
    watch: 'Steam预发布·继续观察',
    weak: '预发布证据不足',
  }[classification] || '预发布证据不足';
}
