import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateSeoVerdict, cleanGameName, estimateNameRisk } from '../lib/seo-verifier.mjs';
import { calculateFastSignals } from '../lib/fast-signals.mjs';
import { classifySiteType } from '../lib/site-type.mjs';
import { SEO_MODEL_VERSION } from '../lib/trend-queue.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const reportPath = path.join(root, 'data', 'latest-report.json');
const usagePath = path.join(root, 'data', 'serper-usage.json');
const API_KEY = process.env.SERPER_API_KEY || '';
const TIMEOUT_MS = Math.max(5000, Number(process.env.SERPER_TIMEOUT_MS || 15000));
const VERIFY_LIMIT = Math.max(0, Math.min(1200, Number(process.env.SERPER_VERIFY_LIMIT || 100)));
const ONLINE_LIMIT = Math.max(0, Number(process.env.SERPER_ONLINE_LIMIT || Math.round(VERIFY_LIMIT * 0.7)));
const WIKI_LIMIT = Math.max(0, Number(process.env.SERPER_WIKI_LIMIT || Math.round(VERIFY_LIMIT * 0.3)));
const TOTAL_LIMIT = Math.max(1, Number(process.env.SERPER_TOTAL_LIMIT || 2400));
const DAILY_LIMIT = Math.max(1, Number(process.env.SERPER_DAILY_LIMIT || TOTAL_LIMIT));
const COUNTRY = String(process.env.SEO_REGION || 'US').toLowerCase();
const LANGUAGE = String(process.env.SEO_LANGUAGE || 'en-US').split('-')[0].toLowerCase();
const DAY = 86400000;
const MIN_PRIORITY = Math.max(0, Number(process.env.SERPER_MIN_PRIORITY || 80));

const ONLINE_STRATEGIC = new Set(['crazygames-new', 'poki-new', 'newgrounds-top', 'newgrounds-new', 'itch-popular']);
const ONLINE_SECONDARY = new Set(['y8-new', 'gamepix-new', 'lagged-new']);
const WIKI_STRATEGIC = new Set(['steam-popular-new', 'steam-new', 'itch-featured', 'itch-popular', 'newgrounds-top', 'competitor-sitemap']);

async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; } }
function today() { return new Date().toISOString().slice(0, 10); }

async function readUsage() {
  const now = new Date().toISOString();
  const stored = await readJson(usagePath, {});
  const usage = { totalUsed: Number(stored.totalUsed || 0), day: stored.day || today(), dayUsed: Number(stored.dayUsed || 0), totalLimit: TOTAL_LIMIT, dailyLimit: DAILY_LIMIT, updatedAt: stored.updatedAt || null, lastError: stored.lastError || null };
  if (usage.day !== today()) { usage.day = today(); usage.dayUsed = 0; usage.updatedAt = now; }
  return usage;
}

async function saveUsage(usage) { usage.updatedAt = new Date().toISOString(); await fs.writeFile(usagePath, JSON.stringify(usage, null, 2) + '\n'); }
async function usageSummary() { return { enabled: Boolean(API_KEY), rushMode: true, ...await readUsage() }; }
async function ensureQuota() { const usage = await readUsage(); if (usage.totalUsed >= TOTAL_LIMIT || usage.dayUsed >= DAILY_LIMIT) { const error = new Error('Serper可用额度已用完'); error.code = 'SERPER_QUOTA_GUARD'; throw error; } }
async function recordSuccess() { const usage = await readUsage(); usage.totalUsed += 1; usage.dayUsed += 1; usage.lastError = null; await saveUsage(usage); }
async function recordError(message) { const usage = await readUsage(); usage.lastError = String(message || '').slice(0, 300); await saveUsage(usage); }
function decode(value = '') { return String(value).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim(); }
function safeSerperQuery(value = '') { return String(value).replace(/["'\[\]{}()<>|*~^`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); }

export function parseSerperResults(payload = {}) {
  return (payload.organic || []).slice(0, 10).map((item) => ({ url: String(item.link || ''), title: decode(item.title || ''), snippet: decode(item.snippet || '') })).filter((item) => item.url);
}

async function searchSerper(query) {
  await ensureQuota();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ q: safeSerperQuery(query), gl: COUNTRY, hl: LANGUAGE, num: 10, autocorrect: true }), signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.message || payload?.error || `Serper returned ${response.status}`;
      await recordError(message);
      const error = new Error(String(message));
      error.code = [402, 429].includes(response.status) || /credit|quota|limit/i.test(String(message)) ? 'SERPER_QUOTA_GUARD' : 'SERPER_UNAVAILABLE';
      throw error;
    }
    await recordSuccess();
    return parseSerperResults(payload);
  } catch (error) {
    if (error?.name === 'AbortError') { const timeoutError = new Error('Serper请求超时'); timeoutError.code = 'SERPER_UNAVAILABLE'; throw timeoutError; }
    throw error;
  } finally { clearTimeout(timer); }
}

async function fetchSuggestions(query) {
  try {
    const response = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(query)}`);
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.[1]) ? data[1].map(String) : [];
  } catch { return []; }
}

function sourceKinds(candidate) { return new Set((candidate.sources || []).flatMap((source) => [source.kind, source.sourceId]).filter(Boolean)); }
function sourceCount(candidate) { return new Set((candidate.sources || []).map((source) => source.sourceId || source.kind || source.url)).size; }
function typeOf(candidate) { candidate.siteType = classifySiteType(candidate); return candidate.siteType.type; }

function needsSeo(candidate) {
  if (candidate.seo?.modelVersion !== SEO_MODEL_VERSION) return true;
  if (candidate.seo?.provider === 'serper+autocomplete') {
    const checked = Date.parse(candidate.seo.checkedAt || '');
    return !Number.isFinite(checked) || Date.now() - checked > 3 * DAY;
  }
  return ['pending', 'error', 'watch'].includes(candidate.seo?.classification) || ['duckduckgo+autocomplete', 'brave+autocomplete'].includes(candidate.seo?.provider) || candidate.seo?.provider?.startsWith('google-cse-');
}

function isUseful(candidate) {
  const risk = estimateNameRisk(candidate.gameName || '');
  if (risk > 22) return false;
  const kinds = sourceKinds(candidate);
  const channel = typeOf(candidate);
  const strategicSet = channel === 'online' ? ONLINE_STRATEGIC : WIKI_STRATEGIC;
  const strategic = [...kinds].some((kind) => strategicSet.has(kind));
  const count = sourceCount(candidate);
  const age = Date.now() - Date.parse(candidate.firstSeen || 0);
  const recent = Number.isFinite(age) && age <= 7 * DAY;
  const bestRank = Math.min(...(candidate.sources || []).map((source) => Number(source.currentRank || source.bestRank || 9999)));
  const secondaryPortal = channel === 'online' && [...kinds].some((kind) => ONLINE_SECONDARY.has(kind));
  const secondaryWorthPaying = secondaryPortal && recent && bestRank <= 20 && risk <= 16;
  return strategic || count >= 2 || secondaryWorthPaying || (recent && Number(candidate.discoveryScore || 0) >= 7 && risk <= 16);
}

function priority(candidate) {
  const kinds = sourceKinds(candidate), count = sourceCount(candidate), channel = typeOf(candidate);
  let score = Number(candidate.discoveryScore || 0) * 5 + Math.max(0, 25 - estimateNameRisk(candidate.gameName || '')) + count * 10;
  if (kinds.has('trends-rising-7d')) score += 80;
  if (kinds.has('trends-rising-30d')) score += 60;
  if (channel === 'online') {
    if (kinds.has('crazygames-new')) score += 40;
    if (kinds.has('poki-new')) score += 40;
    if (kinds.has('y8-new')) score += 8;
    if (kinds.has('gamepix-new')) score += 8;
    if (kinds.has('lagged-new')) score += 8;
    if (Number(candidate.siteType?.onlinePlatformCount || 0) >= 2) score += 45;
  } else {
    if (kinds.has('itch-featured')) score += 40;
    if (kinds.has('itch-popular')) score += 32;
    if (kinds.has('steam-popular-new')) score += 35;
    if (kinds.has('newgrounds-top')) score += 22;
  }
  const age = Date.now() - Date.parse(candidate.firstSeen || 0);
  if (Number.isFinite(age) && age < 2 * DAY) score += 25;
  return score;
}

function candidateKey(candidate) { return candidate.id || candidate.normalizedName || candidate.gameName; }
function queueLane(candidate) {
  const age = Date.now() - Date.parse(candidate.firstSeen || 0);
  const recent = Number.isFinite(age) && age <= 2 * DAY;
  const kinds = sourceKinds(candidate);
  const hotSource = kinds.has('trends-rising-7d') || kinds.has('trends-rising-30d')
    || [...kinds].some((kind) => ONLINE_STRATEGIC.has(kind) || WIKI_STRATEGIC.has(kind));
  if (recent && (hotSource || sourceCount(candidate) >= 2 || Number(candidate.discoveryScore || 0) >= 7)) return 'hot';
  if (['test-now', 'independent', 'watch'].includes(candidate.recommendation)) return 'recheck';
  return 'explore';
}

function balancedQueue(candidates) {
  const eligible = candidates
    .filter((candidate) => needsSeo(candidate) && isUseful(candidate))
    .filter((candidate) => priority(candidate) >= MIN_PRIORITY)
    .sort((a, b) => priority(b) - priority(a) || Date.parse(b.firstSeen || 0) - Date.parse(a.firstSeen || 0));
  const laneCaps = {
    hot: Math.ceil(VERIFY_LIMIT * 0.60),
    recheck: Math.ceil(VERIFY_LIMIT * 0.20),
    explore: Math.max(0, VERIFY_LIMIT - Math.ceil(VERIFY_LIMIT * 0.60) - Math.ceil(VERIFY_LIMIT * 0.20)),
  };
  const channelCaps = { online: ONLINE_LIMIT, wiki: WIKI_LIMIT };
  const channelUsed = { online: 0, wiki: 0 };
  const selected = [];
  const ids = new Set();
  const add = (candidate) => {
    const key = candidateKey(candidate), channel = typeOf(candidate);
    if (ids.has(key) || !['online', 'wiki'].includes(channel)) return false;
    if (channelUsed[channel] >= channelCaps[channel]) return false;
    ids.add(key); selected.push(candidate); channelUsed[channel] += 1; return true;
  };
  for (const lane of ['hot', 'recheck', 'explore']) {
    let used = 0;
    for (const candidate of eligible) {
      if (used >= laneCaps[lane]) break;
      if (queueLane(candidate) !== lane) continue;
      if (add(candidate)) used += 1;
    }
  }
  for (const candidate of eligible) {
    if (selected.length >= VERIFY_LIMIT) break;
    add(candidate);
  }
  return selected.slice(0, VERIFY_LIMIT);
}

function applyChannelSeoAdjustment(candidate, verdict) {
  const channel = typeOf(candidate);
  const reasons = [...(verdict.reasons || [])];
  let score = Number(verdict.score || 0), classification = verdict.classification;
  if (channel === 'online' && !verdict.entityConflict) {
    const platforms = Number(candidate.siteType?.onlinePlatformCount || 0);
    score = Math.min(100, score + Math.min(16, platforms * 8));
    if (platforms >= 2 && score >= 35 && verdict.nameRisk <= 20 && ['watch', 'page'].includes(classification)) classification = 'page';
    reasons.unshift(`已确认${platforms}个在线游戏平台来源`);
  }
  return { ...verdict, score, classification, reasons, intentProfile: channel };
}

function refreshRecommendation(candidate) {
  const seo = candidate.seo?.classification || 'pending', fast = candidate.fast?.classification || 'pending';
  if (seo === 'error') candidate.recommendation = 'error';
  else if (seo === 'reject' || candidate.seo?.entityConflict || fast === 'reject') candidate.recommendation = 'reject';
  else if (fast === 'watch') candidate.recommendation = 'watch';
  else if (!candidate.trend) candidate.recommendation = 'pending';
  if (['reject', 'pending', 'error'].includes(candidate.recommendation)) { candidate.finalScore = 0; candidate.score = 0; }
  candidate.level = candidate.recommendation;
}

const payload = await readJson(candidatesPath, { candidates: [] });
const candidates = Array.isArray(payload) ? payload : payload.candidates || [];
for (const candidate of candidates) candidate.siteType = classifySiteType(candidate);
const report = await readJson(reportPath, {});
const queue = balancedQueue(candidates);
let verified = 0, errors = 0, quotaStopped = false;
const verifiedNames = [], verifiedByChannel = { online: 0, wiki: 0, pending: 0 };
if (!API_KEY) console.log('SERPER_API_KEY is not configured; skipping Serper SEO verification.');

for (const candidate of API_KEY ? queue : []) {
  try {
    const name = cleanGameName(candidate.gameName || '');
    const [results, suggestions] = await Promise.all([searchSerper(name), fetchSuggestions(name)]);
    const verdict = applyChannelSeoAdjustment(candidate, calculateSeoVerdict({ gameName: name, exactResults: results, gameResults: [], suggestions, discoveryScore: candidate.discoveryScore || 0 }));
    candidate.seo = { modelVersion: SEO_MODEL_VERSION, checkedAt: new Date().toISOString(), status: 'ok', provider: 'serper+autocomplete', queryName: name, searchRequests: 1, serperUsage: await usageSummary(), ...verdict };
    candidate.fast = calculateFastSignals(candidate, candidate.fast || {});
    refreshRecommendation(candidate);
    verified += 1;
    verifiedByChannel[typeOf(candidate)] += 1;
    verifiedNames.push(name);
  } catch (error) {
    if (error.code === 'SERPER_QUOTA_GUARD') { quotaStopped = true; break; }
    errors += 1;
    console.error(`Serper SEO failed: ${candidate.gameName}: ${error.message}`);
  }
}

const seoErrors = candidates.filter((candidate) => candidate.seo?.classification === 'error').length;
const seoPassedCount = candidates.filter((candidate) => candidate.seo?.modelVersion === SEO_MODEL_VERSION && ['independent', 'page'].includes(candidate.seo?.classification)).length;
const fastPassedCount = candidates.filter((candidate) => candidate.fast?.classification === 'pass').length;
const fastWatchCount = candidates.filter((candidate) => candidate.fast?.classification === 'watch').length;
const fastRejectedCount = candidates.filter((candidate) => ['weak', 'reject'].includes(candidate.fast?.classification)).length;
await fs.writeFile(candidatesPath, JSON.stringify({ ...payload, candidates }, null, 2) + '\n');
await fs.writeFile(reportPath, JSON.stringify({ ...report, seoProvider: API_KEY ? 'serper-google-search' : report.seoProvider, serperConfigured: Boolean(API_KEY), serperUsage: await usageSummary(), serperVerification: { rushMode: true, minPriority: MIN_PRIORITY, budgetLanes: { hot: '60%', recheck: '20%', explore: '20%' }, limit: VERIFY_LIMIT, onlineLimit: ONLINE_LIMIT, wikiLimit: WIKI_LIMIT, queueSize: queue.length, verified, verifiedByChannel, errors, quotaStopped, verifiedNames, ranAt: new Date().toISOString() }, seoVerified: Number(report.seoVerified || 0) + verified, seoErrors, seoPassedCount, fastPassedCount, fastWatchCount, fastRejectedCount }, null, 2) + '\n');
console.log(`Serper rush SEO complete: ${verified} verified (${verifiedByChannel.online} online, ${verifiedByChannel.wiki} wiki), ${errors} errors, quota stopped ${quotaStopped}.`);
