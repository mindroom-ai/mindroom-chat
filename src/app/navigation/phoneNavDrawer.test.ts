import { describe, expect, it } from 'vitest';
import { nextPhoneNavDrawerOpen } from './phoneNavDrawer';

describe('nextPhoneNavDrawerOpen', () => {
  it('opens on every arrival at a section root, also by a replace', () => {
    for (const action of ['PUSH', 'POP', 'REPLACE'] as const) {
      expect(nextPhoneNavDrawerOpen(false, true, action)).toBe(true);
      expect(nextPhoneNavDrawerOpen(true, true, action)).toBe(true);
    }
  });

  it('closes when the person moves on to another page', () => {
    for (const action of ['PUSH', 'POP'] as const) {
      expect(nextPhoneNavDrawerOpen(true, false, action)).toBe(false);
      expect(nextPhoneNavDrawerOpen(false, false, action)).toBe(false);
    }
  });

  it('stays as it was through an address clean-up elsewhere, such as an alias rewritten', () => {
    expect(nextPhoneNavDrawerOpen(true, false, 'REPLACE')).toBe(true);
    expect(nextPhoneNavDrawerOpen(false, false, 'REPLACE')).toBe(false);
  });
});
