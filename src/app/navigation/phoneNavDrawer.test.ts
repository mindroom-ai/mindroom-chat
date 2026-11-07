import { describe, expect, it } from 'vitest';
import { nextPhoneNavDrawerOpen } from './phoneNavDrawer';

describe('nextPhoneNavDrawerOpen', () => {
  it('opens on every arrival at a section root, also by a replace', () => {
    for (const action of ['PUSH', 'POP', 'REPLACE'] as const) {
      expect(nextPhoneNavDrawerOpen(false, true, action, false)).toBe(true);
      expect(nextPhoneNavDrawerOpen(true, true, action, false)).toBe(true);
    }
  });

  it('closes when the person moves on to another page', () => {
    for (const action of ['PUSH', 'POP'] as const) {
      expect(nextPhoneNavDrawerOpen(true, false, action, false)).toBe(false);
      expect(nextPhoneNavDrawerOpen(false, false, action, false)).toBe(false);
    }
  });

  it('stays as it was through an address clean-up elsewhere, such as an alias rewritten', () => {
    expect(nextPhoneNavDrawerOpen(true, false, 'REPLACE', false)).toBe(true);
    expect(nextPhoneNavDrawerOpen(false, false, 'REPLACE', false)).toBe(false);
  });

  it('closes when a section page it showed gives way, by a replace or on the spot', () => {
    expect(nextPhoneNavDrawerOpen(true, false, 'REPLACE', true)).toBe(false);
    expect(nextPhoneNavDrawerOpen(true, false, 'POP', true)).toBe(false);
    // A room's own clean-up replace keeps the drawer the person opened over it.
    expect(nextPhoneNavDrawerOpen(true, false, 'REPLACE', false)).toBe(true);
  });
});
