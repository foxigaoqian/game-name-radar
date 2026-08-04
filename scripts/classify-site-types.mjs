import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifySiteType, SITE_TYPE_MODEL_VERSION } from '../lib/site-type.mjs';
import { applyFinalRecommendation } from '../lib/opportunity-finalizer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const reportPath = path.join(root, 'data', 'latest-report.json');
const serpUsagePath = path.join(root, 'data', 'serpapi-usage.json');
const serperUsagePath = path.join(root, 'data', 'serper-usage.json');
const googleCseUsagePath = path.join(root, 'data', 'google-cse-usage.json');
const apifyStatusPath = path.join(root, 'data', 'apify-account-status.json');
const apifyUsagePath = path.join(root, 'data', 'apify-trends-usage.json');

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}

const payload = await readJson(candidatesPath, { candidates: [] });
const candidates = Array.isArray(payload) ? payload : payload.candidates || [];
const counts = { online: 0, wiki: 0, pending: 0 };
const wikiPrelaunchCounts = { priority: 0, prepare: 0, watch: 0, weak: 0 };
const trendProviderCounts = {};
const seoProviderCounts = {};

for (const candidate of candidates) {
  candidate.siteType = classifySiteType(candidate);
  applyFinalRecommendation(candidate);
  counts[candidate.siteType.type] = (counts[candidate.siteType.type] || 0) + 1;
  if (candidate.siteType.type === 'wiki' && candidate.wikiPrelaunch) {
    const classification = candidate.wikiPrelaunch.classification || 'weak';
    wikiPrelaunchCounts[classification] = (wikiPrelaunchCounts[classification] || 0) + 1;
    // Steam愿望单榜用于给SEO验证队列排序，但不直接替代真实SERP验证。
    const routingBoost = Math.min(20, Math.max(0, Math.round(Number(candidate.wikiPrelaunch.score || 0) / 5)));
    candidate.discoveryScore = Math.max(Number(candidate.discoveryScore || 0), routingBoost);
  }
  const trendProvider = candidate.trend?.provider;
  if (trendProvider) trendProviderCounts[trendProvider] = (trendProviderCounts[trendProvider] || 0) + 1;
  const seoProvider = candidate.seo?.provider;
  if (seoProvider) seoProviderCounts[seoProvider] = (seoProviderCounts[seoProvider] || 0) + 1;
}

await fs.writeFile(candidatesPath, JSON.stringify({ ...payload, candidates }, null, 2) + '\n');

const report = await readJson(reportPath, {});
const serpApiUsage = await readJson(serpUsagePath, {
  enabled: Boolean(process.env.SERPAPI_API_KEY), monthUsed: 0, dayUsed: 0,
  monthlyLimit: Number(process.env.SERPAPI_MONTHLY_LIMIT || 220), dailyLimit: Number(process.env.SERPAPI_DAILY_LIMIT || 8),
});
const serperUsage = await readJson(serperUsagePath, {
  totalUsed: 0,
  day: new Date().toISOString().slice(0, 10),
  dayUsed: 0,
  totalLimit: Number(process.env.SERPER_TOTAL_LIMIT || 2400),
  dailyLimit: Number(process.env.SERPER_DAILY_LIMIT || 100),
  updatedAt: null,
  lastError: null,
});
const apifyAccountStatus = await readJson(apifyStatusPath, { configured: Boolean(process.env.APIFY_API_TOKEN), ok: false });
const apifyTrendsUsage = await readJson(apifyUsagePath, { month: new Date().toISOString().slice(0, 7), actorCalls: 0, resultItems: 0, candidatesVerified: 0, errors: 0 });
const configuredGoogleSlots = [
  Boolean(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX),
  Boolean(process.env.GOOGLE_CSE_API_KEY_2 && process.env.GOOGLE_CSE_CX_2),
].filter(Boolean).length;
const googleCseUsage = await readJson(googleCseUsagePath, {
  day: new Date().toISOString().slice(0, 10), slots: {}, updatedAt: null,
});
let googleDayUsed = 0;
let googleDailyLimit = 0;
for (const slot of Object.values(googleCseUsage.slots || {})) {
  googleDayUsed += Number(slot.dayUsed || 0);
  googleDailyLimit += Number(slot.dailyLimit || 0);
}

const activeSeoProvider = process.env.SERPER_API_KEY
  ? 'serper-google-search'
  : configuredGoogleSlots
    ? 'google-custom-search'
    : 'duckduckgo-html';
const activeTrendProviders = Object.keys(trendProviderCounts);
const activeTrendProvider = activeTrendProviders.length > 1
  ? activeTrendProviders.join('+')
  : activeTrendProviders[0] || (process.env.SERPAPI_API_KEY ? 'serpapi' : process.env.APIFY_API_TOKEN ? 'apify-data-xplorer' : null);

await fs.writeFile(reportPath, JSON.stringify({
  ...report,
  trendProvider: activeTrendProvider,
  trendProviderCounts,
  serpApiConfigured: Boolean(process.env.SERPAPI_API_KEY),
  serpApiUsage: { enabled: Boolean(process.env.SERPAPI_API_KEY), ...serpApiUsage },
  apifyConfigured: Boolean(process.env.APIFY_API_TOKEN),
  apifyAccountStatus,
  apifyTrendsUsage,
  seoProvider: activeSeoProvider,
  seoProviderCounts,
  serperConfigured: Boolean(process.env.SERPER_API_KEY),
  serperUsage: { enabled: Boolean(process.env.SERPER_API_KEY), ...serperUsage },
  googleCseConfiguredSlots: configuredGoogleSlots,
  googleCseUsage: {
    enabled: configuredGoogleSlots > 0,
    configuredSlots: configuredGoogleSlots,
    day: googleCseUsage.day,
    totalDayUsed: googleDayUsed,
    totalDailyLimit: googleDailyLimit || configuredGoogleSlots * Number(process.env.GOOGLE_CSE_DAILY_LIMIT || 90),
    slots: googleCseUsage.slots || {},
    updatedAt: googleCseUsage.updatedAt || null,
  },
  braveSearchConfigured: false,
  braveSearchUsage: { enabled: false },
  siteTypeModelVersion: SITE_TYPE_MODEL_VERSION,
  siteTypeCounts: counts,
  wikiPrelaunchModelVersion: 1,
  wikiPrelaunchCounts,
}, null, 2) + '\n');

console.log(`Site type classification complete: ${counts.online} online, ${counts.wiki} wiki, ${counts.pending} pending; Steam prelaunch priority ${wikiPrelaunchCounts.priority}, prepare ${wikiPrelaunchCounts.prepare}; trend providers: ${activeTrendProvider || 'none'}.`);
