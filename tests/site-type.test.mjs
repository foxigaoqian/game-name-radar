import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySiteType, sourcePlatformKey } from '../lib/site-type.mjs';

test('classifies browser portal games as online opportunities', () => {
  const result = classifySiteType({
    sources: [
      { sourceId: 'y8-new', kind: 'y8-new', url: 'https://www.y8.com/games/example' },
      { sourceId: 'gamepix-new', kind: 'gamepix-new', url: 'https://www.gamepix.com/play/example' },
    ],
  });
  assert.equal(result.type, 'online');
  assert.equal(result.browserPlayable, true);
  assert.equal(result.confidence, 'high');
  assert.equal(result.onlinePlatformCount, 2);
});

test('counts multiple feeds from one portal as one platform', () => {
  const result = classifySiteType({
    sources: [
      { sourceId: 'itch-newest-web', kind: 'itch-popular', url: 'https://example.itch.io/game' },
      { sourceId: 'itch-new-popular-web', kind: 'itch-popular', url: 'https://example.itch.io/game' },
    ],
  });
  assert.equal(result.type, 'online');
  assert.equal(result.onlineSourceCount, 2);
  assert.equal(result.onlinePlatformCount, 1);
  assert.equal(sourcePlatformKey(result.sources?.[0] || { sourceId: 'itch-newest-web' }), 'itch.io');
});

test('classifies Steam-only rising games as wiki opportunities', () => {
  const result = classifySiteType({
    sources: [
      { sourceId: 'steam-popular-new', kind: 'steam-popular-new', url: 'https://store.steampowered.com/app/3722330/Shift_At_Midnight/' },
      { sourceId: 'itch-new-feed', kind: 'itch-new', url: 'https://example.itch.io/shift-at-midnight' },
    ],
    youtube: { videoCount: 14 },
  });
  assert.equal(result.type, 'wiki');
  assert.equal(result.browserPlayable, false);
  assert.equal(result.iframeLikely, false);
});

test('leaves generic itch feed entries pending without playability proof', () => {
  const result = classifySiteType({
    sources: [{ sourceId: 'itch-new-feed', kind: 'itch-new', url: 'https://example.itch.io/unknown' }],
  });
  assert.equal(result.type, 'pending');
});
