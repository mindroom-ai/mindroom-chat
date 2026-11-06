import path from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  createThreadFixture,
  loginToMatrix,
  matrixFetch,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A message the person typed is never lost and never merged into another one. A send that fails
// keeps its own row, marked "Not sent" with Retry and Delete, and the composer keeps whatever is
// typed after it; messages written offline each show a pending row at once, a text sent after a
// failed attachment too, and they go out in order when the connection returns. Sends fail through
// route interception (a 500 from the homeserver) or the browser going offline. Runs on a desktop
// (1280 by 800, light) and a phone (390 by 844 with touch, dark), in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the disposable
// homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh. Set SEND_FAILURES_SHOTS=<dir>
// to also save a picture of each step.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'send-failures-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.SEND_FAILURES_SHOTS;

type Layout = { name: 'desktop' | 'phone'; options: BrowserContextOptions };

const LAYOUTS: Layout[] = [
  {
    name: 'desktop',
    options: { viewport: { width: 1280, height: 800 }, colorScheme: 'light' },
  },
  {
    name: 'phone',
    options: {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      colorScheme: 'dark',
    },
  },
];

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts; the scrollbars stay visible.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const register = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `sf_${name}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

const ROOT_BODY = 'Shift handover checklist for the weekend crew';
const REPLY_BODY = 'I added the fuel readings and the open work orders.';
const LAST_BODY =
  'Yes, all twelve of them. I asked the electricians to have the sockets on the east side ready by six.';
const HISTORY = [
  'Morning all. The harbour office moved the pilot briefing to half past nine, so the first tug leaves a little later than planned.',
  'Noted. I will update the berth plan and send it round before lunch.',
  'The crane on quay four is back from maintenance; the inspection report is in the shared folder if anyone wants the details.',
  'Thanks. Can someone confirm whether the reefer containers on the evening vessel need shore power on arrival?',
  LAST_BODY,
];

type World = {
  user: MatrixSession & { username: string };
  roomId: string;
  rootId: string;
};

/**
 * One account with 25 rooms, each with a few messages; the room under test has a conversation
 * and a thread with a reply. Each test has its own account.
 */
const seed = async (name: string): Promise<World> => {
  const user = await register(name);
  const fixture = await createThreadFixture(HOMESERVER, user.accessToken, {
    name: `Harbour desk ${name}`,
    topic: 'Daily coordination',
    fillerBody: HISTORY[0],
    rootBody: ROOT_BODY,
    replyBody: REPLY_BODY,
  });
  for (const body of HISTORY.slice(1)) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, user.accessToken, fixture.roomId, {
      msgtype: 'm.text',
      body,
    });
  }
  const others = Array.from({ length: 24 }, (_, index) => index);
  await Promise.all(
    others.map(async (index) => {
      const roomId = await createRoom(HOMESERVER, user.accessToken, {
        name: `Project room ${index + 1}`,
      });
      await sendRoomMessage(HOMESERVER, user.accessToken, roomId, {
        msgtype: 'm.text',
        body: HISTORY[index % HISTORY.length],
      });
    })
  );
  return { user, roomId: fixture.roomId, rootId: fixture.rootId };
};

type ServerMessage = {
  type: string;
  content: { body?: string; msgtype?: string; 'm.relates_to'?: { rel_type?: string } };
};

/** The bodies of the room's messages on the homeserver, oldest first. */
const serverBodies = async (world: World): Promise<string[]> => {
  const page = await matrixFetch<{ chunk: ServerMessage[] }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(world.roomId)}/messages?dir=b&limit=200`,
    { accessToken: world.user.accessToken }
  );
  return page.chunk
    .filter((event) => event.type === 'm.room.message')
    .map((event) => event.content.body ?? '')
    .reverse();
};

const composerOf = (page: Page): Locator => page.locator('[data-editable-name="RoomInput"]');

/** The composer holds no text (its placeholder is not text the person typed). */
const expectEmptyComposer = (page: Page) =>
  expect(composerOf(page).locator('[data-slate-string]')).toHaveCount(0);

const rowOf = (page: Page, text: string): Locator =>
  page.locator('[data-message-id]').filter({ hasText: text });

/** The "Not sent" line with Retry and Delete that follows a message's row. */
const failedActionsOf = (row: Locator): Locator =>
  row.locator('xpath=following-sibling::*[1]').filter({ hasText: 'Not sent' });

/** The texts of the rows that hold one of `markers`, in the order the page shows them. */
const rowOrder = (page: Page, markers: string[]): Promise<string[]> =>
  page.locator('[data-message-id]').evaluateAll(
    (elements, wanted) =>
      elements
        .map((element) => wanted.find((marker) => element.textContent?.includes(marker)))
        .filter((marker): marker is string => marker !== undefined),
    markers
  );

const shot = async (page: Page, name: string): Promise<void> => {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const press = async (layout: Layout, target: Locator): Promise<void> => {
  if (layout.name === 'phone') await target.tap();
  else await target.click();
};

/** Types a message and sends it: Enter on a desktop, the Send button on a phone. */
const send = async (page: Page, layout: Layout, text: string): Promise<void> => {
  const composer = composerOf(page);
  await press(layout, composer);
  if (text) await page.keyboard.type(text);
  if (layout.name === 'phone') {
    await page.getByRole('button', { name: 'Send message', exact: true }).tap();
  } else {
    await page.keyboard.press('Enter');
  }
};

/** Stages a small text file through Attach files (on a phone, in More actions). */
const attachFile = async (page: Page, layout: Layout, name: string): Promise<void> => {
  const chooser = page.waitForEvent('filechooser');
  if (layout.name === 'phone') {
    await page.getByRole('button', { name: 'More actions', exact: true }).tap();
    await page.getByRole('menuitem', { name: 'Attach files', exact: true }).tap();
  } else {
    await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  }
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from('Tide table for the weekend: high water 06:12 and 18:40.\n'),
  });
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
};

const openPage = async (
  browser: Browser,
  layout: Layout,
  world: World,
  threadId?: string
): Promise<{ context: BrowserContext; page: Page }> => {
  // Without the service worker, the page's routes see the sends in WebKit too.
  const context = await browser.newContext({ ...layout.options, serviceWorkers: 'block' });
  const page = await context.newPage();
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: world.user.username,
    password: PASSWORD,
  });
  // The Threads view: the room's messages in one timeline, as in a room without agents.
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('threaded')),
    world.roomId
  );
  const roomPath = `/home/${encodeURIComponent(world.roomId)}`;
  await page.goto(threadId ? `${roomPath}?threadId=${encodeURIComponent(threadId)}` : roomPath);
  await expect(composerOf(page)).toBeVisible({ timeout: 60_000 });
  // The room shows its latest message; a thread, its reply.
  await expect(page.getByText(threadId ? REPLY_BODY : LAST_BODY).first()).toBeAttached({
    timeout: 60_000,
  });
  return { context, page };
};

/**
 * A message whose send fails keeps its row: the client tries it again (2, 4, 8 and 16 s), then
 * marks it "Not sent" with Retry and Delete. The composer is never touched: what the person
 * typed meanwhile stays as it is. Retry sends it once; Delete removes the row.
 */
const failedSendKeepsItsRow = async (browser: Browser, layout: Layout, label: string) => {
  const world = await seed(`fail_${label}`);
  const { context, page } = await openPage(browser, layout, world);
  try {
    const first = `Fl ${label} the pilot boarded at the outer buoy`;
    const typing = `Fl ${label} and the second tug is still on its way`;
    let failWith: number | null = 500;
    let attempts = 0;
    await page.route('**/send/m.room.message/**', async (route) => {
      const body = (route.request().postDataJSON() ?? {}) as { body?: string };
      if (failWith !== null && body.body?.startsWith(`Fl ${label}`)) {
        attempts += 1;
        await route.fulfill({
          status: failWith,
          contentType: 'application/json',
          body: JSON.stringify({ errcode: 'M_UNKNOWN', error: 'injected failure' }),
        });
        return;
      }
      await route.continue();
    });

    await send(page, layout, first);
    const row = rowOf(page, first);
    await expect(row).toBeVisible();
    await expect(composerOf(page)).not.toContainText(first);
    // Typed while the first message is still being tried, and not sent.
    await press(layout, composerOf(page));
    await page.keyboard.type(typing);
    await shot(page, `${label}-1-retrying`);

    await expect(failedActionsOf(row)).toBeVisible({ timeout: 60_000 });
    expect(attempts).toBeGreaterThan(1);
    await expect(row).toBeVisible();
    await expect(failedActionsOf(row).getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(failedActionsOf(row).getByRole('button', { name: 'Delete' })).toBeVisible();
    // The line starts where the message's text does, past the avatar column.
    const textStart = (await row.getByText(first).boundingBox())?.x ?? NaN;
    const lineStart =
      (await failedActionsOf(row).getByText('Not sent', { exact: true }).boundingBox())?.x ?? NaN;
    expect(Math.abs(lineStart - textStart)).toBeLessThanOrEqual(4);
    // The composer still holds only what was typed after the failed message.
    await expect(composerOf(page)).toHaveText(typing);
    await shot(page, `${label}-2-not-sent`);
    expect(await serverBodies(world)).not.toContain(first);

    // Retry sends it once.
    failWith = null;
    await press(layout, failedActionsOf(row).getByRole('button', { name: 'Retry' }));
    await expect(failedActionsOf(row)).toHaveCount(0, { timeout: 30_000 });
    await expect
      .poll(async () => (await serverBodies(world)).filter((body) => body === first).length, {
        timeout: 30_000,
      })
      .toBe(1);
    await expect(rowOf(page, first)).toHaveCount(1);

    // A message refused by the server (4xx, not tried again) is "Not sent" at once; Delete
    // removes its row and nothing reaches the server.
    failWith = 400;
    await send(page, layout, '');
    const second = rowOf(page, typing);
    await expect(failedActionsOf(second)).toBeVisible({ timeout: 30_000 });
    await expectEmptyComposer(page);
    await press(layout, failedActionsOf(second).getByRole('button', { name: 'Delete' }));
    await expect(rowOf(page, typing)).toHaveCount(0);
    await expectEmptyComposer(page);
    await shot(page, `${label}-3-deleted`);
    expect(await serverBodies(world)).not.toContain(typing);
  } finally {
    await context.close();
  }
};

/**
 * Offline, in a thread: three texts, then a file whose upload fails at once, an empty send, and
 * one more text. Every text shows its pending row at once, in order; back online they all go out
 * in order, once each, and the file goes out when its upload is retried.
 */
const offlineSendsQueueVisibly = async (browser: Browser, layout: Layout, label: string) => {
  const world = await seed(`offline_${label}`);
  const { context, page } = await openPage(browser, layout, world, world.rootId);
  try {
    const last = `Off ${label} message 4 about the tide table`;
    const texts = [1, 2, 3].map((n) => `Off ${label} message ${n} about the tide table`);
    const fileName = `tide-table-${label}.txt`;
    await context.setOffline(true);
    for (const text of texts) {
      // eslint-disable-next-line no-await-in-loop
      await send(page, layout, text);
      // eslint-disable-next-line no-await-in-loop
      await expect(rowOf(page, text)).toBeVisible({ timeout: 5_000 });
    }
    await attachFile(page, layout, fileName);
    await expect(page.getByRole('button', { name: 'Retry', exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    // Send with only the failed file staged, then one more text.
    await send(page, layout, '');
    await send(page, layout, last);
    await expect(rowOf(page, last)).toBeVisible({ timeout: 5_000 });
    texts.push(last);
    await expectEmptyComposer(page);
    for (const text of texts) {
      // eslint-disable-next-line no-await-in-loop
      await expect(rowOf(page, text).locator('[data-pending-send-icon]')).toBeVisible();
    }
    expect(await rowOrder(page, texts)).toEqual(texts);
    await shot(page, `${label}-1-offline`);

    await context.setOffline(false);
    await expect
      .poll(async () => (await serverBodies(world)).filter((body) => texts.includes(body)), {
        timeout: 45_000,
      })
      .toEqual(texts);
    for (const text of texts) {
      // eslint-disable-next-line no-await-in-loop
      await expect(rowOf(page, text).locator('[data-pending-send-icon]')).toHaveCount(0, {
        timeout: 15_000,
      });
    }
    expect(await rowOrder(page, texts)).toEqual(texts);
    await expectEmptyComposer(page);

    // The file stays staged with its upload's Retry; retried, it goes out once.
    await press(layout, page.getByRole('button', { name: 'Retry', exact: true }).first());
    await expect
      .poll(async () => (await serverBodies(world)).filter((body) => body === fileName).length, {
        timeout: 30_000,
      })
      .toBe(1);
    await shot(page, `${label}-2-online`);
    const bodies = await serverBodies(world);
    expect(bodies.filter((body) => texts.includes(body))).toEqual(texts);
    await expectEmptyComposer(page);
  } finally {
    await context.close();
  }
};

/**
 * Offline past the retries, in a thread: each message turns "Not sent" in its own row, in order,
 * and the composer keeps the draft being typed. Back online, Retry on each sends it once.
 */
const unsentMessagesStayInTheirRows = async (browser: Browser, layout: Layout, label: string) => {
  const world = await seed(`unsent_${label}`);
  const { context, page } = await openPage(browser, layout, world, world.rootId);
  try {
    const texts = [1, 2].map((n) => `Un ${label} message ${n} for the night shift`);
    const draft = `Un ${label} draft that is still being written`;
    await context.setOffline(true);
    for (const text of texts) {
      // eslint-disable-next-line no-await-in-loop
      await send(page, layout, text);
      // eslint-disable-next-line no-await-in-loop
      await expect(rowOf(page, text)).toBeVisible({ timeout: 5_000 });
    }
    await press(layout, composerOf(page));
    await page.keyboard.type(draft);

    for (const text of texts) {
      // eslint-disable-next-line no-await-in-loop
      await expect(failedActionsOf(rowOf(page, text))).toBeVisible({ timeout: 75_000 });
    }
    expect(await rowOrder(page, texts)).toEqual(texts);
    await expect(composerOf(page)).toHaveText(draft);
    await shot(page, `${label}-1-not-sent`);

    await context.setOffline(false);
    for (const text of texts) {
      const actions = failedActionsOf(rowOf(page, text));
      // eslint-disable-next-line no-await-in-loop
      await press(layout, actions.getByRole('button', { name: 'Retry' }));
      // eslint-disable-next-line no-await-in-loop
      await expect(actions).toHaveCount(0, { timeout: 30_000 });
    }
    await expect
      .poll(async () => (await serverBodies(world)).filter((body) => texts.includes(body)), {
        timeout: 30_000,
      })
      .toEqual(texts);
    await expect(composerOf(page)).toHaveText(draft);
    await shot(page, `${label}-2-retried`);
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const SCENARIOS = [
  ['a failed send keeps its row with Not sent, Retry and Delete', failedSendKeepsItsRow],
  ['messages sent offline each show a pending row and go out in order', offlineSendsQueueVisibly],
  ['messages unsent after the retries stay in their rows, in order', unsentMessagesStayInTheirRows],
] as const;

for (const [title, scenario] of SCENARIOS) {
  for (const layout of LAYOUTS) {
    test(`${title} (Chromium, ${layout.name})`, async ({ browser }) => {
      test.setTimeout(240_000);
      await scenario(browser, layout, `c${layout.name[0]}`);
    });

    test(`${title} (WebKit, ${layout.name})`, async () => {
      test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
      test.setTimeout(240_000);
      const browser = await launchWebKit();
      try {
        await scenario(browser, layout, `w${layout.name[0]}`);
      } finally {
        await browser.close();
      }
    });
  }
}
