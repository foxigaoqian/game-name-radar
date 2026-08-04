import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifySiteType } from '../lib/site-type.mjs';
import { calculateFastSignals } from '../lib/fast-signals.mjs';
import { applyFinalRecommendation } from '../lib/opportunity-finalizer.mjs';
import { analyzeOnlineSocialBuzz, SOCIAL_MODEL_VERSION } from '../lib/social-buzz.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const reportPath = path.join(root, 'data', 'latest-report.json');
const LIMIT = Math.max(0, Math.min(100, Number(process.env.SOCIAL_VERIFY_LIMIT || 35)));
const MAX_AGE = Math.max(3600000, Number(process.env.SOCIAL_MAX_AGE_MS || 6 * 3600000));
const TIMEOUT_MS = Math.max(5000, Number(process.env.SOCIAL_TIMEOUT_MS || 20000));
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID || '';
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || '';
const REDDIT_USER_AGENT = process.env.REDDIT_USER_AGENT || 'game-name-radar/1.0 by foxigaoqian';
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN || '';
const TIKTOK_RESEARCH_TOKEN = process.env.TIKTOK_RESEARCH_TOKEN || '';
const DAY = 86400000;

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}

function normalize(value = '') {
  return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function nameMatches(text = '', gameName = '') {
  const target = normalize(gameName);
  const haystack = normalize(text);
  return target.length >= 3 && haystack.includes(target);
}

function withTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * DAY).toISOString();
}

function compactDate(date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

async function queryYouTube(gameName) {
  const checkedAt = new Date().toISOString();
  const query = new URLSearchParams({
    part: 'snippet', type: 'video', order: 'date', maxResults: '25',
    q: `${gameName} game`, publishedAfter: isoDaysAgo(7),
    regionCode: 'US', relevanceLanguage: 'en', safeSearch: 'moderate', key: YOUTUBE_API_KEY,
  });
  const response = await withTimeout(`https://www.googleapis.com/youtube/v3/search?${query}`);
  if (!response.ok) throw new Error(`YouTube search ${response.status}`);
  const payload = await response.json();
  const matched = (payload.items || []).filter((item) => nameMatches(`${item.snippet?.title || ''} ${item.snippet?.description || ''}`, gameName));
  const ids = matched.map((item) => item.id?.videoId).filter(Boolean);
  if (!ids.length) return { configured: true, checkedAt, videoCount: 0, channelCount: 0, totalViews: 0, totalLikes: 0, totalComments: 0, recent24h: 0 };
  const statsQuery = new URLSearchParams({ part: 'statistics,snippet', id: ids.join(','), key: YOUTUBE_API_KEY });
  const statsResponse = await withTimeout(`https://www.googleapis.com/youtube/v3/videos?${statsQuery}`);
  if (!statsResponse.ok) throw new Error(`YouTube videos ${statsResponse.status}`);
  const stats = await statsResponse.json();
  const items = (stats.items || []).filter((item) => nameMatches(`${item.snippet?.title || ''} ${item.snippet?.description || ''}`, gameName));
  return {
    configured: true,
    checkedAt,
    videoCount: items.length,
    channelCount: new Set(items.map((item) => item.snippet?.channelId).filter(Boolean)).size,
    totalViews: items.reduce((sum, item) => sum + Number(item.statistics?.viewCount || 0), 0),
    totalLikes: items.reduce((sum, item) => sum + Number(item.statistics?.likeCount || 0), 0),
    totalComments: items.reduce((sum, item) => sum + Number(item.statistics?.commentCount || 0), 0),
    recent24h: items.filter((item) => Date.now() - Date.parse(item.snippet?.publishedAt || 0) <= DAY).length,
  };
}

let redditTokenPromise = null;
async function redditToken() {
  if (!redditTokenPromise) {
    redditTokenPromise = (async () => {
      const body = new URLSearchParams({ grant_type: 'client_credentials' });
      const response = await withTimeout('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': REDDIT_USER_AGENT,
        },
        body,
      });
      if (!response.ok) throw new Error(`Reddit token ${response.status}`);
      const payload = await response.json();
      if (!payload.access_token) throw new Error('Reddit token missing');
      return payload.access_token;
    })();
  }
  return redditTokenPromise;
}

async function queryReddit(gameName) {
  const checkedAt = new Date().toISOString();
  const token = await redditToken();
  const query = new URLSearchParams({ q: `"${gameName}"`, sort: 'new', t: 'week', type: 'link', limit: '25', raw_json: '1' });
  const response = await withTimeout(`https://oauth.reddit.com/search?${query}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': REDDIT_USER_AGENT },
  });
  if (!response.ok) throw new Error(`Reddit search ${response.status}`);
  const payload = await response.json();
  const posts = (payload.data?.children || [])
    .map((item) => item.data || {})
    .filter((item) => nameMatches(`${item.title || ''} ${item.selftext || ''}`, gameName));
  return {
    configured: true,
    checkedAt,
    postCount: posts.length,
    subredditCount: new Set(posts.map((item) => item.subreddit).filter(Boolean)).size,
    totalScore: posts.reduce((sum, item) => sum + Number(item.score || 0), 0),
    totalComments: posts.reduce((sum, item) => sum + Number(item.num_comments || 0), 0),
    recent24h: posts.filter((item) => Date.now() - Number(item.created_utc || 0) * 1000 <= DAY).length,
  };
}

async function queryX(gameName) {
  const checkedAt = new Date().toISOString();
  const query = new URLSearchParams({ query: `"${gameName}" lang:en -is:retweet`, granularity: 'hour' });
  const response = await withTimeout(`https://api.x.com/2/tweets/counts/recent?${query}`, {
    headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` },
  });
  if (!response.ok) throw new Error(`X recent counts ${response.status}`);
  const payload = await response.json();
  const buckets = payload.data || [];
  const cutoff = Date.now() - DAY;
  return {
    configured: true,
    checkedAt,
    posts7d: Number(payload.meta?.total_tweet_count || buckets.reduce((sum, item) => sum + Number(item.tweet_count || 0), 0)),
    posts24h: buckets.filter((item) => Date.parse(item.end || 0) >= cutoff).reduce((sum, item) => sum + Number(item.tweet_count || 0), 0),
  };
}

async function queryTikTok(gameName) {
  const checkedAt = new Date().toISOString();
  const end = new Date();
  const start = new Date(Date.now() - 7 * DAY);
  const fields = 'id,video_description,create_time,view_count,like_count,comment_count,share_count,username';
  const response = await withTimeout(`https://open.tiktokapis.com/v2/research/video/query/?fields=${encodeURIComponent(fields)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TIKTOK_RESEARCH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: { and: [
        { operation: 'IN', field_name: 'region_code', field_values: ['US', 'CA', 'GB', 'AU'] },
        { operation: 'EQ', field_name: 'keyword', field_values: [gameName] },
      ] },
      start_date: compactDate(start), end_date: compactDate(end), max_count: 100, cursor: 0, is_random: false,
    }),
  });
  if (!response.ok) throw new Error(`TikTok research ${response.status}`);
  const payload = await response.json();
  if (payload.error?.code && payload.error.code !== 'ok') throw new Error(`TikTok ${payload.error.message || payload.error.code}`);
  const videos = (payload.data?.videos || []).filter((item) => nameMatches(item.video_description || gameName, gameName));
  return {
    configured: true,
    checkedAt,
    videoCount: videos.length,
    creatorCount: new Set(videos.map((item) => item.username).filter(Boolean)).size,
    totalViews: videos.reduce((sum, item) => sum + Number(item.view_count || 0), 0),
    totalLikes: videos.reduce((sum, item) => sum + Number(item.like_count || 0), 0),
    totalComments: videos.reduce((sum, item) => sum + Number(item.comment_count || 0), 0),
    totalShares: videos.reduce((sum, item) => sum + Number(item.share_count || 0), 0),
  };
}

const providerTasks = {
  youtube: { configured: Boolean(YOUTUBE_API_KEY), run: queryYouTube },
  reddit: { configured: Boolean(REDDIT_CLIENT_ID && REDDIT_CLIENT_SECRET), run: queryReddit },
  x: { configured: Boolean(X_BEARER_TOKEN), run: queryX },
  tiktok: { configured: Boolean(TIKTOK_RESEARCH_TOKEN), run: queryTikTok },
};

function needsCheck(candidate) {
  if (candidate.social?.modelVersion !== SOCIAL_MODEL_VERSION) return true;
  const checkedAt = Date.parse(candidate.social?.checkedAt || '');
  return !Number.isFinite(checkedAt) || Date.now() - checkedAt > MAX_AGE;
}

function priority(candidate) {
  const trends = ['rising', 'breakout'].includes(candidate.trend?.classification) ? 45 : 0;
  const platforms = Number(candidate.siteType?.onlinePlatformCount || 0) * 20;
  const fast = Number(candidate.fast?.score || 0);
  const discovery = Number(candidate.discoveryScore || 0) * 3;
  const recent = Date.now() - Date.parse(candidate.firstSeen || 0) <= 2 * DAY ? 15 : 0;
  return trends + platforms + fast + discovery + recent;
}

const payload = await readJson(candidatesPath, { candidates: [] });
const candidates = Array.isArray(payload) ? payload : payload.candidates || [];
for (const candidate of candidates) candidate.siteType = classifySiteType(candidate);
const queue = candidates
  .filter((candidate) => candidate.siteType?.type === 'online')
  .filter((candidate) => candidate.seo?.modelVersion === 5 && ['independent', 'page'].includes(candidate.seo?.classification))
  .filter((candidate) => candidate.siteType?.browserPlayable && Number(candidate.seo?.nameRisk ?? 30) <= 20)
  .filter(needsCheck)
  .sort((a, b) => priority(b) - priority(a))
  .slice(0, LIMIT);

let verified = 0;
const classifications = { viral: 0, pass: 0, watch: 0, weak: 0, pending: 0 };
const errors = { youtube: 0, reddit: 0, x: 0, tiktok: 0 };
const configuredProviders = Object.entries(providerTasks).filter(([, value]) => value.configured).map(([name]) => name);

for (const candidate of configuredProviders.length ? queue : []) {
  const providers = {};
  const providerErrors = {};
  for (const [name, task] of Object.entries(providerTasks)) {
    if (!task.configured) {
      providers[name] = { configured: false };
      continue;
    }
    try {
      providers[name] = await task.run(candidate.gameName);
    } catch (error) {
      const message = String(error?.message || error).slice(0, 200);
      providerErrors[name] = message;
      errors[name] += 1;
      providers[name] = { configured: true, checkedAt: new Date().toISOString(), error: message };
    }
  }
  candidate.social = analyzeOnlineSocialBuzz({ social: { checkedAt: new Date().toISOString(), providers, providerErrors } });
  candidate.youtube = providers.youtube?.error ? candidate.youtube : providers.youtube;
  candidate.fast = calculateFastSignals(candidate, candidate.fast || {});
  applyFinalRecommendation(candidate);
  classifications[candidate.social.classification] += 1;
  verified += 1;
}

const report = await readJson(reportPath, {});
await fs.writeFile(candidatesPath, JSON.stringify({ ...payload, candidates }, null, 2) + '\n');
await fs.writeFile(reportPath, JSON.stringify({
  ...report,
  socialBuzzVerification: {
    modelVersion: SOCIAL_MODEL_VERSION,
    configured: configuredProviders.length > 0,
    configuredProviders,
    limit: LIMIT,
    queueSize: queue.length,
    verified,
    classifications,
    errors,
    ranAt: new Date().toISOString(),
  },
}, null, 2) + '\n');

console.log(`Social buzz verification complete: ${verified}/${queue.length}; providers: ${configuredProviders.join(', ') || 'none'}.`);
