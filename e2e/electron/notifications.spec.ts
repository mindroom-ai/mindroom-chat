import crypto from 'node:crypto';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { logoutActiveAccount } from '../helpers/accounts';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { DISPOSABLE_HOMESERVER } from '../helpers/disposableAccounts';
import {
  assertNoUnexpectedViolations,
  launchDesktop,
  type DesktopSession,
} from '../helpers/electronApp';
import {
  joinRoom,
  loginToMatrix,
  matrixFetch,
  sendRoomMessage,
  sendStateEvent,
  type MatrixSession,
} from '../helpers/matrix';

const APP_ORIGIN = 'capacitor://localhost';
const QC_URL = `${APP_ORIGIN}/quick-capture/`;

type RecordedNote = { title: string; body?: string; tag?: string };
type TestUser = MatrixSession & { username: string; password: string };

const lastBadgeCount = (app: ElectronApplication): Promise<number | undefined> =>
  app.evaluate(() => {
    const counts =
      (globalThis as { __mindroomTestTelemetry?: { badgeCounts: number[] } })
        .__mindroomTestTelemetry?.badgeCounts ?? [];
    return counts[counts.length - 1];
  });

const dockBadge = (app: ElectronApplication): Promise<string> =>
  app.evaluate(({ app: electronApp }) => electronApp.dock?.getBadge() ?? '');

const mainWindowVisible = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(
      (w) => !w.webContents.getURL().includes('/quick-capture')
    );
    return win ? win.isVisible() : false;
  });

const hideMainWindow = async (app: ElectronApplication): Promise<void> => {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(
      (w) => !w.webContents.getURL().includes('/quick-capture')
    );
    if (!win) throw new Error('Main window missing');
    if (process.platform === 'darwin') win.close();
    else win.hide();
  });
  await expect.poll(() => mainWindowVisible(app)).toBe(false);
};

const openQuickCapture = async (session: DesktopSession): Promise<Page> => {
  const winPromise = session.app.waitForEvent('window');
  await session.app.evaluate(() => {
    (
      globalThis as { __mindroomTestQuickCapture?: { toggle: () => void } }
    ).__mindroomTestQuickCapture?.toggle();
  });
  const panelPage = await winPromise;
  await session.watchPage(panelPage);
  await panelPage.waitForURL(QC_URL);
  await panelPage.waitForLoadState('domcontentloaded');
  return panelPage;
};

const installNotificationRecorder = async (page: Page): Promise<void> => {
  const install = (): void => {
    type Entry = RecordedNote & { onclick: (() => void) | null };
    const win = window as unknown as {
      __p9Notes?: Entry[];
      __p9ClickNote?: (index: number) => void;
    };
    if (win.__p9Notes) return;
    const notes: Entry[] = [];
    win.__p9Notes = notes;
    win.__p9ClickNote = (index: number) => notes[index]?.onclick?.();
    class RecordingNotification {
      static permission = 'granted';

      static requestPermission = async () => 'granted';

      onclick: (() => void) | null = null;

      constructor(title: string, options: NotificationOptions = {}) {
        const entry: Entry = { title, body: options.body, tag: options.tag, onclick: null };
        notes.push(entry);
        Object.defineProperty(this, 'onclick', {
          get: () => entry.onclick,
          set: (handler: (() => void) | null) => {
            entry.onclick = handler;
          },
        });
      }

      close() {
        return undefined;
      }
    }
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: RecordingNotification,
    });
  };
  await page.addInitScript(install);
  await page.evaluate(install);
};

const recordedNotes = (page: Page): Promise<RecordedNote[]> =>
  page.evaluate(() =>
    ((window as unknown as { __p9Notes?: RecordedNote[] }).__p9Notes ?? []).map(
      ({ title, body, tag }) => ({ title, body, tag })
    )
  );

const clickNote = (page: Page, index: number): Promise<void> =>
  page.evaluate(
    (i) => (window as unknown as { __p9ClickNote?: (n: number) => void }).__p9ClickNote?.(i),
    index
  );

const registerAccount = async (homeserver: string, prefix: string): Promise<TestUser> => {
  const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const username = `${prefix}_${suffix}`;
  const password = `Pass_${crypto.randomBytes(8).toString('hex')}`;
  const reg = await fetch(`${homeserver}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(reg.ok, `registering ${username}`).toBe(true);
  return { ...(await loginToMatrix(homeserver, username, password)), username, password };
};

const threadMention = (rootId: string, userId: string, text: string) => ({
  msgtype: 'm.text',
  body: `${userId} ${text}`,
  'm.mentions': { user_ids: [userId] },
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

const setupRooms = async (homeserver: string, prefix: string) => {
  const reader = await registerAccount(homeserver, `${prefix}_r`);
  const writer = await registerAccount(homeserver, `${prefix}_w`);
  const quietId = await createRoom(homeserver, reader.accessToken, {
    name: `${prefix} Quiet`,
    invite: [writer.userId],
  });
  const busyId = await createRoom(homeserver, reader.accessToken, {
    name: `${prefix} Busy`,
    invite: [writer.userId],
  });
  await joinRoom(homeserver, writer.accessToken, quietId);
  await joinRoom(homeserver, writer.accessToken, busyId);
  const rootId = await sendRoomMessage(homeserver, writer.accessToken, busyId, {
    msgtype: 'm.text',
    body: 'Thread root',
  });
  return { reader, writer, quietId, busyId, rootId };
};

test.afterEach(assertNoUnexpectedViolations);

test('desktop:set-badge sets, clamps >99, clears, and rejects Quick Capture and bad args', async () => {
  const session = await launchDesktop({ offline: true });
  try {
    const { app, page } = session;
    await expect(page.locator('input[name="serverInput"]')).toBeVisible();

    for (const [count, expectedDock] of [
      [3, '3'],
      [120, '99+'],
      [0, ''],
    ] as const) {
      await page.evaluate((n) => window.mindroomDesktop?.setBadge(n), count);
      await expect.poll(() => lastBadgeCount(app)).toBe(count);
      if (process.platform === 'darwin') expect(await dockBadge(app)).toBe(expectedDock);
    }

    await page.evaluate(() => window.mindroomDesktop?.setBadge(5));
    await expect.poll(() => lastBadgeCount(app)).toBe(5);
    await page.reload();
    await expect(page.locator('input[name="serverInput"]')).toBeVisible();
    await expect.poll(() => lastBadgeCount(app)).toBe(0);
    if (process.platform === 'darwin') expect(await dockBadge(app)).toBe('');

    await hideMainWindow(app);
    await expect
      .poll(() => page.evaluate(() => window.mindroomDesktop?.isWindowFocused()))
      .toBe(false);
    await page.evaluate(() => window.mindroomDesktop?.showMainWindow());
    await expect
      .poll(() => page.evaluate(() => window.mindroomDesktop?.isWindowFocused()))
      .toBe(true);

    await openQuickCapture(session);
    const ipcChecks = await app.evaluate(async ({ BrowserWindow, ipcMain }) => {
      const wins = BrowserWindow.getAllWindows();
      const mainWin = wins.find((w) => !w.webContents.getURL().includes('/quick-capture'));
      const qcWin = wins.find((w) => w.webContents.getURL().includes('/quick-capture'));
      if (!mainWin || !qcWin) throw new Error('Expected main and Quick Capture windows');
      const handler = (
        ipcMain as unknown as {
          _invokeHandlers: Map<
            string,
            (
              event: { sender: unknown; senderFrame: unknown },
              ...args: unknown[]
            ) => Promise<unknown>
          >;
        }
      )._invokeHandlers.get('desktop:set-badge');
      if (!handler) throw new Error('desktop:set-badge handler missing');
      const mainEvent = { sender: mainWin.webContents, senderFrame: mainWin.webContents.mainFrame };
      const qcEvent = { sender: qcWin.webContents, senderFrame: qcWin.webContents.mainFrame };
      return {
        fromQc: await handler(qcEvent, 5),
        negative: await handler(mainEvent, -1),
        nonFinite: await handler(mainEvent, Number.NaN),
      };
    });

    expect(ipcChecks.fromQc).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(ipcChecks.negative).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
    expect(ipcChecks.nonFinite).toEqual({ ok: false, code: 'BAD_ARGUMENTS' });
  } finally {
    await session.close();
  }
});

test('diagnostics recorders start automatically in Electron without debug mode', async () => {
  const session = await launchDesktop({ offline: true });
  try {
    const { page } = session;
    await expect(page.locator('input[name="serverInput"]')).toBeVisible();

    const state = await page.evaluate(() => ({
      debugMode: window.localStorage.getItem('mindroom.diagnostics.debugMode.v1'),
      flight: window.localStorage.getItem('mindroom.flight.current.v1'),
      abnormal: window.localStorage.getItem('mindroom.flight.abnormal.v1'),
    }));
    expect(state.debugMode).toBeNull();
    expect(state.flight).not.toBeNull();
    expect(JSON.parse(state.flight!)).toMatchObject({ schemaVersion: 1 });
    expect(state.abnormal).toBeNull();

    // Quick Capture shares origin storage and must not start a competing flight recorder.
    const panelPage = await openQuickCapture(session);
    await expect(panelPage.getByText('Sign in to MindRoom', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => window.localStorage.getItem('mindroom.flight.abnormal.v1'))
    ).toBeNull();
  } finally {
    await session.close();
  }
});

test('@homeserver badge follows unread count, notification clicks restore hidden window, and sign-out clears badge', async () => {
  test.setTimeout(180_000);
  const homeserver = process.env.E2E_HOMESERVER_URL ?? DISPOSABLE_HOMESERVER;
  const { reader, writer, quietId, busyId, rootId } = await setupRooms(homeserver, 'desktop_p9');
  const callId = await createRoom(homeserver, writer.accessToken, {
    name: 'desktop_p9 Call',
    invite: [reader.userId],
  });
  await joinRoom(homeserver, reader.accessToken, callId);

  const session = await launchDesktop();
  try {
    const { app, page } = session;
    await installNotificationRecorder(page);
    await loginWithPassword(page, {
      homeserver,
      username: reader.username,
      password: reader.password,
      baseUrl: APP_ORIGIN,
    });
    await page
      .getByRole('link', { name: /desktop_p9 Quiet/ })
      .first()
      .click({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(quietId)));

    // 1. Message notification + Dock badge while main window is hidden.
    const badgeBeforeFirst = (await lastBadgeCount(app)) ?? 0;
    await hideMainWindow(app);
    const firstEventId = await sendRoomMessage(
      homeserver,
      writer.accessToken,
      busyId,
      threadMention(rootId, reader.userId, 'check the release notes')
    );
    const firstTag = `${busyId}:${firstEventId}`;
    await expect
      .poll(() => lastBadgeCount(app) ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(badgeBeforeFirst);
    if (process.platform === 'darwin') {
      await expect.poll(() => dockBadge(app), { timeout: 10_000 }).toMatch(/^[1-9]/);
    }
    await expect
      .poll(async () => (await recordedNotes(page)).findIndex((n) => n.tag === firstTag), {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(0);
    await clickNote(
      page,
      (await recordedNotes(page)).findIndex((n) => n.tag === firstTag)
    );
    await expect.poll(() => mainWindowVisible(app), { timeout: 15_000 }).toBe(true);
    await expect(page).toHaveURL(
      new RegExp(`${encodeURIComponent(busyId)}.*threadId=${encodeURIComponent(rootId)}`)
    );
    await expect(page.getByText('check the release notes')).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => lastBadgeCount(app) ?? Number.POSITIVE_INFINITY, { timeout: 30_000 })
      .toBeLessThanOrEqual(badgeBeforeFirst);

    // 1b. Hiding the window while still viewing that open thread must not auto-mark a new reply read.
    const badgeBeforeHiddenReply = (await lastBadgeCount(app)) ?? 0;
    await hideMainWindow(app);
    await expect
      .poll(() => page.evaluate(() => window.mindroomDesktop?.isWindowFocused()))
      .toBe(false);
    const hiddenReplyId = await sendRoomMessage(
      homeserver,
      writer.accessToken,
      busyId,
      threadMention(rootId, reader.userId, 'reply while hidden on open thread')
    );
    const hiddenReplyTag = `${busyId}:${hiddenReplyId}`;
    await expect
      .poll(
        async () =>
          (
            await recordedNotes(page)
          ).findIndex(
            (n) =>
              n.tag === hiddenReplyTag &&
              (n.body ?? '').includes('reply while hidden on open thread')
          ),
        { timeout: 30_000 }
      )
      .toBeGreaterThanOrEqual(0);
    await expect
      .poll(() => lastBadgeCount(app) ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(badgeBeforeHiddenReply);
    if (process.platform === 'darwin') {
      await expect.poll(() => dockBadge(app), { timeout: 10_000 }).toMatch(/^[1-9]/);
    }
    await page.evaluate(() => window.mindroomDesktop?.showMainWindow());
    await expect.poll(() => mainWindowVisible(app), { timeout: 15_000 }).toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.mindroomDesktop?.isWindowFocused()))
      .toBe(true);
    await expect
      .poll(() => lastBadgeCount(app) ?? Number.POSITIVE_INFINITY, { timeout: 30_000 })
      .toBeLessThanOrEqual(badgeBeforeHiddenReply);

    // 2. Call ring notification click restores the hidden main window on the call room.
    await hideMainWindow(app);
    const callStateKey = `_${writer.userId}_CALLDEV_m.call`;
    await sendStateEvent(
      homeserver,
      writer.accessToken,
      callId,
      'org.matrix.msc3401.call.member',
      callStateKey,
      {
        application: 'm.call',
        call_id: '',
        scope: 'm.room',
        device_id: 'CALLDEV',
        expires: 14_400_000,
        focus_active: { type: 'livekit', focus_selection: 'oldest_membership' },
        foci_preferred: [],
      }
    );
    await matrixFetch(
      homeserver,
      `/rooms/${encodeURIComponent(
        callId
      )}/send/org.matrix.msc4075.rtc.notification/${crypto.randomUUID()}`,
      {
        method: 'PUT',
        accessToken: writer.accessToken,
        body: JSON.stringify({
          notification_type: 'ring',
          lifetime: 30_000,
          'm.call.intent': 'audio',
          'm.mentions': { user_ids: [reader.userId] },
        }),
      }
    );
    const callTagPrefix = `call-ring-${callId}:`;
    await expect
      .poll(
        async () => (await recordedNotes(page)).findIndex((n) => n.tag?.startsWith(callTagPrefix)),
        { timeout: 30_000 }
      )
      .toBeGreaterThanOrEqual(0);
    await clickNote(
      page,
      (await recordedNotes(page)).findIndex((n) => n.tag?.startsWith(callTagPrefix))
    );
    await expect.poll(() => mainWindowVisible(app), { timeout: 15_000 }).toBe(true);
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(callId)));
    await sendStateEvent(
      homeserver,
      writer.accessToken,
      callId,
      'org.matrix.msc3401.call.member',
      callStateKey,
      {}
    );

    // 3. Invitation notification click restores the hidden main window on /activity/invites/.
    await hideMainWindow(app);
    await createRoom(homeserver, writer.accessToken, {
      name: 'desktop_p9 Invite',
      invite: [reader.userId],
    });
    const findInvite = async () =>
      (await recordedNotes(page)).findIndex((n) => /invitation/i.test(n.body ?? ''));
    await expect.poll(findInvite, { timeout: 30_000 }).toBeGreaterThanOrEqual(0);
    await clickNote(page, await findInvite());
    await expect.poll(() => mainWindowVisible(app), { timeout: 15_000 }).toBe(true);
    await expect(page).toHaveURL(/\/activity\/invites\/$/);

    // 4. Signing out clears the Dock badge to 0.
    await sendRoomMessage(
      homeserver,
      writer.accessToken,
      busyId,
      threadMention(rootId, reader.userId, 'unread before sign-out')
    );
    await expect.poll(() => lastBadgeCount(app), { timeout: 30_000 }).toBeGreaterThan(0);
    await logoutActiveAccount(page);
    await expect(page.locator('input[name="serverInput"]')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => lastBadgeCount(app), { timeout: 15_000 }).toBe(0);
    if (process.platform === 'darwin') expect(await dockBadge(app)).toBe('');
  } finally {
    await session.close();
  }
});

test('@homeserver hidden window for >5 minutes still raises one notification and click restores thread', async () => {
  test.setTimeout(8 * 60 * 1000);
  const hiddenMs = Number(process.env.MINDROOM_E2E_HIDDEN_MS ?? 310_000);
  const homeserver = process.env.E2E_HOMESERVER_URL ?? DISPOSABLE_HOMESERVER;
  const { reader, writer, quietId, busyId, rootId } = await setupRooms(
    homeserver,
    'desktop_p9_long'
  );

  const session = await launchDesktop();
  try {
    const { app, page } = session;
    await installNotificationRecorder(page);
    await loginWithPassword(page, {
      homeserver,
      username: reader.username,
      password: reader.password,
      baseUrl: APP_ORIGIN,
    });
    await page
      .getByRole('link', { name: /desktop_p9_long Quiet/ })
      .first()
      .click({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(quietId)));

    await hideMainWindow(app);
    await new Promise((resolve) => setTimeout(resolve, hiddenMs));
    expect(await mainWindowVisible(app)).toBe(false);

    const wakeEventId = await sendRoomMessage(
      homeserver,
      writer.accessToken,
      busyId,
      threadMention(rootId, reader.userId, 'wake up after five minutes')
    );
    await expect
      .poll(() => recordedNotes(page), { timeout: 30_000 })
      .toEqual([
        {
          title: 'desktop_p9_long Busy',
          body: expect.stringContaining('wake up after five minutes'),
          tag: `${busyId}:${wakeEventId}`,
        },
      ]);

    await clickNote(page, 0);
    await expect.poll(() => mainWindowVisible(app), { timeout: 15_000 }).toBe(true);
    await expect(page).toHaveURL(
      new RegExp(`${encodeURIComponent(busyId)}.*threadId=${encodeURIComponent(rootId)}`)
    );
  } finally {
    await session.close();
  }
});
