import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
  mergeMindroomAccountSettings,
  sanitizeMindroomAccountSettings,
} from './accountSettings';

const SIDEBAR_SWITCHES = [
  'showThreadsInSidebar',
  'showExploreInSidebar',
  'showCreateSpaceInSidebar',
  'showSearchInSidebar',
  'showLocalMindroomInSidebar',
] as const;

describe('sidebar button switches in io.mindroom.settings', () => {
  it.each(SIDEBAR_SWITCHES)('shows %s by default and keeps a stored boolean', (key) => {
    expect(DEFAULT_MINDROOM_ACCOUNT_SETTINGS[key]).toBe(true);
    expect(sanitizeMindroomAccountSettings({})[key]).toBe(true);
    expect(sanitizeMindroomAccountSettings({ [key]: false })[key]).toBe(false);
    expect(sanitizeMindroomAccountSettings({ [key]: 'off' })[key]).toBe(true);
  });

  it('turns one button off without touching the others or keys it does not know', () => {
    const stored = { showSearchInSidebar: true, futureKey: [1] };
    const next = mergeMindroomAccountSettings(stored, { showThreadsInSidebar: false });
    expect(next).toEqual({
      showSearchInSidebar: true,
      futureKey: [1],
      showThreadsInSidebar: false,
    });
    expect(sanitizeMindroomAccountSettings(next)).toEqual({
      ...DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
      showThreadsInSidebar: false,
    });
  });
});
