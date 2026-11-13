import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContextOptions } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  loginToMatrix,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { setRoomCompact } from '../helpers/roomViewSwitch';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// P2-macos-safari-F009: MindRoom titles a thread with an m.notice thread event that carries
// `io.mindroom.thread_summary`, written after the agent's reply, so it is the thread's newest
// event. A device that signs in afterwards and opens the room's Compact view before the threads'
// pages load knows some threads only by that notice. Their cards must never preview the title
// notice ("Helper: <title>"): the title line shows the title, and the preview is the reply, or
// the root until the reply is known. The thread pages are held for 8 s, as a slow network would;
// every preview the cards show meanwhile is recorded. Checked on an iPad and an iPhone in WebKit
// (when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit) and on a desktop in Chromium.
// Set CARD_TITLE_SHOTS=<directory> to save the cards while the pages are held and after.
const PASSWORD = 'card-preview-title-notice-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.CARD_TITLE_SHOTS;
const HOLD_MS = 8_000;

const TABLET: BrowserContextOptions = {
  viewport: { width: 820, height: 1180 },
  hasTouch: true,
  isMobile: true,
};
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const THREADS = [
  ['Which checks still block the launch on Thursday?', 'Launch blockers for Thursday'],
  ['Can someone summarize the load test results?', 'Load test results summary'],
  ['What changed in the export format this week?', 'Export format changes'],
  ['Who owns the security review sign-off?', 'Security review ownership'],
  ['Is the docs site ready for the new search filters?', 'Docs readiness for search filters'],
  ['How long do shared links stay valid after export?', 'Shared link expiry after export'],
  ['Which empty states still need the keyboard hint?', 'Empty states and keyboard hints'],
  ['What is left before the staging token rotation?', 'Staging token rotation status'],
  ['Did the mobile build pick up the new icons?', 'Mobile build icon update'],
] as const;
const replyTo = (question: string) =>
  `Here is what I found about "${question}" The short answer: two items remain, and both have owners and dates in the tracker.`;

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `cptn_${name}_${RUN}`;
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

const inThread = (rootId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

/** 25 other rooms, and a room of 9 threads: the reader asked, the helper answered, then titled. */
const seed = async (engine: string) => {
  const reader = await registerAndLogin(`reader_${engine}`);
  const helper = await registerAgentAccount(HOMESERVER, `titles_${engine}`);
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1}` })
    )
  );
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Launch planning',
    invite: [helper.userId],
  });
  await joinRoom(HOMESERVER, helper.accessToken, roomId);
  const roots: string[] = [];
  const titles: { rootId: string; title: string }[] = [];
  for (const [question, title] of THREADS) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: question,
    });
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, helper.accessToken, roomId, {
      msgtype: 'm.text',
      body: replyTo(question),
      ...inThread(rootId),
    });
    roots.push(rootId);
    titles.push({ rootId, title });
  }
  // The titles come last, as MindRoom writes them once a reply is done.
  for (const { rootId, title } of titles) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, helper.accessToken, roomId, {
      msgtype: 'm.notice',
      body: title,
      'io.mindroom.thread_summary': {
        version: 1,
        summary: title,
        model: 'stub',
        generated_at: new Date().toISOString(),
        message_count: 2,
      },
      ...inThread(rootId),
    });
  }
  return { reader, roomId, roots };
};

const run = async (
  browser: Browser,
  baseURL: string | undefined,
  engine: string,
  device: BrowserContextOptions,
  deviceName: string
) => {
  const world = await seed(`${engine}_${deviceName}`);
  const context = await browser.newContext({ ...device, baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    // Every preview any card shows, as it changes.
    await page.addInitScript(() => {
      const seen = new Set<string>();
      (window as unknown as { cardPreviews: Set<string> }).cardPreviews = seen;
      let queued = false;
      const record = () => {
        queued = false;
        document.querySelectorAll('button[data-thread-root-id]').forEach((card) => {
          const preview = card.children[1]?.textContent?.trim();
          if (preview) seen.add(preview);
        });
      };
      new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(record);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    // The threads' own pages answer late, as on a slow network.
    const encodedRoots = world.roots.map((rootId) => encodeURIComponent(rootId));
    await page.route(
      (url) =>
        url.pathname.includes('/relations/') &&
        encodedRoots.some((rootId) => url.pathname.includes(rootId)),
      async (route) => {
        await new Promise((resolve) => {
          setTimeout(resolve, HOLD_MS);
        });
        await route.continue().catch(() => undefined);
      }
    );
    await page.evaluate((route) => {
      window.history.pushState(null, '', route);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, `/home/${encodeURIComponent(world.roomId)}`);
    await setRoomCompact(page, true);
    const cards = page.locator('button[data-thread-root-id]');
    await expect(cards.first()).toBeVisible({ timeout: 60_000 });
    if (SHOTS) {
      // While the pages are held: the cards that know only the title notice.
      await page.waitForTimeout(2_000);
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({
        path: path.join(SHOTS, `card-previews-${engine}-${deviceName}-held.png`),
      });
    }
    await page.waitForTimeout(HOLD_MS + 4_000);
    if (SHOTS) {
      await page.screenshot({
        path: path.join(SHOTS, `card-previews-${engine}-${deviceName}.png`),
      });
    }
    const previews = await page.evaluate(() => [
      ...(window as unknown as { cardPreviews: Set<string> }).cardPreviews,
    ]);
    console.log(`${engine} ${deviceName} previews:\n${previews.join('\n')}`);
    const titled = previews.filter((preview) =>
      THREADS.some(([, title]) => preview.includes(title))
    );
    expect(titled, `${engine} ${deviceName}: no card previews a title notice`).toEqual([]);
    // Once the pages arrive, the cards on screen preview the helper's reply.
    const firstCard = cards.first();
    await expect(firstCard.locator(':scope > div').nth(1)).toContainText('Here is what I found', {
      timeout: 30_000,
    });
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('cards never preview a title notice on a tablet (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit', TABLET, 'tablet');
  } finally {
    await browser.close();
  }
});

test('cards never preview a title notice on a phone (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit', PHONE, 'phone');
  } finally {
    await browser.close();
  }
});

test('cards never preview a title notice on a desktop (Chromium)', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium', DESKTOP, 'desktop');
});
