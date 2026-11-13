import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUuid } from './randomUuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUuid', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses crypto.randomUUID when the context has it', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555' as const);
    vi.stubGlobal('crypto', { randomUUID, getRandomValues: globalThis.crypto.getRandomValues });
    expect(randomUuid()).toBe('11111111-2222-4333-8444-555555555555');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('builds a version 4 UUID without crypto.randomUUID (plain HTTP from another device)', () => {
    const { crypto } = globalThis;
    vi.stubGlobal('crypto', {
      getRandomValues: <T extends ArrayBufferView>(array: T): T => crypto.getRandomValues(array),
    });
    const ids = Array.from({ length: 64 }, () => randomUuid());
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
