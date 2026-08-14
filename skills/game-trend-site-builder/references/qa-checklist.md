# QA Checklist

A website is not complete because the hero looks good. It is complete when the game, content, responsive layout, SEO and attribution all pass.

## Game Runtime

- [ ] Correct game entity was resolved
- [ ] Browser availability was confirmed
- [ ] Actual runtime URL is used
- [ ] Project detail page is not used as the runtime iframe
- [ ] Game loads inside the third-party page
- [ ] Mouse interaction works
- [ ] Keyboard interaction works when relevant
- [ ] Touch was tested if mobile play is claimed
- [ ] Fullscreen was tested when offered
- [ ] Reload works
- [ ] Official fallback link works
- [ ] Broken embed is never presented as playable

## Visual Design

- [ ] Palette was derived from the game
- [ ] Typography treatment matches the game mood
- [ ] Card/border treatment matches the game style
- [ ] Artwork is not stretched
- [ ] Site is not simply a recolored previous project
- [ ] Hero clearly identifies the game
- [ ] Player is visually prominent
- [ ] CTA labels match the game's tone without becoming misleading

## Content

- [ ] Game description is factually grounded
- [ ] Core loop is accurate
- [ ] Controls are verified
- [ ] Features are real
- [ ] Tips are actionable
- [ ] No fictional codes, characters, upgrades or modes
- [ ] FAQ answers match current official information
- [ ] Release/demo/prototype status is current

## SEO

- [ ] Unique page title
- [ ] Useful meta description
- [ ] One H1
- [ ] Logical heading hierarchy
- [ ] Canonical URL
- [ ] Open Graph metadata
- [ ] JSON-LD is accurate
- [ ] Internal links are valid
- [ ] Production sitemap exists
- [ ] Production robots.txt exists
- [ ] No accidental noindex

## Responsive

Test approximately:

- [ ] 1440px desktop
- [ ] 768px tablet
- [ ] 390px mobile

Verify:

- [ ] navigation does not overflow
- [ ] hero remains readable
- [ ] buttons are usable
- [ ] player height is sufficient
- [ ] screenshots do not break layout
- [ ] long game names wrap correctly
- [ ] touch targets are usable
- [ ] no horizontal scrolling

## Performance

- [ ] Website UI loads before the game payload
- [ ] Runtime is lazy-loaded when practical
- [ ] Site-owned images are compressed
- [ ] Screenshots below the fold are lazy-loaded when practical
- [ ] No unnecessary framework/library weight
- [ ] Layout does not shift badly when media loads

## Attribution / Disclosure

- [ ] Developer/creator is credited
- [ ] Official game page is linked
- [ ] Site does not falsely claim official status
- [ ] Third-party hosted game is described accurately
- [ ] Game binaries are not mirrored without authorization
- [ ] Production use considers creator/host terms

## Acceptance Result

Use one of:

```text
PASS — deployment-ready
PASS WITH NOTES — deployable, non-blocking caveats documented
FAIL — blocking issue remains
```

Any broken iframe is a `FAIL` for a play-first build.
