# Game Trend Site Builder

Open-source agent skill for turning a game keyword into a **game-native, play-first SEO website**.

This is designed for the workflow we validated with browser games hosted on itch.io: resolve the real game, find and test the actual HTML5 runtime iframe, study the game, then generate a website whose visual language matches that game instead of applying a generic landing-page skin.

## What this skill does

Given as little as:

```text
Game keyword: Goblincremental
```

an agent should:

1. Find the correct official game.
2. Verify browser/HTML5 availability.
3. Extract the actual runtime iframe URL when possible.
4. Test whether the runtime works inside a third-party page.
5. Research mechanics, controls, screenshots, terminology and player intent.
6. Derive a visual direction from the game itself.
7. Build a deployable responsive website.
8. Put the real playable game near the top when embedding is verified.
9. Add useful How to Play / Tips / FAQ / Guide content.
10. Add accurate SEO metadata, JSON-LD, attribution and QA checks.

## Why the iframe step matters

An itch.io project URL such as:

```text
https://developer.itch.io/game-name
```

is **not** the game runtime.

A real runtime may look like:

```text
https://html-classic.itch.zone/html/18776001/index.html?v=...
```

The skill requires agents to verify the real runtime before declaring a play-first website complete.

If a parser only returns page text and hides iframe attributes, the agent must continue investigating instead of assuming the game cannot be embedded.

## Design rule

> Repeat the information architecture, not the visual design.

A cute dog game should not look like a dark incremental game. A drawing challenge should not look like a goblin management game.

The site's palette, typography, layout density, borders, cards, textures, motion and microcopy should be derived from the current game's visual DNA.

## Typical output

```text
Game: Example Game
Embed: VERIFIED
Design direction: pixel-art management / dark UI / resource panels
Pages: /, /how-to-play, /tips, /faq
Deployment-ready: YES
Blocking issues: none
```

## Files

- [`SKILL.md`](./SKILL.md) — full agent instructions
- [`references/iframe-verification.md`](./references/iframe-verification.md) — iframe/runtime extraction and validation
- [`references/site-blueprint.md`](./references/site-blueprint.md) — page and component architecture
- [`references/qa-checklist.md`](./references/qa-checklist.md) — final acceptance checklist
- [`examples/goblincremental.md`](./examples/goblincremental.md) — embed lesson from Goblincremental
- [`examples/scam-artist.md`](./examples/scam-artist.md) — successful end-to-end embed test pattern

## Relationship to Game Name Radar

This repository already contains **Game Name Radar**, which discovers and evaluates game keywords.

The intended pipeline is:

```text
Game Name Radar
    ↓
Selected keyword
    ↓
Game Trend Site Builder
    ↓
Playable, game-native website
    ↓
Deploy + Search Console feedback
```

## Responsible use

Technical embeddability is not the same as permission. Check creator/host terms, keep creator attribution, avoid claiming official status, and do not mirror game binaries without authorization.

## License

This skill is distributed under the repository's MIT License.
