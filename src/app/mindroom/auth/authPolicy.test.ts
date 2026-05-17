import { describe, expect, it } from 'vitest';
import {
  isMindroomHomeserver,
  normalizeHomeserverName,
  shouldDisablePasswordLogin,
  shouldUseSsoOnlyRegistration,
} from './authPolicy';

describe('MindRoom auth policy', () => {
  it('normalizes server names before matching the hosted homeserver', () => {
    expect(normalizeHomeserverName('https://mindroom.chat/')).toBe('mindroom.chat');
    expect(normalizeHomeserverName('HTTP://MINDROOM.CHAT///')).toBe('mindroom.chat');
    expect(isMindroomHomeserver('https://mindroom.chat/')).toBe(true);
    expect(isMindroomHomeserver('https://123.matrix.mindroom.chat/')).toBe(true);
    expect(isMindroomHomeserver('123.matrix.mindroom.chat')).toBe(true);
    expect(isMindroomHomeserver('matrix.org')).toBe(false);
  });

  it('forces the hosted homeserver onto SSO-only auth', () => {
    expect(shouldDisablePasswordLogin('mindroom.chat', undefined)).toBe(true);
    expect(shouldDisablePasswordLogin('https://123.matrix.mindroom.chat', undefined)).toBe(true);
    expect(shouldDisablePasswordLogin('matrix.org', { disablePasswordLogin: true })).toBe(true);
    expect(shouldDisablePasswordLogin('matrix.org', undefined)).toBe(false);
    expect(shouldUseSsoOnlyRegistration('https://mindroom.chat')).toBe(true);
    expect(shouldUseSsoOnlyRegistration('https://123.matrix.mindroom.chat')).toBe(true);
    expect(shouldUseSsoOnlyRegistration('https://matrix.org')).toBe(false);
  });
});
