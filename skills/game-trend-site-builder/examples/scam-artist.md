# Case Study: Scam Artist

This case validates the corrected workflow end to end.

## What worked

The process started with the game entity rather than the website design.

The game was confirmed as a browser-playable HTML5 prototype. The real itch-hosted runtime was located and tested before the final landing page was built.

That allowed the final site to include:

- a real playable iframe
- lazy loading behind a `Load Game` action
- reload control
- fullscreen control
- official fallback links
- game-specific How to Play content
- game-specific beginner tips
- accurate attribution

## Visual lesson

The website was not designed as a generic blue/purple gaming page.

Its visual direction followed the game's own identity:

- dark pixel-art presentation
- money/scam theme
- warm dark backgrounds
- gold/cash accents
- harder-edged cards and controls
- building/idle progression emphasis

This is the reusable rule:

> reuse the production workflow and component responsibilities, but derive the design system again for every game.

## Technical lesson

A verified runtime URL should be treated as configuration rather than duplicated across the project.

Example:

```js
const GAME = {
  name: "Scam Artist",
  officialUrl: "OFFICIAL_PROJECT_URL",
  runtimeUrl: "VERIFIED_RUNTIME_URL"
};
```

If the developer uploads a new browser build, updating one configuration value should be enough.

## Acceptance lesson

A project should only be labeled `deployment-ready` after the player itself passes QA. A screenshot of a beautiful landing page is not sufficient proof.
