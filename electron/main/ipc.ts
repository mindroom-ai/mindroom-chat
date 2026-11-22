import { ipcMain } from 'electron';
import { APP_ORIGIN, isFramePage, parseAppUrl } from './bundleProtocol';

export type Result<T> = { ok: true; value: T } | { ok: false; code: string };

export const isAuthorized = (
  event: { sender: unknown; senderFrame: { url: string; origin: string } | null },
  owner: Electron.WebContents
): boolean => {
  if (event.sender !== owner || (typeof owner.isDestroyed === 'function' && owner.isDestroyed())) {
    return false;
  }
  const frame = event.senderFrame;
  if (!frame || frame !== owner.mainFrame || frame.origin !== APP_ORIGIN) return false;
  const parsed = parseAppUrl(frame.url);
  return parsed !== undefined && !isFramePage(parsed.pathname);
};

export const handle = <A, T>(
  channel: string,
  owners: () => readonly Electron.WebContents[],
  parse: (args: unknown[]) => A | undefined,
  run: (args: A, sender: Electron.WebContents) => Promise<Result<T>>
): void => {
  ipcMain.handle(channel, async (event, ...args): Promise<Result<T>> => {
    const owner = owners().find((candidate) => isAuthorized(event, candidate));
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
