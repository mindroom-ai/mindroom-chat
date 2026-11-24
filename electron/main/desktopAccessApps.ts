import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InstalledMacApp } from '../../src/app/lib/desktopBridge';

export const MINDROOM_APP_IDS: ReadonlySet<string> = new Set([
  'chat.mindroom.menubar',
  'chat.mindroom.desktophelper',
  'chat.mindroom.app',
  'chat.mindroom.app.helper',
  'chat.mindroom.app.helper.Renderer',
  'chat.mindroom.app.helper.GPU',
  'chat.mindroom.app.helper.Plugin',
]);

const nonEmptyText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const readPlistJson = (plistPath: string): Promise<Record<string, unknown> | undefined> =>
  new Promise((resolve) => {
    execFile(
      'plutil',
      ['-convert', 'json', '-o', '-', plistPath],
      { encoding: 'utf8', timeout: 2_000, maxBuffer: 512 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        try {
          const parsed: unknown = JSON.parse(stdout);
          resolve(
            typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : undefined
          );
        } catch {
          resolve(undefined);
        }
      }
    );
  });

export const scanInstalledMacApps = async (
  appDirs: readonly string[] = [
    '/Applications',
    '/System/Applications',
    path.join(os.homedir(), 'Applications'),
  ]
): Promise<InstalledMacApp[]> => {
  const candidates: string[] = [];
  for (const dir of appDirs) {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.endsWith('.app')) candidates.push(path.join(dir, entry.name));
    }
  }
  const found: InstalledMacApp[] = [];
  const batchSize = 8;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const results = await Promise.all(
      candidates
        .slice(i, i + batchSize)
        .map(async (appPath): Promise<InstalledMacApp | undefined> => {
          const plist = await readPlistJson(path.join(appPath, 'Contents', 'Info.plist'));
          if (!plist) return undefined;
          const bundleId = nonEmptyText(plist.CFBundleIdentifier);
          if (!bundleId || MINDROOM_APP_IDS.has(bundleId)) return undefined;
          const name =
            nonEmptyText(plist.CFBundleDisplayName) ??
            nonEmptyText(plist.CFBundleName) ??
            path.basename(appPath, '.app');
          return { bundleId, name, path: appPath };
        })
    );
    for (const app of results) {
      if (app) found.push(app);
    }
  }
  return found;
};

export const normalizeInstalledApps = (apps: readonly InstalledMacApp[]): InstalledMacApp[] => {
  const byId = new Map<string, InstalledMacApp>();
  for (const app of apps) {
    if (!app.bundleId || MINDROOM_APP_IDS.has(app.bundleId) || byId.has(app.bundleId)) continue;
    byId.set(app.bundleId, app);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
};
