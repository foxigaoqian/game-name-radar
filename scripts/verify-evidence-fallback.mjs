import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateNameRisk, cleanGameName } from '../lib/seo-verifier.mjs';
import { classifySiteType, sourcePlatformKey } from '../lib/site-type.mjs';
import { calculateFastSignals } from '../lib/fast-signals.mjs';
import { SEO_MODEL_VERSION } from '../lib/trend-queue.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const reportPath = path.join(root, 'data', 'latest-report.json');
const LIMIT = Math.max(0, Number(process.env.SEO_EVIDENCE_FALLBACK_LIMIT || 300));
const DAY = 86400000;

const ONLINE_STRATEGIC = new Set([
  'crazygames-new', 'poki-new', 'y8-new', 'gamepix-new', 'lagged-new',
  'newgrounds-daily-top', 'newgrounds-latest',
  'itch-new-popular-web', 'itch-featured-feed', 'itch-newest-web',
  'newgrounds-top', 'newgrounds-new', 'itch-popular',
]);
const WIKI_STRATEGIC = new Set([
  'steam-popular-new', 'steam-latest-indie',
  'itch-featured-feed', 'itch-new-popular-web',
  'newgrounds-daily-top', 'competitor-sitemap',
  'steam-new', 'itch-featured', 'itch-popular', 'newgrounds-top',
]);

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}

function sourceAliases(source = {}) {
  return [source.kind, source.sourceId, source.id].filter(Boolean);
}

function kindsOf(candidate) {
  return new Set((candidate.sources || []).flatMap(sourceAliases));
}

function sourceCount(candidate) {
  return new Set((candidate.sources || [])
    .map((source) => source.key || source.url || `${source.sourceId || source.kind}:${source.id || ''}`)
    .filter(Boolean)).size;
}

function hasUsableSeo(candidate) {
  const seo = candidate.seo;
  if (!seo || seo.modelVersion !== SEO_MODEL_VERSION) return false;
  return !['pending', 'error'].includes(seo.classification);
}

function strategicPlatformCount(candidate, channel) {
  const strategic = channel === 'online' ? ONLINE_STRATEGIC : WIKI_STRATEGIC;
  return new Set((candidate.sources || [])
    .filter((source) => sourceAliases(source).some((alias) => strategic.has(alias)))
    .map(sourcePlatformKey)
    .filter(Boolean)).size;
}

function hasDirectRisingSignal(kinds) {
  return [...kinds].some((kind) => /^trends-rising-(7d|30d)(-|$)/.test(kind));
}

function evidenceScore(candidate, channel) {
  const kinds = kindsOf(candidate);
  const strategicCount = strategicPlatformCount(candidate, channel);
  const sources = sourceCount(candidate);
  const fastScore = Number(candidate.fast?.score || 0);
  const discovery = Number(candidate.discoveryScore || 0);
  const platforms = Number(candidate.siteType?.onlinePlatformCount || candidate.fast?.onlinePlatformCount || 0);
  const age = Date.now() - Date.parse(candidate.firstSeen || 0);
  const recentBoost = Number.isFinite(age) && age <= 3 * DAY ? 8 : 0;
  const risingBoost = hasDirectRisingSignal(kinds) ? 24 : 0;
  return fastScore + discovery * 2 + strategicCount * 16 + sources * 4 + platforms * 20 + recentBoost + risingBoost;
}

function buildFallback(candidate) {
  candidate.siteType = classifySiteType(candidate);
  const channel = candidate.siteType.type;
  if (!['online', 'wiki'].includes(channel)) return null;

  const name = cleanGameName(candidate.gameName || '');
  const nameRisk = estimateNameRisk(name);
  const kinds = kindsOf(candidate);
  const sources = sourceCount(candidate);
  const fastClass = candidate.fast?.classification || 'pending';
  const fastScore = Number(candidate.fast?.score || 0);
  const discovery = Number(candidate.discoveryScore || 0);
  const platforms = Number(candidate.siteType?.onlinePlatformCount || candidate.fast?.onlinePlatformCount || 0);
  const strategicCount = strategicPlatformCount(candidate, channel);
  const directRising = hasDirectRisingSignal(kinds);
  const browserEvidence = Boolean(candidate.siteType?.browserPlayable) || platforms >= 1;

  let qualifies = false;
  const reasons = [];

  if (channel === 'online') {
    qualifies = browserEvidence
      && nameRisk <= 20
      && (
        (platforms >= 2 && discovery >= 8)
        || (directRising && platforms >= 1 && discovery >= 8)
        || (fastClass === 'pass' && platforms >= 1 && fastScore >= 24)
      );

    if (platforms >= 2) reasons.push(`已在${platforms}个独立在线游戏平台发现`);
    else if (platforms === 1) reasons.push('已确认存在浏览器可玩平台页面');
    if (directRising) reasons.push('同时存在Google Trends相关查询上涨信号');
  } else {
    const hasSteamEvidence = kinds.has('steam-popular-new')
      || kinds.has('steam-latest-indie')
      || kinds.has('steam-new');

    qualifies = nameRisk <= 18
      && (
        (hasSteamEvidence && discovery >= 10)
        || (directRising && strategicCount >= 1 && discovery >= 8)
        || (strategicCount >= 2 && discovery >= 10)
        || (fastClass === 'pass' && strategicCount >= 1 && fastScore >= 24)
      );

    if (hasSteamEvidence) reasons.push('存在Steam发行或热门新游证据');
    if (strategicCount >= 2) reasons.push(`来自${strategicCount}个独立Wiki战略平台`);
    if (directRising) reasons.push('同时存在Google Trends相关查询上涨信号');
  }

  if (!qualifies) return null;
  if (sources >= 2) reasons.push(`共有${sources}条独立发现记录`);
  reasons.push('Serper额度不足，当前为平台证据临时验证，仍需后续SERP复核');

  const rawScore = channel === 'online'
    ? 28 + platforms * 12 + strategicCount * 6 + Math.min(10, sources * 2) + Math.min(10, Math.round(discovery / 2)) + (directRising ? 8 : 0)
    : 28 + strategicCount * 10 + Math.min(10, sources * 2) + Math.min(10, Math.round(discovery / 2)) + (directRising ? 8 : 0);

  return {
    modelVersion: SEO_MODEL_VERSION,
    checkedAt: new Date().toISOString(),
    status: 'provisional',
    provider: 'evidence-fallback',
    queryName: name,
    classification: 'page',
    score: Math.max(35, Math.min(62, rawScore - Math.round(nameRisk * 0.5))),
    nameRisk,
    entityConflict: false,
    provisional: true,
    confidence: 'medium',
    sourceCount: sources,
    strategicSourceCount: strategicCount,
    onlinePlatformCount: platforms,
    discoveryScore: discovery,
    reasons,
  };
}

const payload = await readJson(candidatesPath, { candidates: [] });
const candidates = Array.isArray(payload) ? payload : payload.candidates || [];
const report = await readJson(reportPath, {});
const pendingCandidates = candidates.filter((candidate) => !hasUsableSeo(candidate));

// Build and validate the fallback verdict before applying the processing cap.
// Previously the script sliced the highest-scoring 300 pending candidates first;
// disqualified names could fill that slice and hide valid candidates below it.
const eligible = pendingCandidates
  .map((candidate) => {
    candidate.siteType = classifySiteType(candidate);
    const verdict = buildFallback(candidate);
    return verdict ? { candidate, verdict, priority: evidenceScore(candidate, candidate.siteType.type) } : null;
  })
  .filter(Boolean)
  .sort((a, b) => b.priority - a.priority);
const queue = eligible.slice(0, LIMIT);

let verified = 0;
const verifiedNames = [];
const channelVerified = { online: 0, wiki: 0, pending: 0 };
const fastRecalculated = { pass: 0, watch: 0, weak: 0, reject: 0, pending: 0 };

for (const item of queue) {
  item.candidate.seo = item.verdict;
  item.candidate.fast = calculateFastSignals(item.candidate, item.candidate.fast || {});
  fastRecalculated[item.candidate.fast?.classification || 'pending'] += 1;
  item.candidate.recommendation = item.candidate.trend ? item.candidate.recommendation || 'watch' : 'pending';
  item.candidate.level = item.candidate.recommendation;
  verified += 1;
  channelVerified[item.candidate.siteType.type] += 1;
  verifiedNames.push(item.candidate.gameName);
}

await fs.writeFile(candidatesPath, JSON.stringify({ ...payload, candidates }, null, 2) + '\n');
await fs.writeFile(reportPath, JSON.stringify({
  ...report,
  evidenceSeoFallback: {
    enabled: true,
    limit: LIMIT,
    pendingCount: pendingCandidates.length,
    eligibleCount: eligible.length,
    queueSize: queue.length,
    verified,
    channelVerified,
    fastRecalculated,
    verifiedNames: verifiedNames.slice(0, 100),
    ranAt: new Date().toISOString(),
  },
}, null, 2) + '\n');

console.log(`Evidence SEO fallback complete: ${verified}/${eligible.length} eligible provisional page candidate(s); fast signals recalculated.`);
