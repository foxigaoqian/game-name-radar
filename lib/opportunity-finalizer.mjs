import { analyzeMarketFreshness } from './market-freshness.mjs';
import { classifySiteType } from './site-type.mjs';
import { TREND_MODEL_VERSION } from './trend-queue.mjs';

export function typeOf(candidate) {
  if (candidate.siteType?.modelVersion === 2) return candidate.siteType.type;
  candidate.siteType = classifySiteType(candidate);
  return candidate.siteType.type;
}

function attachMarketReason(candidate, market) {
  const current = candidate.siteType || classifySiteType(candidate);
  const reasons = [market.reason, ...(current.reasons || []).filter((reason) => reason !== market.reason)];
  candidate.siteType = { ...current, reasons };
  candidate.marketFreshness = market;
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
  attachMarketReason(candidate, market);
  const onlinePlatforms = Number(candidate.siteType?.onlinePlatformCount || candidate.fast?.onlinePlatformCount || 0);
  const standaloneNeedsIntentConfirmation = candidate.trend?.provider?.startsWith('apify-') && candidate.trend?.gameIntentConfirmed === false;
  let recommendation = 'pending';

  if (candidate.seo?.modelVersion !== 5) recommendation = 'pending';
  else if (seoClass === 'error') recommendation = 'error';
  else if (seoClass === 'reject' || entityConflict || fastClass === 'reject') recommendation = 'reject';
  else if (seoClass === 'pending' || fastClass === 'pending') recommendation = 'pending';
  else if (usRising && standaloneNeedsIntentConfirmation) recommendation = 'watch';
  else if (usRising && market.allowsIndependent && channel === 'online' && ['independent', 'page'].includes(seoClass) && nameRisk <= 18 && candidate.siteType?.browserPlayable) {
    recommendation = fastClass === 'pass' || onlinePlatforms >= 2 ? 'independent' : 'watch';
  }
  else if (usRising && market.allowsIndependent && channel === 'wiki' && seoClass === 'independent' && fastClass === 'pass' && nameRisk <= 12) recommendation = 'independent';
  else if (usRising && ['independent', 'page'].includes(seoClass)) recommendation = 'watch';
  else if (globalRising && ['moderate', 'strong'].includes(demandClass) && ['independent', 'page'].includes(seoClass)) recommendation = 'page';
  else if (globalRising) recommendation = 'watch';
  else if (demandClass === 'error' || demandClass === 'pending') recommendation = fastClass === 'watch' ? 'watch' : 'pending';
  else if (demandClass === 'none') recommendation = fastClass === 'weak' ? 'reject' : 'watch';
  else if (demandClass === 'weak') recommendation = 'watch';
  else if (['independent', 'page'].includes(seoClass) && ['strong', 'moderate'].includes(demandClass)) recommendation = 'page';
  else if (fastClass === 'weak') recommendation = 'reject';
  else recommendation = 'watch';

  // “上涨”只表示近期需求增长，不等于“新词”。独立站推荐必须同时满足：
  // 1) 90天历史确认是新词；2) 实时SERP未发现同名专站或成熟Wiki占位。
  if (recommendation === 'independent' && !market.allowsIndependent) recommendation = 'watch';

  // Platform-only evidence is useful for routing scarce API quota, but cannot
  // justify a standalone domain before a real SERP provider confirms intent.
  if (provisionalSeo && recommendation === 'independent') recommendation = 'page';

  const seoScore = Number(candidate.seo?.score || 0);
  const fastScore = Number(candidate.fast?.score || 0);
  const trendScore = Number(candidate.trend?.score || 0);
  const globalScore = Number(candidate.trend?.globalScore || 0);
  const weights = channel === 'online' ? { seo: 0.28, fast: 0.34, trend: 0.34, global: 0.04 } : { seo: 0.32, fast: 0.28, trend: 0.34, global: 0.06 };
  let finalScore = Math.round(seoScore * weights.seo + fastScore * weights.fast + trendScore * weights.trend + globalScore * weights.global);
  if (usRising) finalScore = Math.min(100, finalScore + 8);
  else if (globalRising) finalScore = Math.min(79, finalScore + 4);
  if (keywordFreshness === 'existing' || entityConflict) finalScore = Math.min(finalScore, 69);
  if (standaloneNeedsIntentConfirmation) finalScore = Math.min(finalScore, 54);
  if (provisionalSeo) finalScore = Math.min(finalScore, 69);
  if (!market.allowsIndependent && market.rising) finalScore = Math.min(finalScore, 59);
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
