import { ipcMain } from 'electron';
import { APP_ORIGIN, isAllowedAppPage } from './bundleProtocol';

import type { DesktopResult } from '../../src/app/lib/desktopBridge';

export type Result<T> = DesktopResult<T>;

export const isAuthorized = (
  event: { sender: unknown; senderFrame: { url: string; origin: string } | null },
  owner: Electron.WebContents
): boolean => {
  if (event.sender !== owner || owner.isDestroyed()) return false;
  const frame = event.senderFrame;
  return (
    frame !== null &&
    frame === owner.mainFrame &&
    frame.origin === APP_ORIGIN &&
    isAllowedAppPage(frame.url)
  );
};

export const handle = <A, T>(
  channel: string,
  owners: () => readonly Electron.WebContents[],
  parse: (args: unknown[]) => A | undefined,
  run: (args: A, sender: Electron.WebContents) => Promise<Result<T>>
): void => {
  ipcMain.handle(channel, async (event, ...args): Promise<Result<T>> => {
    let candidates: readonly Electron.WebContents[];
    try {
      candidates = owners();
    } catch {
      return { ok: false, code: 'FORBIDDEN' };
    }
    const owner = candidates.find((candidate) => isAuthorized(event, candidate));
    if (!owner) return { ok: false, code: 'FORBIDDEN' };
    let parsed: A | undefined;
    try {
      parsed = parse(args);
    } catch {
      return { ok: false, code: 'BAD_ARGUMENTS' };
    }
    if (parsed === undefined) return { ok: false, code: 'BAD_ARGUMENTS' };
    try {
      return await run(parsed, owner);
    } catch {
      return { ok: false, code: 'INTERNAL_ERROR' };
    }
  });
};
