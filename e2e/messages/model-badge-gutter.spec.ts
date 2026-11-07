import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  AI_RUN,
  DESKTOP,
  HOMESERVER,
  LAUNCH,
  PASSWORD,
  PHONE,
  RUN,
  SCHEMES,
  createOtherRooms,
  homeserverIsUp,
  join,
  register,
  say,
  seedSettings,
  setLook,
  shot,
  withRetry,
} from '../helpers/designChoices';
import { launchWebKit } from '../helpers/webkit';

// An agent's model name sits centred under its avatar, at most 4 px wider than the avatar on each
// side (44 px at 100 % zoom), so the thread's minimap strips in the gutter before the avatar never
// cross it (L8-F003, design decision #7); the provider's logo sits on the avatar's corner.
// A long model name wraps onto a second line and is cut there with an ellipsis; the full name
// shows when the badge gets keyboard focus or a tap. Checked in a thread of seven questions and eight agent replies among 25 rooms,
// on a desktop (1440 by 900) at 100 % and 150 % page zoom, light and dark, English and Arabic,
// and on a phone (390 by 844, touch), in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit. Set DESIGN_CHOICES_SHOTS=<directory> to save screenshots.
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const ENGINES = ['chromium', ...(WEBKIT ? ['webkit'] : [])] as const;
const ROOM_NAME = 'Launch planning';
const THREAD_ROOT = 'Run the three steps and report what changed';
const MODEL_NAME = 'Stub Large Model';
/** The avatar column and how far the badge may hang past each side, in CSS pixels at 100 % zoom. */
const AVATAR_PX = 36;
const OVERHANG_PX = 4;

test.use({ launchOptions: LAUNCH });

type Seed = { username: string; roomId: string; root: string };

const seed = async (label: string): Promise<Seed> => {
  const id = `${label}_${RUN}_${randomUUID().slice(0, 6)}`;
  const tester = await register(`mbg_${id}`, 'Robin Tester');
  const helper = await register(`mindroom_helper_${id}`, 'Helper');
  await createOtherRooms(tester);
  const roomId = await withRetry(() =>
    createRoom(HOMESERVER, tester.token, { name: ROOM_NAME, invite: [helper.userId] })
  );
  await join(helper, roomId);
  const root = await say(tester, roomId, THREAD_ROOT);
  for (let step = 1; step <= 7; step += 1) {
    // eslint-disable-next-line no-await-in-loop
    await say(
      tester,
      roomId,
      `Question ${step}: what did step ${step} change in the staging numbers, and should we worry about it before the launch?`,
      root
    );
    // eslint-disable-next-line no-await-in-loop
    await say(
      helper,
      roomId,
      `Step ${step} moved the p99 latency by ${
        step * 3
      } ms; nothing to worry about before the launch, the error rate stayed flat.`,
      root,
      AI_RUN
    );
  }
  await say(helper, roomId, 'I thought about it and the answer is 42.', root, AI_RUN);
  return { username: tester.username, roomId, root };
};

const openThread = async (page: Page, data: Seed) => {
  await page.goto(
    `/home/${encodeURIComponent(data.roomId)}?threadId=${encodeURIComponent(data.root)}`
  );
  await expect(page.getByText('I thought about it and the answer is 42.').first()).toBeVisible({
    timeout: 30_000,
  });
};

/** The visible model badges' rows: badge, avatar and strip boxes, over the thread's whole scroll. */
const badgeProblem = (page: Page, zoom: number, minimap: boolean) =>
  page.evaluate(
    async ({ model, zoomPercent, avatarPx, overhangPx, withMinimap }) => {
      const scale = zoomPercent / 100;
      let element: HTMLElement | null = document.querySelector('[data-thread-count]');
      while (element && !/(auto|scroll)/.test(getComputedStyle(element).overflowY)) {
        element = element.parentElement;
      }
      if (!element) return 'no thread scroller';
      const scroller = element;
      const strips = Array.from(document.querySelectorAll('[data-minimap-strip]'));
      if (withMinimap && strips.length === 0) return 'no minimap strips';
      const frame = () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      const view = scroller.getBoundingClientRect();
      const end = scroller.scrollHeight - scroller.clientHeight;
      let seen = 0;
      // Steps smaller than the 14 px badge plus a 2 px strip, so no crossing slips between two.
      for (let top = 0; top <= end + 12; top += 12) {
        scroller.scrollTop = Math.min(top, end);
        // eslint-disable-next-line no-await-in-loop
        await frame();
        const badges = Array.from(
          document.querySelectorAll<HTMLElement>('[data-message-id] [aria-label]')
        ).filter((node) => (node.getAttribute('aria-label') ?? '').includes(model));
        for (const badge of badges) {
          const b = badge.getBoundingClientRect();
          if (b.bottom > view.top && b.top < view.bottom) {
            seen += 1;
            const avatar = badge.parentElement?.querySelector('[data-user-id]');
            if (!avatar) return 'a badge without its avatar beside it';
            const a = avatar.getBoundingClientRect();
            const offCentre = b.left + b.width / 2 - (a.left + a.width / 2);
            if (Math.abs(offCentre) > 0.5) {
              return `badge centre ${offCentre.toFixed(1)} px off the avatar's centre`;
            }
            const widest = (avatarPx + 2 * overhangPx) * scale + 0.5;
            if (b.width > widest) {
              return `badge ${b.width.toFixed(1)} px wide, more than ${widest.toFixed(1)} px`;
            }
            for (const strip of strips) {
              const s = strip.getBoundingClientRect();
              const across = Math.min(s.right, b.right) - Math.max(s.left, b.left);
              const down = Math.min(s.bottom, b.bottom) - Math.max(s.top, b.top);
              if (across > 0 && down > 0) {
                return `strip ${Math.round(s.left)}-${Math.round(
                  s.right
                )} crosses badge ${Math.round(b.left)}-${Math.round(b.right)} at scroll ${
                  scroller.scrollTop
                }`;
              }
            }
          }
        }
      }
      return seen > 0 ? null : 'no model badge came into view';
    },
    {
      model: MODEL_NAME,
      zoomPercent: zoom,
      avatarPx: AVATAR_PX,
      overhangPx: OVERHANG_PX,
      withMinimap: minimap,
    }
  );

/**
 * Whether the visible tip is painted over the page, not under it: hit testing at its center,
 * with the tip briefly taking the pointer (its layer lets the pointer through), finds the tip.
 */
const tipOnTop = (page: Page) =>
  page.evaluate((model) => {
    const tip = Array.from(document.querySelectorAll<HTMLElement>('[role="tooltip"]')).find(
      (node) => node.textContent?.includes(model) && node.getClientRects().length > 0
    );
    if (!tip) return false;
    const { left, top, width, height } = tip.getBoundingClientRect();
    const before = tip.style.pointerEvents;
    tip.style.pointerEvents = 'auto';
    const hit = document.elementFromPoint(left + width / 2, top + height / 2);
    tip.style.pointerEvents = before;
    return !!hit && tip.contains(hit);
  }, MODEL_NAME);

/** The badge of the last reply, brought into view. */
const lastBadge = async (page: Page) => {
  const row = page
    .locator('[data-message-id]')
    .filter({ hasText: 'I thought about it and the answer is 42.' })
    .last();
  await row.scrollIntoViewIfNeeded();
  return row.locator(`[aria-label*="${MODEL_NAME}"]`).first();
};

const newPage = async (
  engine: (typeof ENGINES)[number],
  browser: Browser,
  options: BrowserContextOptions
) => {
  const owner = engine === 'webkit' ? await launchWebKit() : browser;
  const context = await owner.newContext(options);
  const page = await context.newPage();
  return {
    page,
    close: async () => {
      await context.close();
      if (owner !== browser) await owner.close();
    },
  };
};

const checkDesktop = async (page: Page, data: Seed, engine: string, testInfo: TestInfo) => {
  for (const zoom of [100, 150]) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate((pageZoom) => {
      const stored = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
      localStorage.setItem('settings', JSON.stringify({ ...stored, pageZoom }));
    }, zoom);
    for (const direction of ['ltr', 'rtl'] as const) {
      for (const scheme of SCHEMES) {
        // eslint-disable-next-line no-await-in-loop
        await setLook(page, scheme, direction);
        // eslint-disable-next-line no-await-in-loop
        await page.reload();
        // eslint-disable-next-line no-await-in-loop
        await openThread(page, data);
        const look = `${engine}-desktop-${zoom}-${direction}-${scheme}`;
        // eslint-disable-next-line no-await-in-loop
        const problem = await badgeProblem(page, zoom, true);
        // eslint-disable-next-line no-await-in-loop
        await (await lastBadge(page)).scrollIntoViewIfNeeded();
        // eslint-disable-next-line no-await-in-loop
        await shot(page, testInfo, `model-badge-${look}`);
        expect(problem, look).toBeNull();
      }
    }
  }

  // The keyboard reaches the badge from its row, and focus shows the full model name.
  await setLook(page, 'light', 'ltr');
  await openThread(page, data);
  const badge = await lastBadge(page);
  const row = page
    .locator('[data-message-id]')
    .filter({ hasText: 'I thought about it and the answer is 42.' })
    .last();
  await row.focus();
  let reached = false;
  // WebKit on macOS moves Tab only between fields and lists unless Option is held, as Safari does.
  const macWebKit = process.platform === 'darwin' && engine === 'webkit';
  // The row's toolbar comes first: Add Reaction, Reply, Reply in Thread, More Options.
  for (let press = 0; press < 6 && !reached; press += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press(macWebKit ? 'Alt+Tab' : 'Tab');
    // eslint-disable-next-line no-await-in-loop
    reached = await badge.evaluate((node) => node === document.activeElement);
  }
  expect(reached, 'Tab from the row reaches the model badge').toBe(true);
  await expect(page.getByRole('tooltip').filter({ hasText: MODEL_NAME })).toBeVisible();
  expect(await tipOnTop(page), 'the focused badge tip shows over the page').toBe(true);
  await shot(page, testInfo, `model-badge-${engine}-desktop-focus`);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip').filter({ hasText: MODEL_NAME })).toHaveCount(0);
};

const checkPhone = async (page: Page, data: Seed, engine: string, testInfo: TestInfo) => {
  for (const scheme of SCHEMES) {
    // eslint-disable-next-line no-await-in-loop
    await setLook(page, scheme);
    // eslint-disable-next-line no-await-in-loop
    await openThread(page, data);
    // eslint-disable-next-line no-await-in-loop
    expect(await badgeProblem(page, 100, false), `${engine} phone ${scheme}`).toBeNull();
    // A tap on the badge shows the full model name; a tap elsewhere hides it.
    // eslint-disable-next-line no-await-in-loop
    const badge = await lastBadge(page);
    // eslint-disable-next-line no-await-in-loop
    await badge.tap();
    const tip = page.getByRole('tooltip').filter({ hasText: MODEL_NAME });
    // eslint-disable-next-line no-await-in-loop
    await expect(tip).toBeVisible();
    // eslint-disable-next-line no-await-in-loop
    expect(await tipOnTop(page), 'the tapped badge tip shows over the page').toBe(true);
    // eslint-disable-next-line no-await-in-loop
    await shot(page, testInfo, `model-badge-${engine}-phone-${scheme}-tap`);
    // eslint-disable-next-line no-await-in-loop
    await page.getByRole('heading', { level: 1 }).tap();
    // eslint-disable-next-line no-await-in-loop
    await expect(tip).toHaveCount(0);
  }
};

for (const engine of ENGINES) {
  test(`model badges sit centred under the avatar and clear of the minimap: ${engine}`, async ({
    browser,
  }, testInfo) => {
    test.skip(!(await homeserverIsUp()), 'Test homeserver is not running.');
    test.setTimeout(360_000);
    const data = await seed(`${engine}_d`);
    const { page, close } = await newPage(engine, browser, DESKTOP);
    try {
      await seedSettings(page, { isPeopleDrawer: false });
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: data.username,
        password: PASSWORD,
      });
      await checkDesktop(page, data, engine, testInfo);
    } finally {
      await close();
    }
  });

  test(`a tap on a model badge shows the full model name: ${engine} phone`, async ({
    browser,
  }, testInfo) => {
    test.skip(!(await homeserverIsUp()), 'Test homeserver is not running.');
    test.setTimeout(240_000);
    const data = await seed(`${engine}_p`);
    const { page, close } = await newPage(engine, browser, PHONE);
    try {
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: data.username,
        password: PASSWORD,
      });
      await checkPhone(page, data, engine, testInfo);
    } finally {
      await close();
    }
  });
}
