---
name: game-trend-site-builder
description: Build a deployable, game-native, play-first SEO website from a game keyword or official game URL. Research the real game first, verify a working third-party browser embed when possible, then generate a visual system, page architecture, copy, SEO metadata, structured data, responsive UI, and QA plan tailored to that specific game.
---

# Game Trend Site Builder

Build a real website from a game keyword, not a generic SEO page with the game name swapped in.

The target pattern is a **play-first discovery/guide site**:

1. User provides a game keyword, and optionally an itch.io/Steam/official URL.
2. Find the canonical game and current official sources.
3. Verify whether the game can actually run inside a third-party website.
4. Study the game's art direction, mechanics, controls, terminology, and player intent.
5. Design a site that visually belongs to that game.
6. Put the playable game near the top when embedding is verified.
7. Surround the playable experience with useful, indexable game-specific content.
8. Produce deployable code, SEO metadata, structured data, attribution, and QA checks.

This skill is for building the site. It is **not** a keyword discovery or trend scoring skill.

---

## Core Principle

**The information architecture may repeat. The visual design must not.**

Do not make every site look like the same template.

A cute pet-washing game, a perspective drawing challenge, a goblin incremental game, and a dark pixel-art idle game should have visibly different:

- color systems
- typography
- border radius
- spacing density
- illustration treatment
- button shapes
- background texture
- card design
- iconography
- motion
- voice and microcopy

The generated website should feel like an extension of the game rather than an unrelated SEO shell.

---

# Inputs

Minimum input:

```text
Game keyword: <name>
```

Preferred input:

```text
Game keyword: <name>
Official URL: <optional>
Target domain: <optional>
Preferred stack: static HTML | Next.js | Astro | other
Language: English by default
Deployment target: Cloudflare | Vercel | GitHub Pages | other
```

If only a keyword is provided, research the current official game before generating the site.

---

# Mandatory Workflow

Do not skip or reorder the first three phases.

## Phase 1 — Resolve the Game Entity

Find the current canonical source.

Preferred source order:

1. official website
2. itch.io developer page
3. Steam store page
4. developer/publisher page
5. official social account

Confirm:

- exact game name
- developer/publisher
- release/prototype/demo status
- platforms
- browser availability
- current game description
- real mechanics
- real controls when documented
- official screenshots/artwork

Do not infer mechanics from the title alone.

If multiple games share the same name, stop and resolve the correct entity before building.

---

## Phase 2 — Verify Browser Playability

This is a hard gate for a play-first site.

### 2.1 Check whether the official page says the game is HTML5/browser playable

Signals include:

- `Run game`
- `Play in browser`
- platform `HTML5`
- an embedded game canvas/iframe

### 2.2 Find the actual runtime URL

**Never put the itch.io project detail page into the game iframe.**

Incorrect:

```html
<iframe src="https://developer.itch.io/game-name"></iframe>
```

Look for the actual runtime iframe, commonly resembling:

```text
https://html-classic.itch.zone/html/<build-id>/index.html?... 
https://html-classic.itch.zone/html/<build-id>/web/index.html?...
```

Possible extraction methods:

- inspect rendered DOM
- inspect page source
- inspect browser network requests
- inspect the game iframe element
- inspect public developer comments/devlogs if the runtime URL is surfaced there

The parsed text version of a webpage may omit iframe `src` attributes. If the page clearly shows `Run game + HTML5`, do not conclude that no runtime exists merely because text extraction did not expose it.

### 2.3 Test the runtime in a minimal third-party page

Use a minimal test before designing the full website:

```html
<!doctype html>
<meta charset="utf-8">
<style>
html,body,iframe{margin:0;width:100%;height:100%;border:0}
</style>
<iframe
  src="REAL_RUNTIME_URL"
  allow="autoplay; fullscreen *; gamepad; gyroscope; accelerometer; web-share"
  allowfullscreen>
</iframe>
```

Verify:

- the game loads
- keyboard input works
- mouse/touch works
- audio starts when permitted
- fullscreen works when supported
- the game does not immediately navigate away
- no `X-Frame-Options` or CSP `frame-ancestors` block occurs

### 2.4 If embedding fails

Do not fake a playable player.

Choose one:

- build a guide/discovery site with a prominent official `Play on itch.io` button
- reject the game for the play-first template

Label the result clearly as `embed unsupported`.

---

## Phase 3 — Check Attribution and Usage Boundaries

Technical embeddability is not the same as permission.

Before production deployment, check available developer/host terms and asset usage expectations.

Rules:

- do not claim to be the official website unless it is actually official
- do not remove creator attribution
- do not mirror or redistribute game binaries unless authorized
- prefer loading the current host-provided runtime instead of copying game files
- link to the official game/developer page
- use an `Unofficial discovery/guide` disclosure when appropriate
- do not fabricate endorsement or affiliation

If permission is unclear, state that production use should be confirmed with the creator.

---

# Game Research Brief

Before UI generation, create a compact internal brief.

Collect:

## Identity

- game name
- developer
- tagline/official description
- genre
- platform
- release status

## Mechanics

- primary loop
- win/score/progression condition
- resources
- upgrades
- characters
- enemies
- levels/rooms/areas
- prestige/reset mechanics
- daily challenges
- leaderboard
- collections
- codes/secrets if real

## Controls

Only document controls supported by official sources or verified play.

## Visual DNA

Extract from official screenshots and artwork:

- dominant colors
- accent colors
- pixel art / vector / hand-drawn / 3D / minimalist
- UI density
- shapes
- border style
- shadows
- texture
- typography mood
- icon style
- animation style

## Search/User Intent

Identify what a new player actually wants:

- play now
- how to play
- controls
- tips
- score explanation
- upgrades
- builds
- wiki/reference
- codes
- secrets
- mobile compatibility
- save progress
- release date

Do not create sections for systems that do not exist in the game.

---

# Visual Direction Rules

Translate the Visual DNA into a site design system.

Examples:

### Cute / cozy / pet / casual

Prefer:

- soft pastel palette
- larger radius
- illustrated buttons
- bubbly spacing
- friendly microcopy
- sticker/card motifs

### Drawing / precision / challenge

Prefer:

- cleaner geometry
- score/challenge emphasis
- high whitespace or grid-paper motifs
- visible challenge feedback
- sharper interactive states

### Incremental / management / strategy

Prefer:

- resource counters
- compact stats
- upgrade/progression panels
- stronger information hierarchy
- dashboards only when consistent with the game

### Pixel / dark / roguelike / idle

Prefer:

- pixel-compatible typography treatment
- hard edges
- low-radius cards
- game-like status bars
- limited neon/highlight accents
- stronger texture/shadow contrast

These are starting heuristics, not fixed themes.

---

# Required Page Architecture

The default site should work well as a single high-quality landing page first.

## 1. Navigation

Keep it small.

Typical links:

- Play
- How to Play
- Tips / Guide
- FAQ
- Official Game

## 2. Hero

Must answer within seconds:

- What game is this?
- Why should I play it?
- Can I play now?

Required:

- one H1
- concise game-specific description
- primary Play action
- official artwork/screenshot where permitted

Avoid generic filler such as `The ultimate gaming experience`.

## 3. Game Player

Place high on the page when embed verification succeeded.

Recommended behavior:

- lazy load on user interaction
- clear `Load Game` button
- responsive container
- Reload button
- Fullscreen button
- official host attribution
- fallback link to official game page

Do not force autoplaying audio before interaction.

## 4. How to Play

Explain the real loop in 3–6 steps.

Use the game's own terminology.

## 5. Features / Systems

Only include systems that were verified.

Examples:

- score
- daily challenge
- prestige
- upgrades
- rooms
- spells
- collection
- leaderboard

## 6. Tips / Beginner Guide

Give practical advice based on verified mechanics.

Do not invent advanced strategies merely to fill SEO copy.

## 7. Screenshots / Game Feel

Use official screenshots or creator-approved media.

Keep images meaningful rather than decorative duplication.

## 8. FAQ

Good topics:

- What is the game?
- Is it free?
- Can I play in browser?
- Does it work on mobile?
- How do controls work?
- Does progress save?
- Who made it?
- Where is the official page?

Only answer what can be verified.

## 9. Footer

Include:

- creator attribution
- official game link
- unofficial-site disclosure when appropriate
- copyright/trademark neutrality language if relevant

---

# Optional Multi-page Expansion

Only create pages that match real player intent.

Possible routes:

```text
/
/how-to-play
/tips
/guide
/wiki
/upgrades
/builds
/codes
/leaderboard
/daily
/secrets
/calculator
/release-date
```

Do not publish empty SEO doorway pages.

A page should exist only if it can answer a distinct user need with meaningful content.

---

# SEO Requirements

## Metadata

Generate game-specific:

- `<title>`
- meta description
- canonical URL
- Open Graph title/description/image
- Twitter card metadata when useful

Avoid forced keyword stuffing.

Example pattern, not a fixed title:

```text
Play <Game Name> Online — Guide, Controls & Tips
```

Use `Free` only if the current browser version is actually free.

## Headings

- one H1
- logical H2/H3 hierarchy
- headings should describe real sections, not repeated keyword variants

## Structured Data

Use structured data only when accurate.

Potential types:

- `VideoGame`
- `FAQPage`
- `BreadcrumbList` for multi-page sites

Do not mark unrelated content as `SoftwareApplication` simply for SEO coverage.

## Crawlability

Production output should include:

- robots.txt
- sitemap.xml
- canonical URLs
- clean internal links
- no accidental `noindex`

---

# Implementation Requirements

Default output should be deployable, not a mockup.

For static HTML:

- semantic HTML5
- CSS variables for design tokens
- minimal JavaScript
- responsive desktop/tablet/mobile behavior
- no broken placeholder links
- no fake player

For frameworks:

- isolate game embed as a component
- keep the runtime URL configurable
- avoid hardcoding the same URL in multiple files
- preserve metadata and JSON-LD server-side where applicable

Recommended configuration concept:

```js
const GAME = {
  name: "Example Game",
  officialUrl: "https://...",
  runtimeUrl: "https://html-classic.itch.zone/...",
  developer: "Example Developer"
};
```

Runtime URLs may change after developers upload a new Web build. Keep them easy to update.

---

# Player Component Requirements

A valid player implementation should support:

```html
<iframe
  src="REAL_RUNTIME_URL"
  title="<Game Name> browser game"
  allow="autoplay; fullscreen *; gamepad; gyroscope; accelerometer; web-share"
  allowfullscreen
  scrolling="no">
</iframe>
```

Do not copy irrelevant permissions blindly. Preserve host-required permissions when the official iframe uses them.

Recommended UX:

1. render poster/cover first
2. user clicks `Load Game`
3. assign iframe `src`
4. hide poster
5. offer reload/fullscreen
6. keep official fallback link visible

---

# Content Quality Rules

Never generate content from the game name alone.

Every factual statement about the game must be supported by one of:

- official game page
- official developer page
- official Steam page
- official devlog
- direct verified gameplay

Do not invent:

- scores
- controls
- release dates
- mobile support
- saves
- leaderboards
- upgrades
- characters
- hidden content
- codes

If a fact cannot be confirmed, omit it or label it unknown.

---

# Responsive Requirements

Desktop is not enough.

Verify at minimum:

- ~1440px desktop
- ~768px tablet
- ~390px mobile

Check:

- hero does not overwhelm mobile
- iframe remains usable
- player height is sufficient
- fullscreen remains available
- touch target size is reasonable
- navigation does not overflow
- screenshots do not cause layout shifts
- body text remains readable

Some browser games are technically embeddable but unusable on small screens. If so, state `desktop recommended` instead of pretending mobile play is good.

---

# Performance Rules

- lazy-load game runtime after a click where possible
- compress site-owned images
- do not preload every screenshot
- avoid heavy UI libraries for a single-page static site
- keep external fonts minimal
- preserve the game runtime independently from site assets

The website should load before the game payload.

---

# Final QA Gate

A project is not complete until all relevant checks pass.

## Game

- [ ] Actual runtime URL is used, not the itch.io detail page
- [ ] Game loads inside the site
- [ ] Mouse/keyboard input works
- [ ] Touch is checked if mobile is claimed
- [ ] Fullscreen is checked
- [ ] Reload works
- [ ] Official fallback link works

## Design

- [ ] Visual system clearly matches this specific game
- [ ] It is not a recolored generic template
- [ ] Official screenshots are displayed correctly
- [ ] No stretched artwork
- [ ] Mobile layout is intentional

## Content

- [ ] Mechanics are verified
- [ ] Controls are verified
- [ ] No fabricated features
- [ ] Copy is useful to an actual player

## SEO

- [ ] Unique title/meta
- [ ] Single H1
- [ ] canonical
- [ ] Open Graph
- [ ] valid JSON-LD where used
- [ ] sitemap/robots for production

## Attribution

- [ ] Developer is credited
- [ ] Official link exists
- [ ] Unofficial status is clear when applicable
- [ ] No claim of ownership of the game

If the iframe is broken, the play-first site **fails QA**, even if the UI looks finished.

---

# Output Contract

When invoked for a game keyword, deliver:

```text
1. Resolved game identity
2. Official source URLs
3. Embed status: verified / unsupported / needs manual verification
4. Runtime URL when verified
5. Game research brief
6. Visual direction
7. Site architecture
8. Deployable site code
9. SEO metadata + JSON-LD
10. Attribution/disclosure
11. QA result
```

For a completed build, summarize status in this format:

```text
Game: <name>
Embed: VERIFIED | UNSUPPORTED | MANUAL CHECK REQUIRED
Design direction: <short description>
Pages: <list>
Deployment-ready: YES | NO
Blocking issues: <none or list>
```

---

# Failure Conditions

Stop and report a blocker instead of pretending the site is complete when:

- the game entity cannot be resolved
- browser gameplay cannot be verified
- a third-party iframe is blocked
- required artwork cannot be used responsibly
- the game page is removed/offline
- key content would have to be fabricated

A polished fake player is worse than an honest `Play on official site` fallback.

---

# Relationship to Game Name Radar

`game-name-radar` finds and evaluates emerging game keywords.

This skill takes a selected keyword and turns it into a researched, game-native website.

Recommended pipeline:

```text
Game Name Radar
  → selected game keyword
  → Game Trend Site Builder
  → embed verification
  → game-specific website
  → deployment
  → Search Console / analytics feedback
```
