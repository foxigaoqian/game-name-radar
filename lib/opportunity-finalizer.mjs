import { analyzeMarketFreshness } from './market-freshness.mjs';
import { classifySiteType } from './site-type.mjs';
import { TREND_MODEL_VERSION } from './trend-queue.mjs';
import { analyzeWikiPrelaunch } from './wiki-prelaunch.mjs';
import { analyzeOnlineSocialBuzz } from './social-buzz.mjs';

export function typeOf(candidate) {
  if (candidate.siteType?.modelVersion === 2) return candidate.siteType.type;
  candidate.siteType = classifySiteType(candidate);
  return candidate.siteType.type;
}

function attachEvaluationReasons(candidate, market, wikiPrelaunch, socialBuzz, channel) {
  const current = candidate.siteType || classifySiteType(candidate);
  const extraReasons = channel === 'wiki' ? wikiPrelaunch.reasons : channel === 'online' ? socialBuzz.reasons : [];
  const reasons = [
    ...extraReasons,
    market.reason,
    ...(current.reasons || []),
  ].filter((reason, index, list) => reason && list.indexOf(reason) === index);
  candidate.siteType = { ...current, reasons };
  candidate.marketFreshness = market;
  if (channel === 'wiki') candidate.wikiPrelaunch = wikiPrelaunch;
  if (channel === 'online') candidate.social = socialBuzz;
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
  const market = analyzeMarketFreshness(candidate);
  const wikiPrelaunch = analyzeWikiPrelaunch(candidate);
  const socialBuzz = analyzeOnlineSocialBuzz(candidate);
  attachEvaluationReasons(candidate, market, wikiPrelaunch, socialBuzz, channel);
  const onlinePlatforms = Number(candidate.siteType?.onlinePlatformCount || candidate.fast?.onlinePlatformCount || 0);
  const standaloneNeedsIntentConfirmation = candidate.trend?.provider?.startsWith('apify-') && candidate.trend?.gameIntentConfirmed === false;
  const competitionOpen = market.competitionChecked
    && !['occupied', 'established', 'contested'].includes(market.status)
    && keywordFreshness !== 'existing';
  const onlineFreshEnough = keywordFreshness === 'new' || recentlyDiscovered(candidate);
  const onlineCanStandAlone = channel === 'online'
    && competitionOpen
    && onlineFreshEnough
    && socialBuzz.allowsIndependent;
  const wikiCanStandAlone = channel === 'wiki' && wikiPrelaunch.allowsIndependent && competitionOpen;
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
  else if (channel === 'wiki' && wikiPrelaunch.classification === 'prepare' && ['independent', 'page'].includes(seoClass)) recommendation = 'page';
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
  // 攻略游戏要求Steam预发布热度、攻略需求和竞争空缺同时成立。
  if (recommendation === 'independent' && channel === 'online' && !onlineCanStandAlone) recommendation = 'watch';
  if (recommendation === 'independent' && channel === 'wiki' && !wikiCanStandAlone) recommendation = 'watch';

  // Platform-only evidence is useful for routing scarce API quota, but cannot
  // justify a standalone domain before a real SERP provider confirms search intent.
  if (provisionalSeo && recommendation === 'independent') recommendation = 'page';

  const seoScore = Number(candidate.seo?.score || 0);
  const fastScore = Number(candidate.fast?.score || 0);
  const trendScore = Number(candidate.trend?.score || 0);
  const globalScore = Number(candidate.trend?.globalScore || 0);
  const wikiPrelaunchScore = Number(wikiPrelaunch.score || 0);
  const socialScore = Number(socialBuzz.score || 0);
  const weights = channel === 'online'
    ? { seo: 0.20, fast: 0.22, trend: 0.22, global: 0.04, prelaunch: 0, social: 0.32 }
    : { seo: 0.25, fast: 0.20, trend: 0.20, global: 0.05, prelaunch: 0.30, social: 0 };
  let finalScore = Math.round(
    seoScore * weights.seo
    + fastScore * weights.fast
    + trendScore * weights.trend
    + globalScore * weights.global
    + wikiPrelaunchScore * weights.prelaunch
    + socialScore * weights.social,
  );
  if (usRising) finalScore = Math.min(100, finalScore + 8);
  else if (globalRising) finalScore = Math.min(79, finalScore + 4);
  if (channel === 'online' && socialBuzz.classification === 'viral') finalScore = Math.min(100, finalScore + 8);
  if (channel === 'wiki' && wikiPrelaunch.classification === 'priority') finalScore = Math.min(100, finalScore + 8);
  if (keywordFreshness === 'existing' || entityConflict) finalScore = Math.min(finalScore, 69);
  if (standaloneNeedsIntentConfirmation) finalScore = Math.min(finalScore, 54);
  if (provisionalSeo) finalScore = Math.min(finalScore, 69);
  if (channel === 'online' && !onlineCanStandAlone) finalScore = Math.min(finalScore, socialBuzz.classification === 'pending' ? 49 : 59);
  if (channel === 'wiki' && !wikiCanStandAlone && wikiPrelaunch.classification === 'priority') finalScore = Math.min(finalScore, 59);
  if (recommendation === 'watch') finalScore = Math.min(finalScore, 59);
  if (['reject', 'pending', 'error'].includes(recommendation)) finalScore = 0;
  candidate.finalScore = finalScore;
  candidate.score = finalScore;
  candidate.level = recommendation;
  candidate.recommendation = recommendation;
  return candidate;
}

export function recommendationCounts(candidates) {
  const counts = { independent: 0, page: 0, watch: 0, reject: 0, pending: 0, error: 0 };
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
