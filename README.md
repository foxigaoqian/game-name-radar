# Game Name Radar

面向游戏 SEO 趋势站的自动化游戏关键词发现工具。它从游戏平台、Steam、RSS、榜单、Google Trends Rising 和竞争站 Sitemap 中发现候选，再通过三层漏斗筛选真正值得检查的游戏词。

## 配套开源 Skill：Game Trend Site Builder

仓库现在同时提供 [`skills/game-trend-site-builder`](./skills/game-trend-site-builder/)：把已经选中的游戏词进一步变成一个**符合游戏自身视觉风格、可验证真实 iframe、Play-first、可部署的游戏网站**。

它不是固定换皮模板。执行顺序是：

```text
游戏词
  → 找到官方游戏
  → 确认 HTML5 / Browser Build
  → 找到真实运行 iframe
  → 第三方页面实测
  → 研究玩法与官方视觉
  → 针对该游戏重新设计 UI
  → Play + How to Play + Tips + FAQ + SEO
  → 响应式与最终 QA
```

完整说明见 [`SKILL.md`](./skills/game-trend-site-builder/SKILL.md)。

## 核心流程

```text
多来源发现游戏名
  → SEO 搜索意图与实体冲突验证
  → 快速热度验证
     · 24h / 48h 平台扩散
     · 榜单排名变化
     · Google 自动补全新增
     · SERP 新增页面
     · YouTube 视频 / 频道 / 播放量（可选）
  → Google Trends 7天 / 30天 / 90天验证
  → 独立站、站内页、观察或淘汰
```

只有通过快速热度层的少量候选才会进入 Google Trends，避免免费 Trends 接口被几百个低质量词占满。

## 自动数据源

- itch.io 最新网页游戏
- itch.io New & Popular
- itch.io New Feed / Featured Feed
- Steam 热门新发行 / 最新独立游戏
- Newgrounds Daily Top Five / 最新通过作品
- CrazyGames、Poki、Y8、GamePix、Lagged 新游戏
- Google Trends 相关上涨查询
- 可配置竞争站 Sitemap / Sitemap Index

## 三层评分

### 1. SEO 意图层

检查：

- 主词结果中的游戏占比
- `游戏名 + game play online` 的游戏意图
- 新闻、歌曲、影视、产品等实体冲突
- 自动补全中的游戏长尾和非游戏长尾
- 名称通用度和歧义风险

### 2. 快速热度层

检查：

- 24小时与48小时新增独立来源数量
- 平台榜单当前排名、最佳排名和排名提升
- 自动补全新增游戏长尾数量
- SERP 新增相关页面数量
- 来源是否来自 Trends Rising、Featured、New & Popular 或热门新发行
- YouTube 近7天视频数、不同频道数和播放量（配置 Key 后启用）

快速层分为：

- `pass`：进入 Google Trends
- `watch`：继续观察，不消耗 Trends 请求
- `weak`：热度不足
- `reject`：搜索意图或实体冲突未通过

### 3. Google Trends 层

同时比较：

- 游戏主词
- `游戏名 + game`
- 基准词 `itch io`
- 最近7天、30天和90天

用于判断：

- 7天或30天持续上涨
- Breakout
- 单日孤立尖峰
- 关键词是否早已存在
- 主词热度是否来自其他实体

## GitHub Actions

`.github/workflows/radar.yml` 默认在每小时第17分和第47分运行。旧任务会在新任务开始时自动取消，只保留最新扫描。

工作流会：

1. 抓取全部自动数据源
2. 更新来源首次发现时间和榜单排名
3. 每轮最多验证50个SEO候选
4. 计算全部当前候选的快速热度
5. 只把快速层通过的候选送入 Google Trends
6. 提交 `data/state.json`、`data/candidates.json` 和 `data/latest-report.json`

## 可选 YouTube 验证

YouTube 验证默认关闭，不影响其他功能。

需要启用时，在 GitHub 仓库中添加 Actions Secret：

```text
YOUTUBE_API_KEY
```

启用后，每轮最多验证3个高优先级候选，获取近7天：

- 视频数量
- 不同频道数量
- 总播放量
- 最近24小时视频数量

未设置 Secret 时，系统会自动跳过 YouTube，不会报错。

## 本地运行

```bash
npm install
npm test
npm run scan
```

前端本地预览：

```bash
npm install -g vercel
vercel dev
```

## 添加竞争站 Sitemap

在 `config/sources.json` 中加入：

```json
{
  "id": "competitor-example",
  "name": "Example Games Sitemap",
  "url": "https://example.com/game-sitemap.xml",
  "kind": "competitor-sitemap",
  "fetchKind": "sitemap",
  "enabled": true,
  "baselineOnly": true
}
```

首次运行只建立基线，第二次开始识别新增 URL。

## Vercel 部署

1. 在 Vercel 导入 GitHub 仓库
2. Framework Preset 选择 `Other`
3. 不需要 Build Command
4. 部署

前端直接读取 GitHub 中的最新结果数据，因此自动扫描更新数据时不需要重新部署页面。

## 数据文件

- `data/state.json`：来源快照、URL和榜单位置
- `data/candidates.json`：候选、SEO、快速热度、YouTube和Trends结果
- `data/latest-report.json`：最近一次扫描统计

## 合规提醒

本工具只发现公开页面与名称。将第三方游戏 iframe 到独立站之前，应确认开发者授权、嵌入条款、素材使用权限和广告许可。
