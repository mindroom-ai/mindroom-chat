import { describe, expect, it } from 'vitest';
import { SettingsPages } from '../../features/settings/settingsPages';
import { getLocalMindroomSettingsMenuItem } from './settingsMenu';

describe('getLocalMindroomSettingsMenuItem', () => {
  it('owns the Local MindRoom settings menu entry', () => {
    expect(getLocalMindroomSettingsMenuItem()).toMatchObject({
      page: SettingsPages.LocalMindroomPage,
      name: 'Local MindRoom',
    });
  });
});
