import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
  mergeAccountSettings,
  sanitizeAccountSettings,
} from './accountSettings';

const SIDEBAR_SWITCHES = [
  'showThreadsInSidebar',
  'showCanvasesInSidebar',
  'showExploreInSidebar',
  'showCreateSpaceInSidebar',
  'showSearchInSidebar',
  'showLocalMindroomInSidebar',
] as const;

describe('sidebar button switches in io.mindroom.settings', () => {
  it.each(SIDEBAR_SWITCHES)('hides %s by default and keeps a stored boolean', (key) => {
    expect(DEFAULT_MINDROOM_ACCOUNT_SETTINGS[key]).toBe(false);
    expect(sanitizeAccountSettings({})[key]).toBe(false);
    expect(sanitizeAccountSettings({ [key]: true })[key]).toBe(true);
    expect(sanitizeAccountSettings({ [key]: false })[key]).toBe(false);
    expect(sanitizeAccountSettings({ [key]: 'on' })[key]).toBe(false);
  });

  it('turns one button on without touching the others or keys it does not know', () => {
    const stored = { showSearchInSidebar: false, futureKey: [1] };
    const next = mergeAccountSettings(stored, { showThreadsInSidebar: true });
    expect(next).toEqual({
      showSearchInSidebar: false,
      futureKey: [1],
      showThreadsInSidebar: true,
    });
    expect(sanitizeAccountSettings(next)).toEqual({
      ...DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
      showThreadsInSidebar: true,
    });
  });
});
