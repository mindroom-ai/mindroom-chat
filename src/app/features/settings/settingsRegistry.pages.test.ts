import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SETTINGS, SIDEBAR_SWITCH_SETTINGS, type SettingsPageId } from './settingsRegistry';

const APP = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string) => readFileSync(join(APP, path), 'utf8');

/** The source files each page is built from: its own component and the parts it shows. */
const PAGE_FILES: Record<Exclude<SettingsPageId, 'sidebar'>, string[]> = {
  account: [
    'features/settings/account/Account.tsx',
    'features/settings/account/Profile.tsx',
    'features/settings/account/ContactInfo.tsx',
    'features/settings/account/AccountDeactivation.tsx',
  ],
  notifications: [
    'features/settings/notifications/Notifications.tsx',
    'features/settings/notifications/SystemNotification.tsx',
    'features/settings/notifications/PushRuleSettings.tsx',
    'mindroom/native/IOSPushNotification.tsx',
  ],
  privacy: [
    'features/settings/privacy/PrivacySecurity.tsx',
    'features/settings/account/BlockedUsers.tsx',
    'features/settings/devices/Devices.tsx',
    'features/settings/devices/SecuritySettings.tsx',
    'features/settings/devices/KeyBackupTile.tsx',
    'features/settings/devices/LocalKeyBackup.tsx',
  ],
  appearance: ['features/settings/appearance/Appearance.tsx'],
  chats: [
    'features/settings/chats/Chats.tsx',
    'features/settings/emojis-stickers/UserPack.tsx',
    'features/settings/emojis-stickers/GlobalPacks.tsx',
    'features/settings/emojis-stickers/ServerPack.tsx',
  ],
  language: [
    'features/settings/language/LanguageRegion.tsx',
    'features/settings/language/DateFormatSetting.tsx',
  ],
  connections: [
    'mindroom/settings/AgentSettingsPages.tsx',
    'mindroom/settings/MindroomConnectionsSettings.tsx',
  ],
  computers: [
    'mindroom/settings/AgentSettingsPages.tsx',
    'mindroom/settings/MindroomComputerSettings.tsx',
  ],
  'mindroom.local-mindroom': ['mindroom/local-mindroom/LocalMindroom.tsx'],
  'archived-rooms': ['mindroom/rooms/ArchivedRoomsPage.tsx'],
  storage: [
    'features/settings/storage/StorageOffline.tsx',
    'mindroom/settings/MindroomPrefetchSettings.tsx',
  ],
  'developer-tools': ['features/settings/developer-tools/DeveloperTools.tsx'],
  about: ['features/settings/about/About.tsx'],
};

/** The files `path` imports from this repository, resolved as the bundler does. */
const imports = (path: string): string[] =>
  [...read(path).matchAll(/from '(\.[^']+)'/g)].flatMap(([, target = '']) => {
    const base = relative(APP, join(APP, path, '..', target));
    const found = ['.tsx', '.ts', '/index.ts', '/index.tsx'].map((ending) => `${base}${ending}`);
    return found.filter((file) => existsSync(join(APP, file))).slice(0, 1);
  });

const sourceFiles = (dir: string): string[] =>
  readdirSync(join(APP, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(APP, path)).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.includes('.test.') ? [path] : [];
  });

describe('every registry setting has a page that renders it', () => {
  it.each(SETTINGS.filter((setting) => setting.page !== 'sidebar').map((s) => [s.id, s.page]))(
    '%s is a tile on %s',
    (id, page) => {
      const files = PAGE_FILES[page as Exclude<SettingsPageId, 'sidebar'>];
      const quoted = new RegExp(`['"]${id}['"]`);
      expect(
        files.some((file) => quoted.test(read(file))),
        `${id} on ${page}`
      ).toBe(true);
    }
  );

  it('builds each page from the files listed for it', () => {
    Object.values(PAGE_FILES).forEach(([page = '', ...parts]) => {
      // Every file the page component reaches through its imports, however deep.
      const reached = new Set([page]);
      reached.forEach((file) => imports(file).forEach((target) => reached.add(target)));
      parts.forEach((part) => expect(reached.has(part), `${page} shows ${part}`).toBe(true));
    });
  });

  it('gives each sidebar switch its setting', () => {
    const sidebarIds = SETTINGS.filter((setting) => setting.page === 'sidebar').map((s) => s.id);
    expect(sidebarIds.sort()).toEqual(Object.values(SIDEBAR_SWITCH_SETTINGS).sort());
    expect(read('mindroom/settings/MindroomInterfaceSettings.tsx')).toContain(
      'focusId={SIDEBAR_SWITCH_SETTINGS[button]}'
    );
    expect(imports('features/settings/sidebar/Sidebar.tsx')).toContain(
      'mindroom/settings/MindroomInterfaceSettings.tsx'
    );
  });

  it('uses no focus id the registry does not list', () => {
    const known = new Set<string>(SETTINGS.map((setting) => setting.id));
    const used = sourceFiles('.').flatMap((file) =>
      [...read(file).matchAll(/focusId(?:=|: )['"](\w+)['"]/g)].map(([, id = '']) => id)
    );
    expect(used.length).toBeGreaterThan(40);
    expect(used.filter((id) => !known.has(id))).toEqual([]);
  });
});
