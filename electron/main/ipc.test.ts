import { afterEach, describe, expect, it, vi } from 'vitest';

const ipcMainMock = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
}));

import { APP_ORIGIN } from './bundleProtocol';
import { handle, isAuthorized, registerDebugModeHandler } from './ipc';

const makeOwner = (frame: { url: string; origin: string }, destroyed = false) =>
  ({
    mainFrame: frame,
    isDestroyed: () => destroyed,
  }) as unknown as Electron.WebContents;

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

      const navigatedOwner = makeOwner({ url: `${APP_ORIGIN}/other`, origin: APP_ORIGIN });
      expect(isAuthorized({ sender: navigatedOwner, senderFrame: mainFrame }, navigatedOwner)).toBe(
        false
      );

      const opaque = { url: `${APP_ORIGIN}/home`, origin: 'null' };
      const opaqueOwner = makeOwner(opaque);
      expect(isAuthorized({ sender: opaqueOwner, senderFrame: opaque }, opaqueOwner)).toBe(false);

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

    it('returns FORBIDDEN when owners() throws', async () => {
      const frame = { url: `${APP_ORIGIN}/home`, origin: APP_ORIGIN };
      const owner = makeOwner(frame);
      const parse = vi.fn(() => 1);
      const run = vi.fn(async () => ({ ok: true as const, value: 1 }));

      handle(
        'desktop:broken-owners',
        () => {
          throw new Error('owners boom');
        },
        parse,
        run
      );
      const listener = ipcMainMock.handle.mock.calls[0]?.[1] as (
        event: { sender: unknown; senderFrame: { url: string; origin: string } | null },
        ...args: unknown[]
      ) => Promise<unknown>;

      await expect(listener({ sender: owner, senderFrame: frame })).resolves.toEqual({
        ok: false,
        code: 'FORBIDDEN',
      });
      expect(parse).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe('registerDebugModeHandler', () => {
    it('accepts booleans from authorized owners and rejects bad args or other windows', async () => {
      const frame = { url: `${APP_ORIGIN}/home`, origin: APP_ORIGIN };
      const owner = makeOwner(frame);
      const other = makeOwner({ url: `${APP_ORIGIN}/quick-capture/`, origin: APP_ORIGIN });
      const onChange = vi.fn();

      registerDebugModeHandler(() => [owner], onChange);
      expect(ipcMainMock.handle).toHaveBeenCalledWith(
        'desktop:set-debug-mode',
        expect.any(Function)
      );
      const listener = ipcMainMock.handle.mock.calls[0]?.[1] as (
        event: { sender: unknown; senderFrame: { url: string; origin: string } | null },
        ...args: unknown[]
      ) => Promise<unknown>;

      expect(await listener({ sender: other, senderFrame: other.mainFrame }, true)).toEqual({
        ok: false,
        code: 'FORBIDDEN',
      });
      expect(await listener({ sender: owner, senderFrame: frame }, 'yes')).toEqual({
        ok: false,
        code: 'BAD_ARGUMENTS',
      });
      expect(await listener({ sender: owner, senderFrame: frame }, true, false)).toEqual({
        ok: false,
        code: 'BAD_ARGUMENTS',
      });
      expect(onChange).not.toHaveBeenCalled();

      expect(await listener({ sender: owner, senderFrame: frame }, true)).toEqual({
        ok: true,
        value: undefined,
      });
      expect(await listener({ sender: owner, senderFrame: frame }, false)).toEqual({
        ok: true,
        value: undefined,
      });
      expect(onChange.mock.calls).toEqual([[true], [false]]);
    });
  });
});
