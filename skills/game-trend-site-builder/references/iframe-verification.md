# Iframe Verification Guide

This is the main technical gate for a play-first game site.

## Do not embed the project detail page

Wrong:

```html
<iframe src="https://developer.itch.io/game-name"></iframe>
```

That URL is a project page, not the browser game runtime.

## Confirm browser availability

Look for current official signals such as:

- `Run game`
- `Play in browser`
- `HTML5`
- a visible embedded player

If none exist, do not assume a browser build exists.

## Locate the actual runtime iframe

Typical itch-hosted runtime URLs may resemble:

```text
https://html-classic.itch.zone/html/<id>/index.html?v=<version>
https://html-classic.itch.zone/html/<id>/web/index.html?v=<version>
```

Possible ways to locate it:

1. inspect the rendered iframe element
2. inspect page source
3. inspect browser network requests
4. inspect official developer comments or devlogs when they expose the runtime URL

Important: text-extraction tools may omit iframe `src` attributes. If the official page clearly runs an HTML5 game, missing parsed text is not proof that no runtime exists.

## Validate in isolation

Create the smallest possible third-party test page:

```html
<!doctype html>
<html>
<body style="margin:0">
<iframe
  src="REAL_RUNTIME_URL"
  style="width:100vw;height:100vh;border:0"
  allow="autoplay; fullscreen *; gamepad"
  allowfullscreen>
</iframe>
</body>
</html>
```

Check:

- initial load
- game boot
- mouse input
- keyboard input
- touch input if mobile support is claimed
- fullscreen
- reload
- navigation behavior

## Detect hard blockers

Common blockers include frame policy headers, host checks inside the game, runtime asset failures, or browser security restrictions.

If blocked, report `embed unsupported`.

Do not show a fake loading panel and claim the site is playable.

## Keep the runtime configurable

A developer may upload a new web build and change the runtime ID.

Keep the URL in one configuration location:

```js
const GAME = {
  runtimeUrl: "https://html-classic.itch.zone/html/..."
};
```

Do not repeat the runtime URL throughout the project.

## Production disclosure

When embedding a third-party hosted build:

- credit the creator
- link to the official page
- state unofficial/discovery/guide status where appropriate
- do not imply the game files are hosted by your site
- check creator/host terms before production monetization
