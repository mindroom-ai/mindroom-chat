import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SETTINGS, SIDEBAR_SWITCH_SETTINGS, type SettingsPageId } from './settingsRegistry';

const APP = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFileSync(join(APP, path), 'utf8');

/** The source files each page is built from: its own component and the parts it shows. */
const PAGE_FILES: Record<Exclude<SettingsPageId, 'sidebar'>, string[]> = {
  account: [
    'account/settings/Account.tsx',
    'account/settings/Profile.tsx',
    'account/settings/ContactInfo.tsx',
    'account/settings/AccountDeactivation.tsx',
  ],
  notifications: [
    'notifications/settings/Notifications.tsx',
    'notifications/settings/SystemNotification.tsx',
    'notifications/settings/PushRuleSettings.tsx',
    'notifications/push/IOSPushNotification.tsx',
  ],
  privacy: [
    'settings/pages/PrivacySecurity.tsx',
    'account/settings/BlockedUsers.tsx',
    'account/devices/Devices.tsx',
    'account/devices/SecuritySettings.tsx',
    'account/devices/RecoveryPasswordTile.tsx',
    'account/devices/KeyBackupTile.tsx',
    'account/devices/LocalKeyBackup.tsx',
  ],
  appearance: ['settings/pages/Appearance.tsx'],
  chats: [
    'settings/pages/Chats.tsx',
    'emoji/settings/UserPack.tsx',
    'emoji/settings/GlobalPacks.tsx',
    'emoji/settings/ServerPack.tsx',
  ],
  language: [
    'settings/pages/LanguageRegion.tsx',
    'settings/pages/DateFormatSetting.tsx',
  ],
  connections: [
    'settings/pages/AgentSettingsPages.tsx',
    'connections/ConnectionsSettings.tsx',
  ],
  computers: [
    'settings/pages/AgentSettingsPages.tsx',
    'computer/ComputerSettings.tsx',
  ],
  'mindroom.local-mindroom': ['local-mindroom/LocalMindroom.tsx'],
  'archived-rooms': ['rooms/archive/ArchivedRoomsPage.tsx'],
  'server-accounts': ['server-admin/ServerAccounts.tsx', 'server-admin/ServerAccountDetail.tsx'],
  storage: [
    'settings/pages/StorageOffline.tsx',
    'settings/pages/PrefetchSettings.tsx',
  ],
  'developer-tools': ['settings/pages/DeveloperTools.tsx'],
  about: ['settings/pages/About.tsx'],
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
    expect(read('settings/pages/AgentInterfaceSettings.tsx')).toContain(
      'focusId={SIDEBAR_SWITCH_SETTINGS[button]}'
    );
    expect(imports('settings/pages/InterfaceSettings.tsx')).toContain(
      'settings/pages/AgentInterfaceSettings.tsx'
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
