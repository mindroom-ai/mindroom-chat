import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  matrixFetch,
  setAccountData,
  setDirectAccountData,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// The page navigation (the room list beside the content) moves in the same way however it opens:
// with its toggle, the keyboard shortcut, the button of the section already shown, or a click on
// another space or section while it is collapsed, which changes the page under it at the same
// time. Each motion is held at its start and stepped through six rendered frames, which must match
// the toggle's frame for frame; a space click and the toggle are also sampled on every animation
// frame while they run. Moving between pages while the panel is open does not move it, and reduced
// motion and phones switch at once. Checked with 26 spaces, 30 rooms in each of the first two and
// classic scrollbars, in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, in WebKit.
const PASSWORD = 'drawer-motion-spec-password';
const SPACE_COUNT = 26;
const ROOM_COUNT = 30;
const NAV = '[data-testid="resizable-page-nav"]';
/** The panel's width when nothing was saved. */
const WIDTH = 256;
/** The icon rail beside a phone's list in its navigation drawer. */
const RAIL = 66;
/** The strip of the page the drawer leaves uncovered beside it. */
const DRAWER_GAP = 56;
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 900 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
/** A phone held sideways has room for the panel beside the content, which then collapses. */
const SIDEWAYS: BrowserContextOptions = { ...PHONE, viewport: { width: 844, height: 390 } };

// Headless Chromium hides scrollbars; desktop browsers with classic scrollbars show them.
test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

type Account = { username: string; spaces: string[] };

/** Runs `make` for indexes 0 to count - 1, six at a time. */
const inBatches = async <T>(count: number, make: (index: number) => Promise<T>): Promise<T[]> => {
  const made: T[] = [];
  for (let start = 0; start < count; start += 6) {
    const batch = Array.from({ length: Math.min(6, count - start) }, (_, offset) =>
      make(start + offset)
    );
    made.push(...(await Promise.all(batch)));
  }
  return made;
};

const numbered = (index: number) => String(index + 1).padStart(2, '0');

/** A new account with SPACE_COUNT spaces, ROOM_COUNT rooms in the first two, and one chat. */
const seedAccount = async (): Promise<Account> => {
  // A random suffix: the specs of one run share the homeserver.
  const username = `drawer_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const { user_id: userId, access_token: accessToken } = await matrixFetch<{
    user_id: string;
    access_token: string;
  }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  const spaces = await inBatches(SPACE_COUNT, (index) =>
    createPrivateSpace(HOMESERVER, accessToken, {
      name: `Drawer Space ${numbered(index)}`,
      topic: '',
    })
  );
  const rooms = await inBatches(ROOM_COUNT, (index) =>
    createPrivateRoom(HOMESERVER, accessToken, {
      name: `Drawer Room ${numbered(index)}`,
      topic: 'A room in the drawer list',
    })
  );
  await inBatches(ROOM_COUNT, async (index) => {
    for (const space of spaces.slice(0, 2)) {
      await addRoomToSpace(HOMESERVER, accessToken, space, rooms[index]!);
    }
  });
  const chat = await createPrivateRoom(HOMESERVER, accessToken, {
    name: 'Drawer Chat',
    topic: '',
    isDirect: true,
  });
  await setDirectAccountData(HOMESERVER, accessToken, userId, '@drawer-peer:example.org', chat);
  // Saved in this order, so the rail lists them as created.
  await setAccountData(HOMESERVER, accessToken, userId, 'io.mindroom.spaces', { sidebar: spaces });
  // The rail's Threads button, which this spec presses, is off until the account turns it on.
  await setAccountData(HOMESERVER, accessToken, userId, 'io.mindroom.settings', {
    showThreadsInSidebar: true,
  });
  return { username, spaces };
};

let seeded: Promise<Account> | undefined;
/** One account for every test of the file: each test has its own browser storage. */
const account = (): Promise<Account> => {
  seeded ??= seedAccount();
  return seeded;
};

type DrawerWindow = {
  drawerHold?: boolean;
  drawerHeld?: Animation;
  drawerPage?: Element | null;
  drawerSampling?: Promise<number[]>;
};

/** Holds the next motion the page starts on the panel at its start while `drawerHold` is set. */
const watchDrawer = (page: Page) =>
  page.addInitScript((selector: string) => {
    const state = window as unknown as DrawerWindow;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function watchDrawerMotion(
      this: Element,
      ...args: Parameters<Element['animate']>
    ) {
      const animation = animate.apply(this, args);
      if (state.drawerHold && this.matches(selector)) {
        animation.pause();
        state.drawerHeld = animation;
        state.drawerHold = false;
      }
      return animation;
    };
  }, NAV);

const signIn = async (page: Page, username: string) => {
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await watchDrawer(page);
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  // Until the first sync, a catching-up bar above the shell changes the layout.
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
};

type Motion = {
  /** Whether a motion started on the panel. */
  moved: boolean;
  /** The panel's width on six frames from the motion's start to five sixths of it. */
  frames: number[];
  duration: number;
  /** The panel's width in the motion's last millisecond; 0 without a motion. */
  to: number;
  /** Whether the page beside the panel is the same element as before (false: it mounted anew). */
  samePage: boolean;
};

/**
 * Holds the motion `action` starts on the panel and reads the panel's width on six rendered frames
 * from its start to five sixths of it, then lets it end. Without a motion, `frames` holds the
 * panel's width on the frame after the action.
 */
const stepMotion = async (page: Page, action: () => Promise<unknown>): Promise<Motion> => {
  await page.evaluate(() => {
    const state = window as unknown as DrawerWindow;
    state.drawerHold = true;
    state.drawerHeld = undefined;
    state.drawerPage = document.querySelector('main[data-page-main]');
  });
  await action();
  return page.evaluate(async (selector) => {
    const state = window as unknown as DrawerWindow;
    const nextFrame = () => new Promise(requestAnimationFrame);
    // A motion starts in the commit the action causes; a busy page may take a few frames.
    for (let frame = 0; frame < 30 && !state.drawerHeld; frame += 1) await nextFrame();
    state.drawerHold = false;
    const samePage =
      !!state.drawerPage && state.drawerPage === document.querySelector('main[data-page-main]');
    const width = () =>
      Math.round((document.querySelector(selector)?.getBoundingClientRect().width ?? 0) * 10) / 10;
    const animation = state.drawerHeld;
    if (!animation) return { moved: false, frames: [width()], duration: 0, to: 0, samePage };
    const duration = Number(animation.effect?.getComputedTiming().duration);
    const frames: number[] = [];
    for (let step = 0; step < 6; step += 1) {
      animation.currentTime = (duration * step) / 6;
      await nextFrame();
      frames.push(width());
    }
    animation.currentTime = duration - 1;
    await nextFrame();
    const to = width();
    animation.play();
    return { moved: true, frames, duration, to, samePage };
  }, NAV);
};

/** The panel's width on every animation frame for `ms` after `action` starts (0 while absent). */
const sampleFrames = async (
  page: Page,
  action: () => Promise<unknown>,
  ms = 1_400
): Promise<number[]> => {
  await page.evaluate(
    ({ selector, duration }) => {
      const widths: number[] = [];
      const start = performance.now();
      (window as unknown as DrawerWindow).drawerSampling = new Promise<number[]>((resolve) => {
        const frame = () => {
          const panel = document.querySelector(selector);
          widths.push(Math.round(panel ? panel.getBoundingClientRect().width : 0));
          if (performance.now() - start < duration) requestAnimationFrame(frame);
          else resolve(widths);
        };
        requestAnimationFrame(frame);
      });
    },
    { selector: NAV, duration: ms }
  );
  await action();
  return page.evaluate(() => (window as unknown as DrawerWindow).drawerSampling!);
};

/**
 * Frames sampled while the panel opens: it grows from nothing to `to` without shrinking on the
 * way, and shows at least one width between the two instead of appearing whole.
 */
const expectGrows = (name: string, widths: number[], to: number) => {
  expect.soft(widths[0], `${name}: ${widths}`).toBe(0);
  expect.soft(widths[widths.length - 1], `${name}: ${widths}`).toBe(to);
  widths.slice(1).forEach((width, index) => {
    expect
      .soft(width, `${name}, frame ${index + 1}: ${widths}`)
      .toBeGreaterThanOrEqual(widths[index]!);
  });
  const between = widths.filter((width) => width > 1 && width < to - 1);
  expect.soft(between.length, `${name}: ${widths}`).toBeGreaterThanOrEqual(1);
};

const widthOf = async (page: Page) =>
  page.evaluate(
    (selector) => Math.round(document.querySelector(selector)?.getBoundingClientRect().width ?? 0),
    NAV
  );

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main', exact: true });
const railButton = (page: Page, name: string) =>
  rail(page).getByRole('button', { name, exact: true });
const spaceButton = (page: Page, spaceId: string) =>
  rail(page).locator(`button[data-id="${spaceId}"]`);
const collapseButton = (page: Page) => railButton(page, 'Collapse navigation panel');
const expandButton = (page: Page) => railButton(page, 'Expand navigation panel');
const toggleButton = (page: Page) =>
  rail(page).getByRole('button', { name: /^(Collapse|Expand) navigation panel$/ });

/**
 * Runs the page's animations at a quarter of their speed in Chromium (through DevTools), so a busy
 * machine still renders many frames of each; returns what restores full speed. WebKit runs at
 * full speed.
 */
const slowMotion = async (page: Page): Promise<() => Promise<unknown>> => {
  if (page.context().browser()?.browserType().name() !== 'chromium') return async () => undefined;
  const session = await page.context().newCDPSession(page);
  await session.send('Animation.enable');
  await session.send('Animation.setPlaybackRate', { playbackRate: 0.25 });
  return () => session.send('Animation.setPlaybackRate', { playbackRate: 1 });
};

/**
 * Opens and closes the panel every way there is, on a desktop window, and checks that each one
 * moves it like the toggle does.
 */
const checkDesktop = async (page: Page, { username, spaces }: Account) => {
  await signIn(page, username);
  const at = (index: number) => spaces[index]!;
  await spaceButton(page, at(0)).click();
  await expect.poll(() => widthOf(page)).toBe(WIDTH);
  const report: string[] = [];

  // The toggle: every other way must move the panel the same.
  const closing = await stepMotion(page, () => collapseButton(page).click());
  await expect.poll(() => widthOf(page)).toBe(0);
  const opening = await stepMotion(page, () => expandButton(page).click());
  await expect.poll(() => widthOf(page)).toBe(WIDTH);
  expect(closing.moved && opening.moved, 'the toggle moves the panel').toBe(true);
  expect(opening.duration).toBeGreaterThanOrEqual(200);
  expect(opening.duration).toBeLessThanOrEqual(250);
  expect(opening.frames[0]).toBe(0);
  opening.frames.slice(1).forEach((width, index) => {
    expect(width).toBeGreaterThan(opening.frames[index]!);
  });
  expect(Math.round(opening.to)).toBe(WIDTH);

  // Soft: one run lists every way that does not move the panel like the toggle.
  const expectLike = (name: string, motion: Motion, like: Motion) => {
    report.push(
      `${name}: moved ${motion.moved}, frames ${motion.frames}, page kept ${motion.samePage}`
    );
    expect.soft(motion.moved, `${name}: ${motion.frames}`).toBe(true);
    if (!motion.moved) return;
    expect.soft(motion.duration, name).toBe(like.duration);
    expect.soft(Math.abs(motion.to - like.to), `${name}: ends at ${motion.to}`).toBeLessThan(1);
    motion.frames.forEach((width, index) => {
      expect
        .soft(Math.abs(width - like.frames[index]!), `${name}: ${motion.frames}`)
        .toBeLessThan(1);
    });
  };
  const opens = async (
    name: string,
    action: () => Promise<unknown>,
    like = opening,
    width = WIDTH
  ) => {
    expectLike(name, await stepMotion(page, action), like);
    await expect.poll(() => widthOf(page)).toBe(width);
  };
  const closes = async (name: string, action: () => Promise<unknown>, like = closing) => {
    expectLike(name, await stepMotion(page, action), like);
    await expect.poll(() => widthOf(page)).toBe(0);
  };
  const stays = async (name: string, action: () => Promise<unknown>) => {
    const motion = await stepMotion(page, action);
    report.push(`${name}: moved ${motion.moved}, width ${motion.frames}`);
    expect.soft(motion.moved, name).toBe(false);
    expect.soft(motion.frames, name).toEqual([WIDTH]);
  };

  try {
    // Another space while collapsed: the page changes and the panel opens in one commit.
    await closes('toggle', () => collapseButton(page).click());
    await opens('another space', () => spaceButton(page, at(1)).click());
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(at(1))));

    // The space already shown toggles its panel.
    await closes('the space shown', () => spaceButton(page, at(1)).click());
    await opens('the space shown again', () => spaceButton(page, at(1)).click());

    // The keyboard: the shortcut toggles, and Enter on another space's button opens it there.
    // The toggle names the keys, Ctrl or ⌘ as the app reads the platform (the browser's user
    // agent, which Playwright's desktop Chromium gives as Windows also on a Mac).
    const shortcut = async () => {
      const keys = await toggleButton(page).getAttribute('aria-keyshortcuts');
      expect(keys).toMatch(/^(Control|Meta)\+\\$/);
      await page.keyboard.press(keys!);
    };
    await closes('shortcut', shortcut);
    await opens('shortcut again', shortcut);
    await closes('shortcut', shortcut);
    await spaceButton(page, at(2)).focus();
    await opens('Enter on another space', () => page.keyboard.press('Enter'));
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(at(2))));

    // Home and Direct Messages open it like a space does, and close it when shown.
    await closes('toggle', () => collapseButton(page).click());
    await opens('Home', () => railButton(page, 'Home').click());
    await closes('Home shown', () => railButton(page, 'Home').click());
    await opens('Direct Messages', () => railButton(page, 'Direct Messages').click());
    await closes('Direct Messages shown', () => railButton(page, 'Direct Messages').click());
    await opens('a space from Direct Messages', () => spaceButton(page, at(3)).click());

    // Threads, whose list is its panel, opens it like Home does and closes it when shown.
    await closes('toggle', () => collapseButton(page).click());
    await opens('Threads', () => railButton(page, 'Threads').click());
    await expect(page).toHaveURL(/\/threads\//);
    await closes('Threads shown', () => railButton(page, 'Threads').click());
    await opens('a space after Threads', () => spaceButton(page, at(4)).click());

    // With the panel open, changing pages does not move it.
    await stays('another space while open', () => spaceButton(page, at(5)).click());
    await stays('Home while open', () => railButton(page, 'Home').click());
    await stays('Threads while open', () => railButton(page, 'Threads').click());
    await expect(page).toHaveURL(/\/threads\//);
    await stays('a space from Threads while open', () => spaceButton(page, at(6)).click());

    // Live, frame by frame: a space click opens the panel as the toggle does.
    const fullSpeed = await slowMotion(page);
    await collapseButton(page).click();
    await expect.poll(() => widthOf(page)).toBe(0);
    const toggled = await sampleFrames(page, () => expandButton(page).click());
    await collapseButton(page).click();
    await expect.poll(() => widthOf(page)).toBe(0);
    const clicked = await sampleFrames(page, () => spaceButton(page, at(7)).click());
    report.push(`live toggle: ${toggled}`, `live space click: ${clicked}`);
    await fullSpeed();
    expectGrows('live toggle', toggled, WIDTH);
    expectGrows('live space click', clicked, WIDTH);

    // Under reduced motion every way switches at once.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const instant = async (name: string, action: () => Promise<unknown>, width: number) => {
      const motion = await stepMotion(page, action);
      report.push(`${name} (reduced motion): moved ${motion.moved}, width ${motion.frames}`);
      expect.soft(motion.moved, name).toBe(false);
      expect.soft(motion.frames, name).toEqual([width]);
    };
    await instant('toggle', () => collapseButton(page).click(), 0);
    await instant('another space', () => spaceButton(page, at(8)).click(), WIDTH);
    await instant('the space shown', () => spaceButton(page, at(8)).click(), 0);
    await instant('toggle', () => expandButton(page).click(), WIDTH);
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // Dragged wider, the panel opens to its own width, the toggle and a space click alike.
    const wider = WIDTH + 100;
    const edge = await page
      .getByRole('separator', { name: 'Resize navigation panel' })
      .boundingBox();
    if (!edge) throw new Error('No resize handle beside the navigation panel');
    const start = { x: edge.x + edge.width / 2, y: edge.y + 250 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 100, start.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => widthOf(page)).toBe(wider);
    const wideClosing = await stepMotion(page, () => collapseButton(page).click());
    await expect.poll(() => widthOf(page)).toBe(0);
    const wideOpening = await stepMotion(page, () => expandButton(page).click());
    report.push(`wide toggle: frames ${wideOpening.frames}, to ${wideOpening.to}`);
    expect
      .soft(Math.round(wideOpening.to), 'the wide toggle moves all the way to the panel width')
      .toBe(wider);
    await expect.poll(() => widthOf(page)).toBe(wider);
    await closes('wide toggle', () => collapseButton(page).click(), wideClosing);
    await opens('wide, another space', () => spaceButton(page, at(9)).click(), wideOpening, wider);
  } finally {
    console.log(
      `DRAWER-MOTIONS ${page.context().browser()?.browserType().name()}\n${report.join('\n')}`
    );
    await test.info().attach('motions', { body: report.join('\n'), contentType: 'text/plain' });
  }
};

test('the page navigation opens in the same motion however it opens', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(DESKTOP.viewport!);
  await checkDesktop(page, await account());
});

test('the page navigation opens in the same motion in WebKit', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const seededAccount = await account();
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ ...DESKTOP, baseURL });
    await checkDesktop(await context.newPage(), seededAccount);
  } finally {
    await browser.close();
  }
});

/** On a phone the list stays out in the navigation drawer beside the rail, and does not move. */
const checkPhone = async (page: Page, { username, spaces }: Account) => {
  await signIn(page, username);
  for (const space of spaces.slice(0, 3)) {
    const motion = await stepMotion(page, () => spaceButton(page, space).tap());
    expect(motion.moved).toBe(false);
    expect(motion.frames).toEqual([PHONE.viewport!.width - DRAWER_GAP - RAIL]);
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(space)));
  }
};

/** Held sideways, a tap on another space opens the collapsed panel as its toggle does. */
const checkSideways = async (page: Page, { username, spaces }: Account) => {
  await signIn(page, username);
  await spaceButton(page, spaces[0]!).tap();
  await expect.poll(() => widthOf(page)).toBe(WIDTH);
  const closing = await stepMotion(page, () => collapseButton(page).tap());
  await expect.poll(() => widthOf(page)).toBe(0);
  const opening = await stepMotion(page, () => expandButton(page).tap());
  await expect.poll(() => widthOf(page)).toBe(WIDTH);
  expect(closing.moved && opening.moved).toBe(true);
  await collapseButton(page).tap();
  await expect.poll(() => widthOf(page)).toBe(0);
  const tapped = await stepMotion(page, () => spaceButton(page, spaces[1]!).tap());
  expect(tapped.moved, `frames ${tapped.frames}`).toBe(true);
  expect(Math.abs(tapped.to - opening.to)).toBeLessThan(1);
  tapped.frames.forEach((width, index) => {
    expect(Math.abs(width - opening.frames[index]!), `frames ${tapped.frames}`).toBeLessThan(1);
  });
  await expect.poll(() => widthOf(page)).toBe(WIDTH);
};

for (const [name, options, check] of [
  ['a phone', PHONE, checkPhone],
  ['a phone held sideways', SIDEWAYS, checkSideways],
] as const) {
  test.describe(`on ${name}`, () => {
    test.use(options);

    test(`the room list on ${name} in Chromium`, async ({ page }) => {
      test.setTimeout(180_000);
      await check(page, await account());
    });

    test(`the room list on ${name} in WebKit`, async ({ baseURL }) => {
      test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
      test.setTimeout(180_000);
      const seededAccount = await account();
      const browser = await launchWebKit();
      try {
        const context = await browser.newContext({ ...options, baseURL });
        await check(await context.newPage(), seededAccount);
      } finally {
        await browser.close();
      }
    });
  });
}
