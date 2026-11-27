import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
  mergeAccountSettings,
  sanitizeAccountSettings,
} from './accountSettings';

const SIDEBAR_SWITCHES = [
  'showThreadsInSidebar',
  'showCanvasesInSidebar',
  'showUsageInSidebar',
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

  it('shows showDirectInSidebar by default and keeps a stored boolean', () => {
    expect(DEFAULT_MINDROOM_ACCOUNT_SETTINGS.showDirectInSidebar).toBe(true);
    expect(sanitizeAccountSettings({}).showDirectInSidebar).toBe(true);
    expect(sanitizeAccountSettings({ showDirectInSidebar: false }).showDirectInSidebar).toBe(false);
    expect(sanitizeAccountSettings({ showDirectInSidebar: true }).showDirectInSidebar).toBe(true);
    expect(sanitizeAccountSettings({ showDirectInSidebar: 'off' }).showDirectInSidebar).toBe(true);
  });

  it('shows showHelpInSidebar by default and keeps a stored boolean', () => {
    expect(DEFAULT_MINDROOM_ACCOUNT_SETTINGS.showHelpInSidebar).toBe(true);
    expect(sanitizeAccountSettings({}).showHelpInSidebar).toBe(true);
    expect(sanitizeAccountSettings({ showHelpInSidebar: false }).showHelpInSidebar).toBe(false);
    expect(sanitizeAccountSettings({ showHelpInSidebar: true }).showHelpInSidebar).toBe(true);
    expect(sanitizeAccountSettings({ showHelpInSidebar: 'off' }).showHelpInSidebar).toBe(true);
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
