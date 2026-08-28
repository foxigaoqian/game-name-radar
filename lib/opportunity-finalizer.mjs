import { analyzeMarketFreshness } from './market-freshness.mjs';
import { classifySiteType } from './site-type.mjs';
import { TREND_MODEL_VERSION } from './trend-queue.mjs';
import { analyzeWikiPrelaunch } from './wiki-prelaunch.mjs';
import { analyzeOnlineSocialBuzz } from './social-buzz.mjs';

const OPPORTUNITY_MODEL_VERSION = 3;
const OPPORTUNITY_WEIGHTS = {
  socialSpread: 0.30,
  growthVelocity: 0.25,
  searchFormation: 0.15,
  contentExpandability: 0.15,
  serpGap: 0.10,
  nameSafety: 0.05,
};

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function searchFormationScore(candidate = {}) {
  const classification = candidate.trend?.classification || 'pending';
  let score = { breakout: 100, rising: 85, strong: 70, moderate: 55, weak: 25, none: 0, pending: 15, error: 0 }[classification] ?? 15;
  if (candidate.trend?.keywordFreshness === 'new') score += 10;
  if (candidate.trend?.keywordFreshness === 'existing') score = Math.min(score, 25);
  return clamp(score);
}

function growthVelocityScore(candidate, channel, wikiPrelaunch) {
  if (channel === 'wiki') {
    const gain = Number(wikiPrelaunch.wishlistRankGain || 0);
    const rank = Number(wikiPrelaunch.wishlistRank || 0);
    let velocity = gain >= 30 ? 70 : gain >= 15 ? 60 : gain >= 8 ? 50 : gain >= 3 ? 35 : 0;
    if (wikiPrelaunch.wishlistAgeDays !== null && wikiPrelaunch.wishlistAgeDays <= 7) velocity += 20;
    if (rank > 0 && rank <= 10) velocity += 30;
    else if (rank > 0 && rank <= 25) velocity += 24;
    else if (rank > 0 && rank <= 50) velocity += 18;
    else if (rank > 0 && rank <= 100) velocity += 10;
    return clamp(velocity);
  }
  const fast = candidate.fast || {};
  return clamp(
    Number(fast.sourceAdded24h || 0) * 25
    + Math.min(30, Number(fast.maxRankGain || 0) * 3)
    + Math.min(30, Number(fast.onlinePlatformCount || 0) * 15),
  );
}

function contentExpandabilityScore(candidate, channel, wikiPrelaunch) {
  const count = channel === 'wiki'
    ? Number(wikiPrelaunch.guideIntentCount || 0)
    : Number(candidate.fast?.onlineSuggestionCount || 0);
  if (count >= 5) return 100;
  if (count >= 3) return 80;
  if (count >= 2) return 55;
  if (count >= 1) return 30;
  return 0;
}

function serpGapScore(status) {
  return { greenfield: 100, 'unconfirmed-new': 60, unknown: 25, contested: 15, occupied: 0, established: 0 }[status] ?? 0;
}

function analyzeOpportunity(candidate, channel, market, wikiPrelaunch, socialBuzz) {
  const nameRisk = Number(candidate.seo?.nameRisk ?? 30);
  const components = {
    socialSpread: clamp(socialBuzz.score),
    growthVelocity: growthVelocityScore(candidate, channel, wikiPrelaunch),
    searchFormation: searchFormationScore(candidate),
    contentExpandability: contentExpandabilityScore(candidate, channel, wikiPrelaunch),
    serpGap: serpGapScore(market.status),
    nameSafety: candidate.seo?.entityConflict ? 0 : clamp(100 - nameRisk * 4),
  };
  let score = Math.round(Object.entries(OPPORTUNITY_WEIGHTS)
    .reduce((sum, [key, weight]) => sum + components[key] * weight, 0));

  // 搜索结果少只代表供给少。没有传播、增长或搜索形成证据时，不能靠低竞争获得高分。
  if (!socialBuzz.hasExternalSpillover) score = Math.min(score, 59);
  if (market.status !== 'greenfield') score = Math.min(score, 69);
  if (candidate.trend?.keywordFreshness === 'existing' || candidate.seo?.entityConflict) score = Math.min(score, 49);

  const hardGates = {
    externalSpillover: Boolean(socialBuzz.hasExternalSpillover && socialBuzz.allowsIndependent),
    growthVelocity: channel === 'wiki'
      ? Boolean(wikiPrelaunch.hasSteamMomentum)
      : components.growthVelocity >= 45,
    searchFormation: channel === 'wiki'
      ? Boolean(wikiPrelaunch.hasSearchFormation)
      : components.searchFormation >= 70,
    contentDepth: channel === 'wiki'
      ? Boolean(wikiPrelaunch.hasGuideDepth)
      : components.contentExpandability >= 55,
    competitionOpen: market.status === 'greenfield',
    nameSafe: !candidate.seo?.entityConflict && nameRisk <= (channel === 'wiki' ? 12 : 18),
  };
  const allowsIndependent = Object.values(hardGates).every(Boolean) && score >= 70;
  const testGates = {
    growthVelocity: channel === 'wiki'
      ? Boolean(wikiPrelaunch.hasSteamMomentum)
      : (components.growthVelocity >= 35 || candidate.fast?.classification === 'pass'),
    searchFormation: channel === 'wiki'
      ? Boolean(wikiPrelaunch.hasSearchFormation)
      : components.searchFormation >= 55,
    contentDepth: channel === 'wiki'
      ? Number(wikiPrelaunch.guideIntentCount || 0) >= 2
      : components.contentExpandability >= 30,
    competitionTestable: ['greenfield', 'unconfirmed-new'].includes(market.status),
    nameSafe: !candidate.seo?.entityConflict && nameRisk <= (channel === 'wiki' ? 16 : 20),
  };
  // 测试局不是最终独立站确认。测试分不包含社媒权重，避免Provider未配置/报错
  // 被误当成“没有热度”；社媒仍会继续阻断 strict independent，直到跨平台传播被确认。
  const testScore = Math.round(
    components.growthVelocity * 0.35
    + components.searchFormation * 0.25
    + components.contentExpandability * 0.15
    + components.serpGap * 0.15
    + components.nameSafety * 0.10,
  );
  const allowsTest = Object.values(testGates).every(Boolean) && testScore >= 60;
  const reasons = [];
  if (!hardGates.externalSpillover) reasons.push('缺少多平台、多独立创作者的外溢传播');
  if (!hardGates.growthVelocity) reasons.push(channel === 'wiki' ? 'Steam近期增长速度不足' : '24–48小时平台扩散速度不足');
  if (!hardGates.searchFormation) reasons.push('搜索需求尚未形成');
  if (!hardGates.contentDepth) reasons.push('可扩展内容主题不足');
  if (!hardGates.competitionOpen) reasons.push('SERP尚未确认是严格空白市场');
  if (!hardGates.nameSafe) reasons.push('名称歧义或实体冲突风险过高');

  return {
    modelVersion: OPPORTUNITY_MODEL_VERSION,
    checkedAt: new Date().toISOString(),
    weights: OPPORTUNITY_WEIGHTS,
    components,
    hardGates,
    testGates,
    testScore,
    allowsTest,
    allowsIndependent,
    score,
    reasons,
  };
}

export function typeOf(candidate) {
  if (candidate.siteType?.modelVersion === 2) return candidate.siteType.type;
  candidate.siteType = classifySiteType(candidate);
  return candidate.siteType.type;
}

function attachEvaluationReasons(candidate, market, wikiPrelaunch, socialBuzz, opportunity, channel) {
  const current = candidate.siteType || classifySiteType(candidate);
  const extraReasons = channel === 'wiki' ? wikiPrelaunch.reasons : channel === 'online' ? socialBuzz.reasons : [];
  const reasons = [
    market.reason,
    ...extraReasons,
    ...(channel === 'wiki' ? socialBuzz.reasons : []),
    ...(opportunity.reasons || []),
    ...(current.reasons || []),
  ].filter((reason, index, list) => reason && list.indexOf(reason) === index);
  candidate.siteType = { ...current, reasons };
  candidate.marketFreshness = market;
  candidate.opportunity = opportunity;
  if (channel === 'wiki') candidate.wikiPrelaunch = wikiPrelaunch;
  candidate.social = socialBuzz;
}

function recentlyDiscovered(candidate, maxDays = 14) {
  const firstSeen = Date.parse(candidate.firstSeen || '');
  return Number.isFinite(firstSeen) && Date.now() - firstSeen <= maxDays * 86400000;
}

export function applyFinalRecommendation(candidate) {
  const seoClass = candidate.seo?.classification || 'pending';
  const fastClass = candidate.fast?.classification || 'pending';
  const demandClass = candidate.trend?.classification || 'pending';
  const globalDemandClass = candidate.trend?.globalClassification || null;
  const globalRising = ['rising', 'breakout'].includes(globalDemandClass);
  const usRising = ['rising', 'breakout'].includes(demandClass);
  const nameRisk = Number(candidate.seo?.nameRisk ?? 30);
  const keywordFreshness = candidate.trend?.keywordFreshness || 'unknown';
  const entityConflict = Boolean(candidate.seo?.entityConflict || candidate.trend?.entityConflict);
  const provisionalSeo = Boolean(candidate.seo?.provisional || candidate.seo?.provider === 'evidence-fallback');
  const channel = typeOf(candidate);
  const socialBuzz = analyzeOnlineSocialBuzz(candidate);
  const market = analyzeMarketFreshness(candidate);
  const wikiPrelaunch = analyzeWikiPrelaunch({ ...candidate, social: socialBuzz });
  const opportunity = analyzeOpportunity(candidate, channel, market, wikiPrelaunch, socialBuzz);
  attachEvaluationReasons(candidate, market, wikiPrelaunch, socialBuzz, opportunity, channel);
  const onlinePlatforms = Number(candidate.siteType?.onlinePlatformCount || candidate.fast?.onlinePlatformCount || 0);
  const standaloneNeedsIntentConfirmation = candidate.trend?.provider?.startsWith('apify-') && candidate.trend?.gameIntentConfirmed === false;
  const competitionOpen = market.allowsIndependent && keywordFreshness !== 'existing';
  const onlineFreshEnough = keywordFreshness === 'new'
    || (recentlyDiscovered(candidate) && socialBuzz.classification === 'viral');
  const onlineCanStandAlone = channel === 'online'
    && competitionOpen
    && onlineFreshEnough
    && socialBuzz.allowsIndependent
    && opportunity.allowsIndependent;
  const wikiCanStandAlone = channel === 'wiki'
    && wikiPrelaunch.allowsIndependent
    && opportunity.allowsIndependent;
  const onlineCanTest = channel === 'online'
    && candidate.siteType?.browserPlayable
    && fastClass === 'pass'
    && opportunity.allowsTest;
  const wikiCanTest = channel === 'wiki'
    && ['pass', 'watch'].includes(fastClass)
    && Boolean(wikiPrelaunch.hasWishlistEvidence || wikiPrelaunch.hasSteamMomentum)
    && opportunity.allowsTest;
  let recommendation = 'pending';

  if (candidate.seo?.modelVersion !== 5) recommendation = 'pending';
  else if (seoClass === 'error') recommendation = 'error';
  else if (seoClass === 'reject' || entityConflict || fastClass === 'reject') recommendation = 'reject';
  else if (seoClass === 'pending' || fastClass === 'pending') recommendation = 'pending';
  else if (usRising && standaloneNeedsIntentConfirmation) recommendation = 'watch';
  else if (onlineCanStandAlone && ['independent', 'page'].includes(seoClass) && nameRisk <= 18 && candidate.siteType?.browserPlayable) {
    recommendation = fastClass === 'pass' || onlinePlatforms >= 2 || socialBuzz.classification === 'viral' ? 'independent' : 'watch';
  }
  else if (wikiCanStandAlone && seoClass === 'independent' && ['pass', 'watch'].includes(fastClass) && nameRisk <= 12) recommendation = 'independent';
  else if (onlineCanTest && ['independent', 'page'].includes(seoClass)) recommendation = 'test-now';
  else if (wikiCanTest && ['independent', 'page'].includes(seoClass)) recommendation = 'test-now';
  else if (channel === 'wiki' && wikiPrelaunch.classification === 'prepare' && ['independent', 'page'].includes(seoClass)) recommendation = 'watch';
  else if (channel === 'online' && ['pending', 'weak'].includes(socialBuzz.classification)) recommendation = 'watch';
  else if (usRising && ['independent', 'page'].includes(seoClass)) recommendation = 'watch';
  else if (globalRising && ['moderate', 'strong'].includes(demandClass) && ['independent', 'page'].includes(seoClass)) recommendation = 'page';
  else if (globalRising) recommendation = 'watch';
  else if (demandClass === 'error' || demandClass === 'pending') recommendation = fastClass === 'watch' ? 'watch' : 'pending';
  else if (demandClass === 'none') recommendation = fastClass === 'weak' ? 'reject' : 'watch';
  else if (demandClass === 'weak') recommendation = 'watch';
  else if (['independent', 'page'].includes(seoClass) && ['strong', 'moderate'].includes(demandClass)) recommendation = 'page';
  else if (fastClass === 'weak') recommendation = 'reject';
  else recommendation = 'watch';

  // 在线游戏和攻略游戏分别使用独立的硬门槛：
  // 在线游戏要求真实社媒传播、浏览器可玩、近期新词和竞争空缺；
  // 攻略游戏要求Steam近期增长、独立社媒外溢、攻略需求和竞争空缺同时成立。
  if (recommendation === 'independent' && channel === 'online' && !onlineCanStandAlone) recommendation = 'watch';
  if (recommendation === 'independent' && channel === 'wiki' && !wikiCanStandAlone) recommendation = 'watch';

  // Platform-only evidence is useful for routing scarce API quota, but cannot
  // justify a standalone domain before a real SERP provider confirms search intent.
  if (provisionalSeo && recommendation === 'independent') recommendation = 'page';

  let finalScore = opportunity.score;
  if (usRising) finalScore = Math.min(100, finalScore + 8);
  else if (globalRising) finalScore = Math.min(79, finalScore + 4);
  if (channel === 'online' && socialBuzz.classification === 'viral') finalScore = Math.min(100, finalScore + 8);
  if (channel === 'wiki' && wikiPrelaunch.classification === 'priority') finalScore = Math.min(100, finalScore + 8);
  if (keywordFreshness === 'existing' || entityConflict) finalScore = Math.min(finalScore, 69);
  if (standaloneNeedsIntentConfirmation) finalScore = Math.min(finalScore, 54);
  if (provisionalSeo) finalScore = Math.min(finalScore, 69);
  if (channel === 'online' && !onlineCanStandAlone && recommendation !== 'test-now') finalScore = Math.min(finalScore, socialBuzz.classification === 'pending' ? 49 : 59);
  if (channel === 'wiki' && !wikiCanStandAlone && wikiPrelaunch.classification === 'priority' && recommendation !== 'test-now') finalScore = Math.min(finalScore, 59);
  if (recommendation === 'test-now') finalScore = Math.max(50, Math.min(finalScore, 79));
  if (recommendation === 'watch') finalScore = Math.min(finalScore, 59);
  if (['reject', 'pending', 'error'].includes(recommendation)) finalScore = 0;
  candidate.finalScore = finalScore;
  candidate.score = finalScore;
  candidate.level = recommendation;
  candidate.recommendation = recommendation;
  return candidate;
}

export function recommendationCounts(candidates) {
  const counts = { independent: 0, 'test-now': 0, page: 0, watch: 0, reject: 0, pending: 0, error: 0 };
  for (const candidate of candidates) counts[candidate.recommendation || 'pending'] = (counts[candidate.recommendation || 'pending'] || 0) + 1;
  return counts;
}

export function channelCounts(candidates) {
  const counts = { online: { validated: 0, rising: 0, recommended: 0 }, wiki: { validated: 0, rising: 0, recommended: 0 }, pending: { validated: 0, rising: 0, recommended: 0 } };
  for (const candidate of candidates) {
    const channel = typeOf(candidate);
    if (candidate.trend?.modelVersion === TREND_MODEL_VERSION && !['pending', 'error'].includes(candidate.trend?.classification)) counts[channel].validated += 1;
    if (['rising', 'breakout'].includes(candidate.trend?.classification)) counts[channel].rising += 1;
    if (candidate.recommendation === 'independent') counts[channel].recommended += 1;
  }
  return counts;
}

export { OPPORTUNITY_MODEL_VERSION, OPPORTUNITY_WEIGHTS };
