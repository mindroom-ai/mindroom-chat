import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, BrowserContextOptions, Page } from '@playwright/test';
import {
  expect,
  routeClientConfig,
  test,
  threadUrl,
  uniqueWord,
  waitForAgentReply,
  waitForThreadEvent,
  type AgentStack,
} from '../helpers/agentStack';
import { measureHitAreas } from '../helpers/hitAreas';
import { raisedTouchConflicts } from '../helpers/raisedTouchLayers';
import { createRoom } from '../helpers/createRoom';
import {
  addRoomToSpace,
  createPrivateSpace,
  joinRoom,
  matrixFetch,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';
import { setRoomCompact } from '../helpers/roomViewSwitch';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';

// The main screens on a phone (390 by 844, touch), with a live MindRoom backend and its stub
// model, in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit,
// each in the light and the dark theme:
// - every control a finger can tap has a hit area of 44 by 44 px, or one that reaches the middle
//   of the gap to the next control where they stand closer (e2e/helpers/hitAreas.ts);
// - axe-core finds nothing critical or serious.
// The screens: home with the rail, a room in Compact and in Threads view (unread, streaming and
// resolved threads), a thread with reasoning, a tool call, a folded long reply, a code block, a
// running background job and someone typing, an approval under review, settings, the inbox, a
// space's lobby and the command palette.
// Set PHONE_A11Y_SHOTS=<directory> to save each screen.
const SHOTS = process.env.PHONE_A11Y_SHOTS;
const AXE_PATH = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js');
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const THEMES = ['light', 'dark'] as const;
const PASSWORD = 'phone-a11y-spec-password';

/**
 * Findings in ported (Lane P) code that stay: a control whose label summarizes more than its
 * visible text (the key backup nudge, each Compact card).
 */
const KNOWN = [
  /^label-content-name-mismatch: <button [^>]*aria-label="Set up secure key backup"/,
  /^label-content-name-mismatch: <button [^>]*data-thread-root-id="[^"]*"(?:[^>]*aria-label="Open thread:| [^>]*\.\.\.>$)/,
];

/** Critical and serious axe-core findings on the page, as `rule: element` lines. */
const axeFindings = async (page: Page): Promise<string[]> => {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE_PATH });
  const found = await page.evaluate(async () => {
    type AxeResult = {
      violations: { id: string; impact: string | null; nodes: { html: string }[] }[];
    };
    const { axe } = window as unknown as {
      axe: { run: (context: Document) => Promise<AxeResult> };
    };
    const result = await axe.run(document);
    return result.violations
      .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
      .flatMap((violation) =>
        violation.nodes.map((node) => `${violation.id}: ${node.html.slice(0, 300)}`)
      );
  });
  return found.filter((finding) => !KNOWN.some((pattern) => pattern.test(finding)));
};

type World = {
  /** Reasoning, a tool call, a folded long reply and a code block. */
  thread: string;
  /** A held shell call. */
  approval: string;
  spaceName: string;
  /** A space without a picture, which the rail shows by its first two letters, with two rooms. */
  plainSpace: string;
  plainSpaceName: string;
  typist: { userId: string; accessToken: string };
};

const inThread = (rootId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

const ask = (stack: AgentStack, body: string, rootId?: string) =>
  sendRoomMessage(stack.homeserver, stack.tester.accessToken, stack.rooms.lobby, {
    msgtype: 'm.text',
    body,
    ...(rootId ? inThread(rootId) : {}),
  });

let world: Promise<World> | undefined;

/** The lobby's threads, written once per stack. */
const seed = async (stack: AgentStack): Promise<World> => {
  const word = uniqueWord('a11y');
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(stack.homeserver, stack.tester.accessToken, { name: `Project room ${index + 1}` })
    )
  );
  const thread = await ask(stack, `Walk me through the release checks ${word} #think`);
  await waitForAgentReply(stack, thread, (body) => body.includes('42'));
  await ask(stack, 'Check the disk first #shell', thread);
  await waitForAgentReply(stack, thread, (body) => body.includes('Finished **shell**'));
  await ask(stack, 'Paste the whole checklist #long', thread);
  await waitForAgentReply(stack, thread, (body) => body.includes('End of the long reply'));
  await ask(stack, 'Show the report as a table #markdown', thread);
  await waitForAgentReply(stack, thread, (body) => body.includes('Stub report'));

  const approval = await ask(stack, `Ship the build to staging ${word} #approve`);
  await waitForThreadEvent(
    stack,
    approval,
    (event) => event.type === 'io.mindroom.tool_approval' && event.content.status === 'pending',
    { description: 'a pending tool approval' }
  );

  // A thread the tester resolved, and two the tester has not read yet.
  const resolved = await ask(stack, `Load test passed at 2,100 requests per second ${word}`);
  await waitForAgentReply(stack, resolved, (body) => body.includes('Hello from'));
  await sendStateEvent(
    stack.homeserver,
    stack.tester.accessToken,
    stack.rooms.lobby,
    'com.mindroom.thread.tags',
    JSON.stringify([resolved, 'resolved']),
    { set_by: stack.tester.userId, set_at: new Date().toISOString() }
  );
  for (const topic of ['Draft the launch email', 'Book the venue for the offsite']) {
    // eslint-disable-next-line no-await-in-loop
    const root = await ask(stack, `${topic} ${word}`);
    // eslint-disable-next-line no-await-in-loop
    await waitForAgentReply(stack, root, (body) => body.includes('Hello from'));
  }

  // Someone else in the lobby, to show the typing chip.
  const username = `typist_${word}`;
  await matrixFetch(stack.homeserver, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  const typist = await matrixFetch<{ access_token: string; user_id: string }>(
    stack.homeserver,
    '/login',
    {
      method: 'POST',
      body: JSON.stringify({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: username },
        password: PASSWORD,
      }),
    }
  );
  await matrixFetch(stack.homeserver, `/rooms/${encodeURIComponent(stack.rooms.lobby)}/invite`, {
    method: 'POST',
    accessToken: stack.tester.accessToken,
    body: JSON.stringify({ user_id: typist.user_id }),
  });
  await joinRoom(stack.homeserver, typist.access_token, stack.rooms.lobby);

  const plainSpaceName = `Research Hub ${word}`;
  const plainSpace = await createPrivateSpace(stack.homeserver, stack.tester.accessToken, {
    name: plainSpaceName,
    topic: 'Papers, notes and the reading list',
  });
  for (const name of ['Launch planning', 'Design review']) {
    // eslint-disable-next-line no-await-in-loop
    const room = await createRoom(stack.homeserver, stack.tester.accessToken, { name });
    // eslint-disable-next-line no-await-in-loop
    await addRoomToSpace(stack.homeserver, stack.tester.accessToken, plainSpace, room);
  }
  const { name: spaceName } = await matrixFetch<{ name: string }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(stack.rooms.space)}/state/m.room.name/`,
    { accessToken: stack.tester.accessToken }
  );
  return {
    thread,
    approval,
    spaceName,
    plainSpace,
    plainSpaceName,
    typist: { userId: typist.user_id, accessToken: typist.access_token },
  };
};

const go = async (page: Page, route: string) => {
  await page.evaluate((to) => {
    window.history.pushState(null, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
};

/** Puts the open room in Compact (true) or Threads (false) view. */
const showCompact = (page: Page, compact: boolean) => setRoomCompact(page, compact);

type Screen = { name: string; open: (page: Page) => Promise<void> };

const screens = (stack: AgentStack, seeded: World): Screen[] => {
  const lobby = `/home/${encodeURIComponent(stack.rooms.lobby)}/`;
  return [
    {
      name: 'home',
      open: async (page) => {
        await go(page, '/home/');
        await expect(page.getByRole('navigation', { name: 'Home' })).toBeVisible();
        // The rail names each space by its name (and unread count), not by the letters it shows.
        const rail = page.getByRole('navigation', { name: 'Main' });
        await expect(
          rail.getByRole('button', { name: seeded.plainSpaceName, exact: true })
        ).toBeVisible();
        const escaped = seeded.spaceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await expect(
          rail.getByRole('button', { name: new RegExp(`^${escaped}(, .*unread.*)?$`) })
        ).toBeVisible();
      },
    },
    {
      name: 'compact',
      open: async (page) => {
        await go(page, lobby);
        await showCompact(page, true);
        await expect(page.locator('[data-thread-root-id]').first()).toBeVisible();
      },
    },
    {
      name: 'threads',
      open: async (page) => {
        await go(page, lobby);
        await showCompact(page, false);
        await expect(page.locator('[data-message-item]').first()).toBeVisible({ timeout: 30_000 });
      },
    },
    {
      name: 'thread',
      open: async (page) => {
        // A job runs 45 s; someone types for 30 s.
        await ask(stack, 'Run the nightly export #job', seeded.thread);
        await matrixFetch(
          stack.homeserver,
          `/rooms/${encodeURIComponent(stack.rooms.lobby)}/typing/${encodeURIComponent(
            seeded.typist.userId
          )}`,
          {
            method: 'PUT',
            accessToken: seeded.typist.accessToken,
            body: JSON.stringify({ typing: true, timeout: 30_000 }),
          }
        );
        await go(page, threadUrl(stack, seeded.thread));
        await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByRole('button', { name: 'Stop run_shell_command' })).toBeVisible({
          timeout: 120_000,
        });
        await expect(page.getByRole('button', { name: 'Drop Typing Status' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Copy code' }).first()).toBeVisible();
        // The long reply is folded.
        await expect(page.locator('[data-message-disclosure]').first()).toBeAttached();
      },
    },
    {
      name: 'badge-back',
      open: async (page) => {
        await go(page, threadUrl(stack, seeded.thread));
        // An early reply leaves enough content below it to scroll its badge up to the banner.
        const rowId = await page.getByRole('button', { name: /^Model: / }).first().evaluate(
          (element) => element.closest('[data-message-id]')?.getAttribute('data-message-id')
        );
        if (!rowId) throw new Error('Missing badge message');
        // Keep this message selected when virtualization mounts earlier rows during the scroll.
        const badge = page.locator(`[data-message-id="${rowId}"]`)
          .getByRole('button', { name: /^Model: / });
        await badge.scrollIntoViewIfNeeded();
        await badge.evaluate((element) => {
          const banner = document.querySelector('[data-thread-context-banner]');
          if (!banner) throw new Error('Missing thread banner');
          for (let node = element.parentElement; node; node = node.parentElement) {
            if (/auto|scroll/.test(getComputedStyle(node).overflowY) &&
                node.scrollHeight > node.clientHeight) {
              node.scrollTop += element.getBoundingClientRect().top -
                banner.getBoundingClientRect().bottom - 1;
              return;
            }
          }
          throw new Error('Missing thread scroller');
        });
        await expect.poll(async () => {
          const box = await badge.boundingBox();
          const banner = await page.locator('[data-thread-context-banner]').boundingBox();
          return box && banner ? Math.abs(box.y - banner.y - banner.height - 1) : Infinity;
        }).toBeLessThan(2);
      },
    },
    {
      name: 'review',
      open: async (page) => {
        await go(page, threadUrl(stack, seeded.approval));
        const bar = page.getByRole('region', { name: 'Thread approvals' });
        await bar.getByRole('button', { name: /^Review 1/ }).click({ timeout: 60_000 });
        await expect(
          page.getByRole('dialog', { name: 'Helper wants to do 1 thing' })
        ).toBeVisible();
      },
    },
    {
      name: 'settings',
      open: async (page) => {
        await go(page, '/settings/appearance/');
        await expect(page.getByRole('switch', { name: 'System Theme' })).toBeVisible();
      },
    },
    {
      name: 'inbox',
      open: async (page) => {
        await go(page, '/inbox/notifications/');
        await expect(
          page.getByRole('heading', { level: 1, name: 'Notification Messages' })
        ).toBeVisible();
      },
    },
    {
      name: 'lobby',
      open: async (page) => {
        await go(page, `/${encodeURIComponent(seeded.plainSpace)}/lobby/`);
        await expect(page.getByRole('button', { name: 'Add Room' }).first()).toBeVisible();
      },
    },
    {
      name: 'palette',
      open: async (page) => {
        await go(page, '/home/');
        // The keys the app names for it: ⌘K where the user agent says Apple, else Ctrl+K.
        await pressPaletteShortcut(page);
        const palette = page.getByRole('combobox', { name: 'Command palette' });
        await expect(palette).toBeFocused();
        await palette.fill('release');
        await expect(page.getByRole('option').first()).toBeVisible();
      },
    },
  ];
};

/**
 * Pills that keep their drawn height inside a 44 px touch target: [+all] (18 px). A transparent
 * button paints its pill with the layer behind its text.
 */
const grownPills = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button[aria-label]')).flatMap((button) => {
      const label = button.getAttribute('aria-label') ?? '';
      const drawn = /^(Expand|Collapse) all long messages$/.test(label) ? 18 : 0;
      const box = button.getBoundingClientRect();
      if (!drawn || box.height === 0) return [];
      const layer = getComputedStyle(button, '::before');
      const painted =
        getComputedStyle(button).backgroundColor === 'rgba(0, 0, 0, 0)' && layer.content !== 'none'
          ? parseFloat(layer.height)
          : box.height;
      return painted > drawn + 1 ? [`${label}: ${painted} px pill, not ${drawn} px`] : [];
    })
  );

/** Checks one screen in both themes; a screen that does not open fails on its own. */
const checkScreen = async (page: Page, screen: Screen, engine: string) => {
  try {
    await screen.open(page);
  } catch (error) {
    expect.soft(String(error), `${engine} ${screen.name} opens`).toBe('');
    return;
  }
  for (const theme of THEMES) {
    // eslint-disable-next-line no-await-in-loop
    await page.emulateMedia({ colorScheme: theme });
    // eslint-disable-next-line no-await-in-loop
    await expect(page.locator('body')).toHaveClass(new RegExp(`(^|\\s)${theme}-theme(\\s|$)`));
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(400);
    const where = `${engine} ${theme} ${screen.name}`;
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      // eslint-disable-next-line no-await-in-loop
      await page.screenshot({ path: path.join(SHOTS, `${engine}-${theme}-${screen.name}.png`) });
    }
    // All visible controls participate, including Back in the banner above message rows.
    // eslint-disable-next-line no-await-in-loop
    const conflicts = await raisedTouchConflicts(page);
    expect.soft(conflicts, `${where}: no raised layer intersects another interactive element`)
      .toEqual([]);
    // eslint-disable-next-line no-await-in-loop
    expect.soft(await grownPills(page), `${where}: pills keep their size in 44 px targets`)
      .toEqual([]);
    // eslint-disable-next-line no-await-in-loop
    const { checked, misses } = await measureHitAreas(page);
    console.log(`${where}: ${checked} controls, ${misses.length} short sides`);
    expect
      .soft(
        misses.map(
          (miss) =>
            `${miss.control} ${miss.axis}: ${miss.span} of ${miss.needed} px (${
              miss.sides
            }) at ${miss.box.join(',')}`
        ),
        `${where}: every control's hit area is 44 px, or reaches the middle of the gap to the next control`
      )
      .toEqual([]);
    // eslint-disable-next-line no-await-in-loop
    const findings = fs.existsSync(AXE_PATH) ? await axeFindings(page) : [];
    expect.soft(findings, `${where}: no critical or serious axe-core findings`).toEqual([]);
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
};

const check = async (page: Page, stack: AgentStack, engine: string) => {
  world ??= seed(stack);
  const seeded = await world;
  for (const screen of screens(stack, seeded)) {
    // eslint-disable-next-line no-await-in-loop
    await checkScreen(page, screen, engine);
  }
};

/** The checks in a phone context, which Playwright signs in with the stack's browser storage. */
const run = async (context: BrowserContext, stack: AgentStack, engine: string) => {
  const page = await context.newPage();
  await routeClientConfig(page, stack);
  await page.goto('/home/', { timeout: 180_000 });
  await expect(page.getByRole('button', { name: /Open account menu for / }).first()).toBeVisible({
    timeout: 240_000,
  });
  await expect
    .poll(() => page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches))
    .toBe(true);
  await check(page, stack, engine);
};

test('phone main screens: 44 px hit areas, no critical or serious axe findings (Chromium)', async ({
  browser,
  stack,
  testerStorageState,
}, testInfo) => {
  test.setTimeout(15 * 60_000);
  const context = await browser.newContext({
    ...PHONE,
    baseURL: testInfo.project.use.baseURL,
    storageState: testerStorageState,
  });
  try {
    await run(context, stack, 'chromium');
  } finally {
    await context.close();
  }
});

test('phone main screens: 44 px hit areas, no critical or serious axe findings (WebKit)', async ({
  stack,
  testerStorageState,
}, testInfo) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(15 * 60_000);
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({
      ...PHONE,
      baseURL: testInfo.project.use.baseURL,
      storageState: testerStorageState,
    });
    await run(context, stack, 'webkit');
  } finally {
    await browser.close();
  }
});
