import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from './sha256';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sha256', () => {
  it('matches the platform digest without crypto.subtle, across block boundaries', async () => {
    vi.stubGlobal('crypto', {});
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 128, 300]) {
      const data = new Uint8Array(length).map((_, index) => (index * 31 + length) % 256);
      // eslint-disable-next-line no-await-in-loop -- one digest at a time keeps a failure readable
      const digest = Buffer.from(await sha256(data)).toString('hex');
      expect(digest).toBe(createHash('sha256').update(data).digest('hex'));
    }
  });

  it('uses crypto.subtle where the platform has it', async () => {
    const data = new TextEncoder().encode('abc');
    expect(Buffer.from(await sha256(data)).toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});
