const SOCIAL_MODEL_VERSION = 3;

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function checked(provider = {}) {
  return Boolean(provider && provider.checkedAt && !provider.error);
}

function configured(provider = {}) {
  return Boolean(provider && provider.configured);
}

function youtubeScore(data = {}) {
  const views = number(data.totalViews);
  const likes = number(data.totalLikes);
  const comments = number(data.totalComments);
  const videos = number(data.videoCount);
  const channels = number(data.channelCount);
  const recent24h = number(data.recent24h);
  let score = 0;
  if (views >= 250000) score += 28;
  else if (views >= 100000) score += 24;
  else if (views >= 20000) score += 18;
  else if (views >= 5000) score += 10;
  else if (views >= 1000) score += 5;
  if (channels >= 8) score += 12;
  else if (channels >= 4) score += 8;
  else if (channels >= 2) score += 4;
  if (videos >= 10) score += 8;
  else if (videos >= 5) score += 5;
  else if (videos >= 2) score += 2;
  if (recent24h >= 5) score += 8;
  else if (recent24h >= 2) score += 4;
  const engagement = likes + comments;
  if (engagement >= 10000) score += 6;
  else if (engagement >= 2000) score += 4;
  else if (engagement >= 300) score += 2;
  return score;
}

function redditScore(data = {}) {
  const posts = number(data.postCount);
  const subreddits = number(data.subredditCount);
  const recent24h = number(data.recent24h);
  const engagement = number(data.totalScore) + number(data.totalComments);
  let score = 0;
  if (posts >= 10) score += 14;
  else if (posts >= 5) score += 10;
  else if (posts >= 2) score += 5;
  if (subreddits >= 4) score += 6;
  else if (subreddits >= 2) score += 3;
  if (engagement >= 1000) score += 10;
  else if (engagement >= 300) score += 7;
  else if (engagement >= 50) score += 4;
  if (recent24h >= 3) score += 5;
  else if (recent24h >= 1) score += 2;
  return score;
}

function xScore(data = {}) {
  const posts7d = number(data.posts7d);
  const posts24h = number(data.posts24h);
  let score = 0;
  if (posts7d >= 1000) score += 18;
  else if (posts7d >= 300) score += 14;
  else if (posts7d >= 100) score += 10;
  else if (posts7d >= 30) score += 6;
  else if (posts7d >= 10) score += 3;
  if (posts24h >= 100) score += 6;
  else if (posts24h >= 30) score += 4;
  else if (posts24h >= 10) score += 2;
  return score;
}

function tiktokScore(data = {}) {
  const views = number(data.totalViews);
  const videos = number(data.videoCount);
  const engagement = number(data.totalLikes) + number(data.totalComments) + number(data.totalShares);
  let score = 0;
  if (views >= 1000000) score += 22;
  else if (views >= 250000) score += 17;
  else if (views >= 50000) score += 12;
  else if (views >= 10000) score += 6;
  else if (views >= 2000) score += 3;
  if (videos >= 20) score += 8;
  else if (videos >= 8) score += 5;
  else if (videos >= 3) score += 2;
  if (engagement >= 50000) score += 8;
  else if (engagement >= 10000) score += 5;
  else if (engagement >= 1000) score += 2;
  return score;
}

function independentCreatorCount(name, data = {}) {
  if (name === 'youtube') return number(data.channelCount);
  if (name === 'reddit') return number(data.authorCount);
  if (name === 'x') return number(data.authorCount);
  if (name === 'tiktok') return number(data.creatorCount);
  return 0;
}

function recent24hCount(name, data = {}) {
  if (name === 'youtube' || name === 'reddit' || name === 'tiktok') return number(data.recent24h);
  if (name === 'x') return number(data.posts24h);
  return 0;
}

function strongProvider(name, data = {}) {
  if (name === 'youtube') {
    return (number(data.totalViews) >= 20000 && number(data.channelCount) >= 3)
      || (number(data.totalViews) >= 5000 && number(data.videoCount) >= 5);
  }
  if (name === 'reddit') {
    return number(data.postCount) >= 3
      && number(data.totalScore) + number(data.totalComments) >= 50;
  }
  if (name === 'x') return number(data.posts7d) >= 50;
  if (name === 'tiktok') return number(data.totalViews) >= 50000 && number(data.videoCount) >= 3;
  return false;
}

function veryStrongProvider(name, data = {}) {
  if (name === 'youtube') return number(data.totalViews) >= 100000 && number(data.channelCount) >= 4;
  if (name === 'reddit') return number(data.postCount) >= 8 && number(data.totalScore) + number(data.totalComments) >= 500;
  if (name === 'x') return number(data.posts7d) >= 300;
  if (name === 'tiktok') return number(data.totalViews) >= 250000 && number(data.videoCount) >= 5;
  return false;
}

export function analyzeOnlineSocialBuzz(candidate = {}) {
  const stored = candidate.social || {};
  const providers = stored.providers || {
    youtube: stored.youtube || candidate.youtube || {},
    reddit: stored.reddit || {},
    x: stored.x || {},
    tiktok: stored.tiktok || {},
  };
  const names = ['youtube', 'reddit', 'x', 'tiktok'];
  const configuredProviders = names.filter((name) => configured(providers[name]));
  const checkedProviders = names.filter((name) => checked(providers[name]));
  const activeProviders = checkedProviders.filter((name) => {
    const data = providers[name] || {};
    if (name === 'youtube') return number(data.videoCount) > 0 || number(data.totalViews) > 0;
    if (name === 'reddit') return number(data.postCount) > 0;
    if (name === 'x') return number(data.posts7d) > 0;
    if (name === 'tiktok') return number(data.videoCount) > 0 || number(data.totalViews) > 0;
    return false;
  });
  const strongProviders = activeProviders.filter((name) => strongProvider(name, providers[name]));
  const veryStrongProviders = activeProviders.filter((name) => veryStrongProvider(name, providers[name]));
  const independentProviders = activeProviders.filter((name) => independentCreatorCount(name, providers[name]) >= 2);
  const independentCreators = independentProviders.reduce((sum, name) => sum + independentCreatorCount(name, providers[name]), 0);
  const freshProviders = activeProviders.filter((name) => recent24hCount(name, providers[name]) > 0);
  const hasExternalSpillover = independentProviders.length >= 2
    && independentCreators >= 4
    && freshProviders.length >= 1;
  const singlePlatformMomentum = activeProviders.find((name) =>
    strongProvider(name, providers[name])
    && independentCreatorCount(name, providers[name]) >= 3
    && recent24hCount(name, providers[name]) > 0);
  const hasSinglePlatformMomentum = Boolean(singlePlatformMomentum);

  let score = youtubeScore(providers.youtube)
    + redditScore(providers.reddit)
    + xScore(providers.x)
    + tiktokScore(providers.tiktok);
  if (activeProviders.length >= 3) score += 12;
  else if (activeProviders.length >= 2) score += 7;
  score = Math.max(0, Math.min(100, score));

  let classification = 'pending';
  if (checkedProviders.length > 0) {
    classification = 'weak';
    if (score >= 75 && strongProviders.length >= 2 && hasExternalSpillover) classification = 'viral';
    else if (score >= 45 && strongProviders.length >= 2 && hasExternalSpillover) classification = 'pass';
    else if (hasSinglePlatformMomentum || score >= 20 || activeProviders.length >= 2) classification = 'watch';
  }

  const reasons = [];
  const youtube = providers.youtube || {};
  const reddit = providers.reddit || {};
  const x = providers.x || {};
  const tiktok = providers.tiktok || {};
  if (number(youtube.videoCount) > 0) reasons.push(`YouTube近7天${number(youtube.videoCount)}个视频／${number(youtube.channelCount)}个频道／${number(youtube.totalViews).toLocaleString('en-US')}播放`);
  if (number(youtube.recent24h) > 0) reasons.push(`YouTube近24小时新增${number(youtube.recent24h)}个相关视频`);
  if (number(reddit.postCount) > 0) reasons.push(`Reddit近7天${number(reddit.postCount)}个帖子／${number(reddit.subredditCount)}个社区／${(number(reddit.totalScore) + number(reddit.totalComments)).toLocaleString('en-US')}互动`);
  if (number(x.posts7d) > 0) reasons.push(`X近7天约${number(x.posts7d).toLocaleString('en-US')}条提及，近24小时${number(x.posts24h).toLocaleString('en-US')}条`);
  if (number(tiktok.videoCount) > 0) reasons.push(`TikTok近7天${number(tiktok.videoCount)}个视频／${number(tiktok.totalViews).toLocaleString('en-US')}播放`);
  if (activeProviders.length >= 2) reasons.push(`已在${activeProviders.length}个社媒平台形成传播`);
  if (hasExternalSpillover) reasons.push(`至少${independentProviders.length}个平台、${independentCreators}个独立创作者形成外溢传播`);
  else if (hasSinglePlatformMomentum) reasons.push(`${singlePlatformMomentum}单平台已出现多个独立创作者且24小时仍在新增，可用于低成本测试但不足以直接确认独立站`);
  else if (activeProviders.length > 0) reasons.push('尚未验证多个平台与多个独立创作者的外溢传播');
  if (checkedProviders.length === 0 && stored.providerErrors && Object.keys(stored.providerErrors).length) reasons.push('社媒Provider本轮验证失败，按未知处理而不是按无热度处理');
  else if (checkedProviders.length === 0) reasons.push('尚未完成社媒热度验证');
  else if (activeProviders.length === 0) reasons.push('已检查社媒，但暂未发现明显宣传或玩家讨论');
  else if (classification === 'weak') reasons.push('社媒提及存在，但传播规模不足以支持独立站推荐');
  if (stored.providerErrors && Object.keys(stored.providerErrors).length) reasons.push('部分社媒数据源暂不可用，结果按已成功的数据源计算');

  return {
    modelVersion: SOCIAL_MODEL_VERSION,
    checkedAt: stored.checkedAt || new Date().toISOString(),
    score,
    classification,
    confidence: checkedProviders.length >= 3 ? 'high' : checkedProviders.length >= 1 ? 'medium' : 'low',
    providers,
    configuredProviders,
    checkedProviders,
    activeProviders,
    strongProviders,
    veryStrongProviders,
    independentProviders,
    independentCreatorCount: independentCreators,
    freshProviders,
    crossPlatformCount: activeProviders.length,
    hasExternalSpillover,
    hasSinglePlatformMomentum,
    singlePlatformMomentum: singlePlatformMomentum || null,
    hasMeasuredEvidence: checkedProviders.length > 0,
    evidenceStatus: checkedProviders.length > 0 ? 'measured' : (stored.providerErrors && Object.keys(stored.providerErrors).length ? 'provider-error' : 'unknown'),
    allowsTest: hasExternalSpillover || hasSinglePlatformMomentum || checkedProviders.length === 0,
    allowsIndependent: ['pass', 'viral'].includes(classification) && hasExternalSpillover,
    reasons,
    providerErrors: stored.providerErrors || {},
  };
}

export function socialBuzzLabel(classification) {
  return {
    viral: '社媒爆发·强传播',
    pass: '社媒热度通过',
    watch: '社媒热度观察',
    weak: '社媒传播不足',
    pending: '等待社媒验证',
  }[classification] || '等待社媒验证';
}

export { SOCIAL_MODEL_VERSION };
