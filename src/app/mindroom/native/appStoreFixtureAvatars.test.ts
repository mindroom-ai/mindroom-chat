import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// scripts/seed-appstore-screenshot-room.mjs gives Sam Rivera and the three agents these avatars;
// e2e/app-store-screenshots.spec.ts refuses a capture until every one of them has loaded.
const avatarDir = fileURLToPath(
  new URL('../../../../scripts/fixtures/appstore/avatars/', import.meta.url)
);

describe('App Store fixture avatars', () => {
  it.each(['sam', 'hearth', 'pantry', 'atlas'])('%s.png is a 256 px square PNG', (name) => {
    const header = readFileSync(join(avatarDir, `${name}.png`)).subarray(0, 24);
    expect(header.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect([header.readUInt32BE(16), header.readUInt32BE(20)]).toEqual([256, 256]);
  });
});
