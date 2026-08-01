const PLATFORM_HOSTS = [
  'store.steampowered.com', 'steampowered.com', 'steamcommunity.com',
  'itch.io', 'crazygames.com', 'poki.com', 'y8.com', 'gamepix.com',
  'lagged.com', 'newgrounds.com', 'roblox.com', 'xbox.com',
  'playstation.com', 'epicgames.com', 'nintendo.com',
  'youtube.com', 'youtu.be', 'twitch.tv', 'reddit.com',
  'discord.com', 'discord.gg', 'twitter.com', 'x.com', 'tiktok.com',
  'facebook.com', 'instagram.com', 'google.com', 'bing.com',
];

const DEDICATED_WIKI_HOSTS = ['fandom.com', 'wiki.gg', 'wikidot.com', 'wikiwand.com'];
const CONTENT_TERMS = /(?:wiki|guide|walkthrough|database|攻略|map|maps|build|builds|characters|items|weapons|codes)/i;

function normalized(value = '') {
  return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function compact(value = '') {
  return normalized(value).replace(/\s+/g, '');
}

function parseUrl(value = '') {
  try {
    const url = new URL(value);
    return {
      url,
      host: url.hostname.replace(/^www\./, '').toLowerCase(),
      path: `${url.pathname}${url.search}`.toLowerCase(),
    };
  } catch {
    return null;
  }
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function isPlatformHost(host) {
  return PLATFORM_HOSTS.some((domain) => hostMatches(host, domain));
}

function hostMentionsGame(host, gameCompact) {
  if (!gameCompact || gameCompact.length < 4) return false;
  return host.split('.').some((label) => compact(label).includes(gameCompact));
}

function pathMentionsGame(path, gameCompact) {
  if (!gameCompact || gameCompact.length < 4) return false;
  return compact(path).includes(gameCompact);
}

function uniqueHosts(records) {
  return [...new Set(records.map((record) => record.host).filter(Boolean))];
}

function ageDays(value, nowMs) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? Math.max(0, (nowMs - time) / 86400000) : Infinity;
}

export function analyzeMarketFreshness(candidate = {}, nowMs = Date.now()) {
  const gameName = candidate.gameName || candidate.seo?.queryName || '';
  const gameCompact = compact(gameName);
  const seo = candidate.seo || {};
  const trend = candidate.trend || {};
  const urls = [...new Set([
    ...(seo.exactResultUrls || []),
    ...(seo.gameResultUrls || []),
  ].filter(Boolean))];
  const records = urls.map(parseUrl).filter(Boolean);
  const nonPlatform = records.filter((record) => !isPlatformHost(record.host));

  const dedicated = nonPlatform.filter((record) => {
    if (hostMentionsGame(record.host, gameCompact)) return true;
    const wikiHost = DEDICATED_WIKI_HOSTS.some((domain) => hostMatches(record.host, domain));
    return wikiHost && pathMentionsGame(record.path, gameCompact);
  });

  const contentCompetitors = nonPlatform.filter((record) => {
    if (!pathMentionsGame(record.path, gameCompact) && !hostMentionsGame(record.host, gameCompact)) return false;
    return CONTENT_TERMS.test(`${record.host}${record.path}`);
  });

  const dedicatedDomains = uniqueHosts(dedicated);
  const contentDomains = uniqueHosts(contentCompetitors);
  const keywordFreshness = trend.keywordFreshness || 'unknown';
  const rising = ['rising', 'breakout'].includes(trend.classification)
    || ['rising', 'breakout'].includes(trend.globalClassification);
  const competitionChecked = Boolean(
    seo.modelVersion === 5
    && !seo.provisional
    && seo.provider !== 'evidence-fallback'
    && (Array.isArray(seo.exactResultUrls) || Array.isArray(seo.gameResultUrls)),
  );
  const recentlyDiscovered = ageDays(candidate.firstSeen, nowMs) <= 14;

  let status = 'unknown';
  let confidence = 'low';
  let reason = '关键词历史或现有竞争站占位尚未完成确认';

  if (keywordFreshness === 'existing') {
    status = 'established';
    confidence = 'high';
    reason = '90天历史显示该词早已有持续需求，属于老词或成熟词';
  } else if (dedicatedDomains.length > 0) {
    status = 'occupied';
    confidence = 'high';
    reason = `已发现专门站点或同名域名占位：${dedicatedDomains.slice(0, 3).join('、')}`;
  } else if (contentDomains.length >= 2) {
    status = 'occupied';
    confidence = 'medium';
    reason = `已有多个专门攻略/Wiki竞争站覆盖：${contentDomains.slice(0, 3).join('、')}`;
  } else if (competitionChecked && keywordFreshness === 'new' && rising) {
    status = 'greenfield';
    confidence = 'high';
    reason = '90天前段接近无量、近期上涨，且未发现专门站点占位';
  } else if (competitionChecked && rising && recentlyDiscovered && dedicatedDomains.length === 0 && contentDomains.length === 0) {
    status = 'unconfirmed-new';
    confidence = 'medium';
    reason = '近期上涨且暂未发现专站，但90天关键词历史仍待确认';
  } else if (competitionChecked && contentDomains.length === 1) {
    status = 'contested';
    confidence = 'medium';
    reason = `已出现早期内容竞争站：${contentDomains[0]}`;
  }

  return {
    modelVersion: 1,
    checkedAt: new Date(nowMs).toISOString(),
    status,
    confidence,
    reason,
    keywordFreshness,
    rising,
    competitionChecked,
    dedicatedDomains,
    contentDomains,
    allowsIndependent: status === 'greenfield',
    provisionalNew: status === 'unconfirmed-new',
  };
}

export function marketFreshnessLabel(status) {
  return {
    greenfield: '严格新词·窗口开放',
    'unconfirmed-new': '疑似新词·历史待确认',
    contested: '已有早期竞争',
    occupied: '已有专站占位',
    established: '成熟老词',
    unknown: '新旧待确认',
  }[status] || '新旧待确认';
}
