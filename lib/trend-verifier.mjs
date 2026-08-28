import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const googleTrends = require('google-trends-api');

export const TREND_MODEL_VERSION = 4;
export const TREND_PROFILE_VERSION = 2;
const DEFAULT_ANCHOR = process.env.TRENDS_ANCHOR || 'itch io';
const TARGET_MARKET = process.env.TARGET_MARKET || 'US_GLOBAL';
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY || '';
const SERPAPI_TIMEOUT_MS = Math.max(10000, Number(process.env.SERPAPI_TIMEOUT_MS || 60000));
const SERPAPI_MONTHLY_LIMIT = Math.max(1, Number(process.env.SERPAPI_MONTHLY_LIMIT || 220));
const SERPAPI_DAILY_LIMIT = Math.max(1, Number(process.env.SERPAPI_DAILY_LIMIT || 8));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usagePath = path.join(root, 'data', 'serpapi-usage.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseGoogleTimeline(raw, keywordIndex = 0) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const timeline = data?.default?.timelineData || [];
  return timeline.map((item) => Number(item?.value?.[keywordIndex] || 0));
}

export function parseSerpApiTimeline(payload, keywordIndex = 0) {
  const timeline = payload?.interest_over_time?.timeline_data || [];
  return timeline.map((item) => {
    const point = item?.values?.[keywordIndex] || {};
    const value = point.extracted_value ?? point.value ?? 0;
    const numeric = Number(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(numeric) ? numeric : 0;
  });
}

function maxTimelines(...timelines) {
  const length = Math.max(0, ...timelines.map((values) => values.length));
  return Array.from({ length }, (_, index) => Math.max(0, ...timelines.map((values) => Number(values[index] || 0))));
}

function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }

function normalizedSlope(values) {
  if (values.length < 3) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = average(values);
  let numerator = 0, denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (i - xMean) * (values[i] - yMean);
    denominator += (i - xMean) ** 2;
  }
  return denominator ? Number(((numerator / denominator) / Math.max(1, yMean)).toFixed(3)) : 0;
}

function summarize(values, recentCount) {
  if (!values.length) return { points: 0, average: 0, peak: 0, nonZero: 0, coverage: 0, earlierAverage: 0, earlierCoverage: 0, recentAverage: 0, recentCoverage: 0, momentum: 0, slope: 0 };
  const count = Math.max(1, Math.min(values.length, recentCount));
  const earlier = values.slice(0, Math.max(0, values.length - count));
  const recent = values.slice(-count);
  const nonZero = values.filter((value) => value > 0);
  const earlierNonZero = earlier.filter((value) => value > 0).length;
  const recentNonZero = recent.filter((value) => value > 0).length;
  const earlierAvg = average(earlier);
  const recentAvg = average(recent);
  const momentum = earlierAvg > 0 ? recentAvg / earlierAvg : recentAvg > 0 ? 4 : 0;
  return {
    points: values.length,
    average: Number(average(values).toFixed(2)),
    peak: Math.max(...values),
    nonZero: nonZero.length,
    coverage: Number((nonZero.length / values.length).toFixed(2)),
    earlierAverage: Number(earlierAvg.toFixed(2)),
    earlierCoverage: earlier.length ? Number((earlierNonZero / earlier.length).toFixed(2)) : 0,
    recentAverage: Number(recentAvg.toFixed(2)),
    recentCoverage: recent.length ? Number((recentNonZero / recent.length).toFixed(2)) : 0,
    momentum: Number(Math.min(9.99, momentum).toFixed(2)),
    slope: normalizedSlope(values),
  };
}

function ratio(candidate, anchor) { return anchor.average > 0 ? Number((candidate.average / anchor.average).toFixed(3)) : 0; }
function detectsRising(summary, { minRecent, minCoverage, minMomentum, minSlope }) { return summary.recentAverage >= minRecent && summary.recentCoverage >= minCoverage && summary.momentum >= minMomentum && summary.slope > minSlope; }
function detectsBreakout(summary, { minRecent, minCoverage, minMomentum }) { return summary.recentAverage >= minRecent && summary.recentCoverage >= minCoverage && ((summary.earlierAverage <= 0.5 && summary.peak >= 8) || summary.momentum >= minMomentum); }

export function calculateTrendVerdict({
  gameName,
  sevenDayCandidate = [], sevenDayQualified = [], sevenDayAnchor = [],
  thirtyDayCandidate = [], thirtyDayQualified = [], thirtyDayAnchor = [],
  ninetyDayCandidate = [], ninetyDayQualified = [], ninetyDayAnchor = [],
  anchor = DEFAULT_ANCHOR,
  qualifiedQuery = `${gameName} game`,
  siteType = 'pending',
  queryProfile = 'generic',
}) {
  const seven = summarize(sevenDayCandidate, Math.max(2, Math.ceil(sevenDayCandidate.length * 0.3)));
  const sevenQualified = summarize(sevenDayQualified, Math.max(2, Math.ceil(sevenDayQualified.length * 0.3)));
  const sevenAnchor = summarize(sevenDayAnchor, Math.max(2, Math.ceil(sevenDayAnchor.length * 0.3)));
  const thirty = summarize(thirtyDayCandidate, Math.max(7, Math.ceil(thirtyDayCandidate.length * 0.23)));
  const thirtyQualified = summarize(thirtyDayQualified, Math.max(7, Math.ceil(thirtyDayQualified.length * 0.23)));
  const thirtyAnchor = summarize(thirtyDayAnchor, Math.max(7, Math.ceil(thirtyDayAnchor.length * 0.23)));
  const ninety = summarize(ninetyDayCandidate, Math.max(30, Math.ceil(ninetyDayCandidate.length * 0.33)));
  const ninetyQualified = summarize(ninetyDayQualified, Math.max(30, Math.ceil(ninetyDayQualified.length * 0.33)));
  const ninetyAnchor = summarize(ninetyDayAnchor, Math.max(30, Math.ceil(ninetyDayAnchor.length * 0.33)));

  const ratio7 = ratio(seven, sevenAnchor), ratio30 = ratio(thirty, thirtyAnchor), ratio90 = ratio(ninety, ninetyAnchor);
  const qualifiedRatio7 = ratio(sevenQualified, sevenAnchor), qualifiedRatio30 = ratio(thirtyQualified, thirtyAnchor), qualifiedRatio90 = ratio(ninetyQualified, ninetyAnchor);
  const isolatedSpike7 = seven.nonZero <= 1 || (seven.recentCoverage < 0.34 && seven.peak > seven.recentAverage * 3);
  const isolatedSpike30 = thirty.nonZero <= 2 || (thirty.recentCoverage < 0.29 && thirty.peak > thirty.recentAverage * 4);
  const exactBreakout7 = !isolatedSpike7 && detectsBreakout(seven, { minRecent: 3, minCoverage: 0.66, minMomentum: 2.8 });
  const exactBreakout30 = !isolatedSpike30 && detectsBreakout(thirty, { minRecent: 2, minCoverage: 0.57, minMomentum: 2.5 });
  const qualifiedBreakout7 = qualifiedRatio7 >= 0.01 && detectsBreakout(sevenQualified, { minRecent: 1.5, minCoverage: 0.5, minMomentum: 2.5 });
  const qualifiedBreakout30 = qualifiedRatio30 >= 0.015 && detectsBreakout(thirtyQualified, { minRecent: 1.2, minCoverage: 0.43, minMomentum: 2.2 });
  const exactRising7 = !isolatedSpike7 && detectsRising(seven, { minRecent: 1.5, minCoverage: 0.5, minMomentum: 1.8, minSlope: 0.08 });
  const exactRising30 = !isolatedSpike30 && detectsRising(thirty, { minRecent: 1.2, minCoverage: 0.43, minMomentum: 1.65, minSlope: 0.025 });
  const qualifiedRising7 = qualifiedRatio7 >= 0.01 && detectsRising(sevenQualified, { minRecent: 1, minCoverage: 0.43, minMomentum: 1.7, minSlope: 0.06 });
  const qualifiedRising30 = qualifiedRatio30 >= 0.015 && detectsRising(thirtyQualified, { minRecent: 0.8, minCoverage: 0.36, minMomentum: 1.55, minSlope: 0.02 });
  const breakout7 = exactBreakout7 || qualifiedBreakout7, breakout30 = exactBreakout30 || qualifiedBreakout30;
  const rising7 = exactRising7 || qualifiedRising7, rising30 = exactRising30 || qualifiedRising30;

  let keywordFreshness = 'unknown';
  if (ninety.points >= 45) {
    const recentFreshValues = ninetyDayCandidate.slice(-Math.min(14, ninetyDayCandidate.length)).map((value) => Number(value) || 0);
    const recentFreshNonZero = recentFreshValues.filter((value) => value > 0);
    const recentFreshAverage = recentFreshValues.length ? average(recentFreshValues) : 0;
    const recentFreshCoverage = recentFreshValues.length ? recentFreshNonZero.length / recentFreshValues.length : 0;
    if (ninety.earlierAverage >= 4 && ninety.earlierCoverage >= 0.45) keywordFreshness = 'existing';
    else if (ninety.earlierAverage <= 1
      && ((ninety.recentAverage >= 3 && ninety.recentCoverage >= 0.4)
        || (recentFreshAverage >= 3 && recentFreshCoverage >= 0.4))) keywordFreshness = 'new';
  }
  const entityConflict = keywordFreshness === 'existing' && (qualifiedRatio90 < Math.max(0.01, ratio90 * 0.25) || ninetyQualified.coverage < 0.2);

  let score = 0;
  score += Math.min(20, Math.round(ratio30 * 100));
  score += Math.min(16, Math.round(ratio7 * 80));
  score += Math.min(14, Math.round(qualifiedRatio30 * 160));
  score += Math.min(12, Math.round(qualifiedRatio7 * 140));
  score += Math.round(thirty.coverage * 8) + Math.round(seven.coverage * 6);
  if (rising7) score += 18;
  if (rising30) score += 15;
  if (breakout7 || breakout30) score += 20;
  if (keywordFreshness === 'new') score += 8;
  if (keywordFreshness === 'existing') score -= 8;
  if (entityConflict) score -= 12;
  if (isolatedSpike7 && isolatedSpike30) score -= 12;
  score = Math.max(0, Math.min(100, score));

  const noData = seven.nonZero === 0 && thirty.nonZero === 0 && sevenQualified.nonZero === 0 && thirtyQualified.nonZero === 0;
  const veryWeak = ratio7 < 0.02 && ratio30 < 0.015 && qualifiedRatio7 < 0.01 && qualifiedRatio30 < 0.01;
  let classification = 'weak';
  if (noData) classification = 'none';
  else if (breakout7 || breakout30) classification = 'breakout';
  else if (rising7 || rising30) classification = 'rising';
  else if (veryWeak || (isolatedSpike7 && isolatedSpike30)) classification = 'weak';
  else if (ratio7 >= 0.12 || ratio30 >= 0.1 || score >= 58) classification = 'strong';
  else if (ratio7 >= 0.04 || ratio30 >= 0.035 || qualifiedRatio30 >= 0.02 || score >= 30) classification = 'moderate';

  const reasons = [];
  if (classification === 'none') reasons.push('Google Trends 7天和30天均无可见需求');
  else {
    reasons.push(`主词7天热度约为 ${anchor} 的 ${(ratio7 * 100).toFixed(1)}%`);
    reasons.push(`主词30天热度约为 ${anchor} 的 ${(ratio30 * 100).toFixed(1)}%`);
    if (sevenQualified.points) reasons.push(`“${qualifiedQuery}”组合热度约为 ${anchor} 的 ${(qualifiedRatio30 * 100).toFixed(1)}%`);
    if (keywordFreshness === 'existing') reasons.push('90天前段已有持续热度，关键词本身不是新出现');
    else if (keywordFreshness === 'new') reasons.push('90天前段接近无量，近期才开始形成搜索需求');
    if (entityConflict) reasons.push('主词历史热度主要可能来自其他实体，不应归因于这款新游戏');
    if (breakout7) reasons.push('7天出现Breakout');
    else if (breakout30) reasons.push('30天出现Breakout');
    else if (rising7) reasons.push('7天持续上涨');
    else if (rising30) reasons.push('30天持续上涨');
    else if (isolatedSpike7 || isolatedSpike30) reasons.push('存在孤立尖峰，暂不视为持续上涨');
  }

  return {
    modelVersion: TREND_MODEL_VERSION,
    profileVersion: TREND_PROFILE_VERSION,
    queryProfile,
    siteType,
    queryName: gameName,
    qualifiedQuery,
    anchor,
    score,
    classification,
    reasons,
    ratio7,
    ratio30,
    ratio90,
    qualifiedRatio7,
    qualifiedRatio30,
    qualifiedRatio90,
    rising7,
    rising30,
    breakout7,
    breakout30,
    exactRising7,
    exactRising30,
    qualifiedRising7,
    qualifiedRising30,
    keywordFreshness,
    entityConflict,
    sevenDay: seven,
    thirtyDay: thirty,
    ninetyDay: ninety,
    sevenDayQualified: sevenQualified,
    thirtyDayQualified: thirtyQualified,
    ninetyDayQualified: ninetyQualified,
  };
}

async function readUsage() {
  const now = new Date();
  const month = now.toISOString().slice(0, 7), day = now.toISOString().slice(0, 10);
  let usage = {};
  try { usage = JSON.parse(await fs.readFile(usagePath, 'utf8')); } catch {}
  if (usage.month !== month) usage = { month, monthUsed: 0, day, dayUsed: 0, updatedAt: now.toISOString() };
  else if (usage.day !== day) usage = { ...usage, day, dayUsed: 0, updatedAt: now.toISOString() };
  return usage;
}

async function reserveSerpApiRequest() {
  const usage = await readUsage();
  if (Number(usage.monthUsed || 0) >= SERPAPI_MONTHLY_LIMIT || Number(usage.dayUsed || 0) >= SERPAPI_DAILY_LIMIT) {
    const error = new Error(Number(usage.monthUsed || 0) >= SERPAPI_MONTHLY_LIMIT ? `SerpApi monthly safety limit reached (${SERPAPI_MONTHLY_LIMIT})` : `SerpApi daily safety limit reached (${SERPAPI_DAILY_LIMIT})`);
    error.code = 'SERPAPI_QUOTA_GUARD';
    error.apiRequests = 0;
    throw error;
  }
  const updated = { ...usage, monthUsed: Number(usage.monthUsed || 0) + 1, dayUsed: Number(usage.dayUsed || 0) + 1, monthlyLimit: SERPAPI_MONTHLY_LIMIT, dailyLimit: SERPAPI_DAILY_LIMIT, updatedAt: new Date().toISOString() };
  await fs.writeFile(usagePath, JSON.stringify(updated, null, 2) + '\n');
  return updated;
}

export async function getSerpApiUsage() {
  if (!SERPAPI_API_KEY) return { enabled: false, monthUsed: 0, dayUsed: 0, monthlyLimit: SERPAPI_MONTHLY_LIMIT, dailyLimit: SERPAPI_DAILY_LIMIT };
  return { enabled: true, ...await readUsage(), monthlyLimit: SERPAPI_MONTHLY_LIMIT, dailyLimit: SERPAPI_DAILY_LIMIT };
}

function cleanQuery(value) { return String(value || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100); }

function buildProfile(gameName, options = {}) {
  const siteType = options.siteType === 'online' || options.siteType === 'wiki' ? options.siteType : 'pending';
  if (siteType === 'online') {
    const anchor = options.anchor || 'crazy games';
    return { siteType, name: 'online-v2', anchor, queries: [gameName, `${gameName} online`, `play ${gameName}`, anchor], supportIndexes: [1, 2], supportLabel: `${gameName} online / play ${gameName}` };
  }
  if (siteType === 'wiki') {
    const anchor = options.anchor || 'steam';
    return { siteType, name: 'wiki-v2', anchor, queries: [gameName, `${gameName} wiki`, `${gameName} guide`, anchor], supportIndexes: [1, 2], supportLabel: `${gameName} wiki / ${gameName} guide` };
  }
  const anchor = options.anchor || DEFAULT_ANCHOR;
  return { siteType, name: 'generic-v1', anchor, queries: [gameName, `${gameName} game`, anchor], supportIndexes: [1], supportLabel: `${gameName} game` };
}

async function fetchSerpApiComparison(profile, market = 'US') {
  const usage = await reserveSerpApiRequest();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERPAPI_TIMEOUT_MS);
  const params = new URLSearchParams({ engine: 'google_trends', q: profile.queries.map(cleanQuery).join(','), data_type: 'TIMESERIES', date: 'today 3-m', hl: 'en', tz: '240', api_key: SERPAPI_API_KEY, output: 'json' });
  if (market !== 'WORLDWIDE') params.set('geo', market);
  try {
    const response = await fetch(`https://serpapi.com/search.json?${params}`, { signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error || payload?.search_metadata?.status === 'Error') throw new Error(payload.error || `SerpApi returned HTTP ${response.status}`);
    const timelines = profile.queries.map((_, index) => parseSerpApiTimeline(payload, index));
    return { candidate: timelines[0] || [], qualified: maxTimelines(...profile.supportIndexes.map((index) => timelines[index] || [])), anchor: timelines[profile.queries.length - 1] || [], searchId: payload?.search_metadata?.id || null, cached: Boolean(payload?.search_metadata?.cached), usage };
  } catch (error) {
    const wrapped = new Error(error?.name === 'AbortError' ? 'SerpApi request timed out' : error.message);
    wrapped.apiRequests = 1;
    throw wrapped;
  } finally { clearTimeout(timer); }
}

async function fetchFreeComparison(profile, days, market = 'US') {
  const endTime = new Date(), startTime = new Date(endTime.getTime() - days * 86400000);
  const raw = await googleTrends.interestOverTime({ keyword: profile.queries, startTime, endTime, geo: market === 'WORLDWIDE' ? '' : market, hl: 'en-US', timezone: 240 });
  const timelines = profile.queries.map((_, index) => parseGoogleTimeline(raw, index));
  return { candidate: timelines[0] || [], qualified: maxTimelines(...profile.supportIndexes.map((index) => timelines[index] || [])), anchor: timelines[profile.queries.length - 1] || [] };
}

function verdictFromNinety(gameName, ninety, profile) {
  const thirtyCount = Math.min(30, ninety.candidate.length), sevenCount = Math.min(7, ninety.candidate.length);
  return calculateTrendVerdict({ gameName, sevenDayCandidate: ninety.candidate.slice(-sevenCount), sevenDayQualified: ninety.qualified.slice(-sevenCount), sevenDayAnchor: ninety.anchor.slice(-sevenCount), thirtyDayCandidate: ninety.candidate.slice(-thirtyCount), thirtyDayQualified: ninety.qualified.slice(-thirtyCount), thirtyDayAnchor: ninety.anchor.slice(-thirtyCount), ninetyDayCandidate: ninety.candidate, ninetyDayQualified: ninety.qualified, ninetyDayAnchor: ninety.anchor, anchor: profile.anchor, qualifiedQuery: profile.supportLabel, siteType: profile.siteType, queryProfile: profile.name });
}

function verdictFromFreeComparisons(gameName, thirty, ninety, profile) {
  const recentPoints = Math.min(8, thirty.candidate.length || 8);
  return calculateTrendVerdict({ gameName, sevenDayCandidate: thirty.candidate.slice(-recentPoints), sevenDayQualified: thirty.qualified.slice(-recentPoints), sevenDayAnchor: thirty.anchor.slice(-recentPoints), thirtyDayCandidate: thirty.candidate, thirtyDayQualified: thirty.qualified, thirtyDayAnchor: thirty.anchor, ninetyDayCandidate: ninety.candidate, ninetyDayQualified: ninety.qualified, ninetyDayAnchor: ninety.anchor, anchor: profile.anchor, qualifiedQuery: profile.supportLabel, siteType: profile.siteType, queryProfile: profile.name });
}

async function fetchMarketVerdict(gameName, profile, market) {
  if (SERPAPI_API_KEY) {
    const ninety = await fetchSerpApiComparison(profile, market);
    return { verdict: verdictFromNinety(gameName, ninety, profile), apiRequests: 1, searchIds: ninety.searchId ? [ninety.searchId] : [] };
  }
  const thirty = await fetchFreeComparison(profile, 30, market);
  const ninety = await fetchFreeComparison(profile, 90, market);
  return { verdict: verdictFromFreeComparisons(gameName, thirty, ninety, profile), apiRequests: 0, searchIds: [] };
}

function normalizeOptions(anchorOrOptions) {
  if (typeof anchorOrOptions === 'string') return { anchor: anchorOrOptions, siteType: 'pending', allowGlobal: true };
  return { siteType: 'pending', allowGlobal: true, ...(anchorOrOptions || {}) };
}

export async function verifyTrendDemand(gameName, anchorOrOptions = DEFAULT_ANCHOR) {
  const options = normalizeOptions(anchorOrOptions);
  const profile = buildProfile(gameName, options);
  let apiRequests = 0;
  const searchIds = [];
  try {
    const usResult = await fetchMarketVerdict(gameName, profile, 'US');
    apiRequests += usResult.apiRequests;
    searchIds.push(...usResult.searchIds);
    const primary = usResult.verdict;
    let worldwide = null;
    if (options.allowGlobal !== false && TARGET_MARKET === 'US_GLOBAL' && !['rising', 'breakout'].includes(primary.classification)) {
      if (!SERPAPI_API_KEY) await sleep(1500);
      try {
        const globalResult = await fetchMarketVerdict(gameName, profile, 'WORLDWIDE');
        apiRequests += globalResult.apiRequests;
        searchIds.push(...globalResult.searchIds);
        worldwide = globalResult.verdict;
      } catch (error) { if (error.code !== 'SERPAPI_QUOTA_GUARD') throw error; }
    }
    const globalRising = ['rising', 'breakout'].includes(worldwide?.classification);
    const marketStatus = ['rising', 'breakout'].includes(primary.classification) ? 'us-rising' : globalRising ? 'global-rising' : 'no-rising';
    const reasons = [...primary.reasons];
    if (globalRising) reasons.push(`全球趋势${worldwide.classification === 'breakout' ? '出现Breakout' : '明显上涨'}，但美国市场尚未同步`);
    return { checkedAt: new Date().toISOString(), provider: SERPAPI_API_KEY ? 'serpapi' : 'google-trends-api', apiRequests, searchIds, serpApiUsage: await getSerpApiUsage(), targetMarket: TARGET_MARKET, primaryMarket: 'US', referenceMarket: 'WORLDWIDE', marketStatus, globalClassification: worldwide?.classification || null, globalScore: worldwide?.score ?? null, globalRatio7: worldwide?.ratio7 ?? null, globalRatio30: worldwide?.ratio30 ?? null, globalRising7: worldwide?.rising7 ?? false, globalRising30: worldwide?.rising30 ?? false, globalBreakout7: worldwide?.breakout7 ?? false, globalBreakout30: worldwide?.breakout30 ?? false, globalKeywordFreshness: worldwide?.keywordFreshness || null, worldwide, ...primary, reasons };
  } catch (error) {
    error.apiRequests = apiRequests + Number(error.apiRequests || 0);
    throw error;
  }
}
