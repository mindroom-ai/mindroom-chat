import { expect, it } from 'vitest';
import {
  accountStorageKeyPrefixes,
  accountStorageKeys,
  pluginPanelWidthStorageKey,
} from './accountStorageKeys';

// Browsers keep what earlier versions wrote under these names; a change would lose it.
it('builds the keys under the names the app has always used', () => {
  expect(accountStorageKeys('@alice:example.org')).toEqual([
    'mindroom.sidebar.spaceOrder:@alice:example.org',
    'mindroom.pageNav.desktopCollapsed:@alice:example.org',
    'mindroom_welcome_setup_first_seen_at::@alice:example.org',
    'mindroom.pageNav.width:@alice:example.org',
    'mindroom.members.width:@alice:example.org',
    'mindroom.canvas.width:@alice:example.org',
    'mindroom.call.width:@alice:example.org',
    'mindroom.computer.width:@alice:example.org',
    'mindroom.callTranscript.width:@alice:example.org',
  ]);
  expect(pluginPanelWidthStorageKey('@alice:example.org', 'notes/list')).toBe(
    'mindroom.panel.width:@alice:example.org:notes/list'
  );
  expect(accountStorageKeyPrefixes('@alice:example.org')).toEqual([
    'mindroom.panel.width:@alice:example.org:',
    'roamingSettingsPending:@alice:example.org:',
  ]);
});
