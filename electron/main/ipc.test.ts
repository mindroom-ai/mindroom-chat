import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_ORIGIN } from './bundleProtocol';

const ipcMainMock = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
}));

import { handle, isAuthorized } from './ipc';

const makeOwner = (frame: { url: string; origin: string }, destroyed = false) =>
  ({
    mainFrame: frame,
    isDestroyed: () => destroyed,
  } as unknown as Electron.WebContents);

describe('ipc', () => {
  afterEach(() => {
    ipcMainMock.handle.mockReset();
  });

  describe('isAuthorized', () => {
    it('authorizes the owner main frame on the app origin', () => {
      const frame = { url: `${APP_ORIGIN}/home`, origin: APP_ORIGIN };
      const owner = makeOwner(frame);
      expect(isAuthorized({ sender: owner, senderFrame: frame }, owner)).toBe(true);
    });

    it('rejects another window, subframe, null frame, other host, navigated frame, opaque origin, frame page and destroyed owner', () => {
      const mainFrame = { url: `${APP_ORIGIN}/home`, origin: APP_ORIGIN };
      const owner = makeOwner(mainFrame);
      const otherOwner = makeOwner({ url: `${APP_ORIGIN}/home`, origin: APP_ORIGIN });

      expect(isAuthorized({ sender: otherOwner, senderFrame: mainFrame }, owner)).toBe(false);
      expect(
        isAuthorized(
          { sender: owner, senderFrame: { url: `${APP_ORIGIN}/home`, origin: APP_ORIGIN } },
          owner
        )
      ).toBe(false);
      expect(isAuthorized({ sender: owner, senderFrame: null }, owner)).toBe(false);

      const otherHost = { url: 'https://example.org/', origin: 'https://example.org' };
      expect(
        isAuthorized({ sender: makeOwner(otherHost), senderFrame: otherHost }, makeOwner(otherHost))
      ).toBe(false);

      const otherCapacitorHost = {
        url: 'capacitor://evil.com/home',
        origin: 'capacitor://evil.com',
      };
      const otherHostOwner = makeOwner(otherCapacitorHost);
      expect(
        isAuthorized({ sender: otherHostOwner, senderFrame: otherCapacitorHost }, otherHostOwner)
      ).toBe(false);

      // Frame that navigated: owner now has a new mainFrame.
      const navigatedOwner = makeOwner({ url: `${APP_ORIGIN}/other`, origin: APP_ORIGIN });
      expect(isAuthorized({ sender: navigatedOwner, senderFrame: mainFrame }, navigatedOwner)).toBe(
        false
      );

      // Sandboxed or failed page: app URL, but origin is "null".
      const opaque = { url: `${APP_ORIGIN}/home`, origin: 'null' };
      const opaqueOwner = makeOwner(opaque);
      expect(isAuthorized({ sender: opaqueOwner, senderFrame: opaque }, opaqueOwner)).toBe(false);

      // Frame page spellings.
      for (const path of ['/pdf-frame.html', '/%70df-frame.html', '//pdf-frame.html?a=1']) {
        const framePage = { url: `${APP_ORIGIN}${path}`, origin: APP_ORIGIN };
        const frameOwner = makeOwner(framePage);
        expect(isAuthorized({ sender: frameOwner, senderFrame: framePage }, frameOwner), path).toBe(
          false
        );
      }

      const destroyedOwner = makeOwner(mainFrame, true);
      expect(isAuthorized({ sender: destroyedOwner, senderFrame: mainFrame }, destroyedOwner)).toBe(
        false
      );
    });
  });

  describe('handle', () => {
    it('answers FORBIDDEN, BAD_ARGUMENTS, ok value and never throws', async () => {
      const frame = { url: `${APP_ORIGIN}/home`, origin: APP_ORIGIN };
      const owner = makeOwner(frame);
      const run = vi.fn(async (n: number) => {
        if (n < 0) throw new Error('boom');
        return { ok: true as const, value: n * 2 };
      });
      const parse = vi.fn((args: unknown[]) => {
        if (args[0] === 'throw') throw new Error('parse boom');
        return typeof args[0] === 'number' ? args[0] : undefined;
      });

      handle('desktop:double', () => [owner], parse, run);
      expect(ipcMainMock.handle).toHaveBeenCalledWith('desktop:double', expect.any(Function));
      const listener = ipcMainMock.handle.mock.calls[0]?.[1] as (
        event: { sender: unknown; senderFrame: { url: string; origin: string } | null },
        ...args: unknown[]
      ) => Promise<unknown>;

      expect(await listener({ sender: owner, senderFrame: null }, 3)).toEqual({
        ok: false,
        code: 'FORBIDDEN',
      });
      expect(parse).not.toHaveBeenCalled();

      expect(await listener({ sender: owner, senderFrame: frame }, 'bad')).toEqual({
        ok: false,
        code: 'BAD_ARGUMENTS',
      });
      expect(await listener({ sender: owner, senderFrame: frame }, 'throw')).toEqual({
        ok: false,
        code: 'BAD_ARGUMENTS',
      });
      expect(run).not.toHaveBeenCalled();

      expect(await listener({ sender: owner, senderFrame: frame }, 21)).toEqual({
        ok: true,
        value: 42,
      });

      await expect(listener({ sender: owner, senderFrame: frame }, -1)).resolves.toEqual({
        ok: false,
        code: 'INTERNAL_ERROR',
      });
    });
  });
});
