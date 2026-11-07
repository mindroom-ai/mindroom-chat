import { expect, test, type Locator, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

// Panels beside the content (the page navigation and the room's members panel) open and close in
// one motion: their width changes frame by frame, never in a jump, and the conversation beside
// them keeps its place. Reduced motion switches at once.
//
// Each motion is checked twice. Held: the panel's animation is paused as it starts and stepped
// through six rendered frames, which no busy machine can skip. Live: every frame is sampled while
// it runs at a quarter of its speed (DevTools' slow motion), counting React's commits meanwhile:
// the browser moves the panel, React renders a few times per toggle, not once per frame. Long
// tasks are read from a Chrome trace in thread CPU time, which a busy machine does not stretch, and
// count only in a production build (`e2e-slot --preview`).

test.skip(!hasPrimaryCredentials(), 'Requires a local Matrix test account.');
test.use({ viewport: { width: 1280, height: 900 } });

const NAV = '[data-testid="resizable-page-nav"]';
const MEMBERS = '[data-testid="resizable-members-panel"]';
/** The members panel's frame (src/app/ui/panels/PanelFrame.tsx) takes this much of its content's width. */
const FRAME_STRIP = 40;

test.beforeEach(async ({ page }) => {
  // The local Matrix fixture has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  // Holds the next animation of the element `panelHold` names, paused at its start.
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function holdPanel(
      this: Element,
      ...args: Parameters<Element['animate']>
    ) {
      const animation = animate.apply(this, args);
      const state = window as unknown as { panelHold?: string; panelHeld?: Animation };
      if (state.panelHold && this.matches(state.panelHold)) {
        animation.pause();
        state.panelHeld = animation;
        state.panelHold = undefined;
      }
      return animation;
    };
  });
  // Counts React's commits through the hook React DevTools uses (also in production builds).
  await page.addInitScript(() => {
    const commits = { count: 0 };
    Object.assign(window, {
      panelCommits: commits,
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        supportsFiber: true,
        isDisabled: false,
        renderers: new Map(),
        inject: () => 1,
        checkDCE: () => undefined,
        onScheduleFiberRoot: () => undefined,
        onCommitFiberUnmount: () => undefined,
        onPostCommitFiberRoot: () => undefined,
        onCommitFiberRoot: () => {
          commits.count += 1;
        },
      },
    });
  });
});

/** Runs the page's animations at a quarter of their speed. */
const slowMotion = async (page: Page) => {
  const session = await page.context().newCDPSession(page);
  await session.send('Animation.enable');
  await session.send('Animation.setPlaybackRate', { playbackRate: 0.25 });
};

type Sampling = {
  widths: number[];
  contentWidths: number[];
  /** React commits while the widths were sampled. */
  commits: number;
};

/**
 * The width of the panel (0 once it is gone) and of its content on every animation frame for
 * `ms` after `action` starts, and how many times React committed meanwhile.
 */
const sample = async (
  page: Page,
  selector: string,
  action: () => Promise<unknown>,
  ms = 1_600
): Promise<Sampling> => {
  await page.evaluate(
    ({ selector: panelSelector, ms: duration }) => {
      const widths: number[] = [];
      const contentWidths: number[] = [];
      const start = performance.now();
      const { panelCommits } = window as unknown as { panelCommits: { count: number } };
      const commitsBefore = panelCommits.count;
      Object.assign(window, {
        panelSampling: new Promise<Sampling>((resolve) => {
          const frame = () => {
            const panel = document.querySelector(panelSelector);
            widths.push(panel ? panel.getBoundingClientRect().width : 0);
            const content = panel?.querySelector(':scope > :first-child > *');
            contentWidths.push(content ? content.getBoundingClientRect().width : 0);
            if (performance.now() - start < duration) requestAnimationFrame(frame);
            else resolve({ widths, contentWidths, commits: panelCommits.count - commitsBefore });
          };
          requestAnimationFrame(frame);
        }),
      });
    },
    { selector, ms }
  );
  await action();
  return page.evaluate(
    () => (window as unknown as { panelSampling: Promise<Sampling> }).panelSampling
  );
};

type TraceEvent = {
  name: string;
  ph: string;
  pid: number;
  tid: number;
  ts: number;
  dur?: number;
  tdur?: number;
  args?: { name?: string; data?: { type?: string } };
};

type TaskTime = { wall: number; cpu: number };

/**
 * The page's main-thread work while `action` clicks and `ms` after: the task that handled the
 * click (React showing or hiding a panel, as before panels moved) and the longest of the others
 * (the motion's frames), each in wall time and in the thread CPU time it took (ms).
 */
const traceToggle = async (page: Page, action: () => Promise<unknown>, ms = 600) => {
  const browser = page.context().browser();
  if (!browser) throw new Error('No browser to trace.');
  await browser.startTracing(page, { categories: ['toplevel', 'devtools.timeline'] });
  await action();
  await page.waitForTimeout(ms);
  const { traceEvents } = JSON.parse((await browser.stopTracing()).toString()) as {
    traceEvents: TraceEvent[];
  };
  const on = (thread: TraceEvent) => (event: TraceEvent) =>
    event.pid === thread.pid && event.tid === thread.tid && event.ph === 'X';
  // Older Chrome names a task RunTask, newer ThreadControllerImpl::RunTask.
  const tasks = (thread: TraceEvent) =>
    traceEvents.filter(on(thread)).filter((event) => /(^|::)RunTask$/.test(event.name));
  const main = traceEvents
    .filter((event) => event.name === 'thread_name' && event.args?.name === 'CrRendererMain')
    .sort((a, b) => tasks(b).length - tasks(a).length)[0];
  if (!main) throw new Error('No renderer main thread in the trace.');
  const clicks = traceEvents
    .filter(on(main))
    .filter((event) => event.name === 'EventDispatch' && event.args?.data?.type === 'click');
  const handlesClick = (task: TraceEvent) =>
    clicks.some((click) => click.ts >= task.ts && click.ts <= task.ts + (task.dur ?? 0));
  const time = (task: TraceEvent | undefined): TaskTime => ({
    wall: Math.round((task?.dur ?? 0) / 1000),
    cpu: Math.round((task?.tdur ?? 0) / 1000),
  });
  const longestFirst = tasks(main).sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0));
  const click = longestFirst.find(handlesClick);
  if (!click) throw new Error('No task handled the click in the trace.');
  return { click: time(click), motion: time(longestFirst.find((task) => !handlesClick(task))) };
};

type Stepped = { widths: number[]; contentWidths: number[]; duration: number };

/**
 * Holds the animation `action` starts on the panel, and reads the panel's width (and its
 * content's) on six rendered frames from its start to five sixths of it, before letting it end.
 */
const stepMotion = async (
  page: Page,
  selector: string,
  action: () => Promise<unknown>
): Promise<Stepped> => {
  await page.evaluate((panelSelector) => {
    Object.assign(window, { panelHold: panelSelector, panelHeld: undefined });
  }, selector);
  await action();
  await page.waitForFunction(() => !!(window as unknown as { panelHeld?: Animation }).panelHeld);
  return page.evaluate(async (panelSelector) => {
    const { panelHeld: animation } = window as unknown as { panelHeld: Animation };
    const panel = document.querySelector(panelSelector);
    if (!panel) throw new Error(`No ${panelSelector} to step.`);
    const duration = Number(animation.effect?.getComputedTiming().duration);
    const widths: number[] = [];
    const contentWidths: number[] = [];
    for (let step = 0; step < 6; step += 1) {
      animation.currentTime = (duration * step) / 6;
      await new Promise(requestAnimationFrame);
      widths.push(panel.getBoundingClientRect().width);
      const content = panel.querySelector(':scope > :first-child > *');
      contentWidths.push(content ? content.getBoundingClientRect().width : 0);
    }
    animation.play();
    return { widths, contentWidths, duration };
  }, selector);
};

/**
 * A held motion lasts 200 to 250 ms and moves from `from` toward `to` without turning back,
 * through at least three frames strictly between the two; the panel then ends at `to`.
 */
const expectStepped = async (
  page: Page,
  selector: string,
  stepped: Stepped,
  from: number,
  to: number
) => {
  expect(stepped.duration).toBeGreaterThanOrEqual(200);
  expect(stepped.duration).toBeLessThanOrEqual(250);
  const panel = page.locator(selector);
  if (to === 0) await expect(panel).toHaveCount(0);
  else await expect.poll(() => widthOf(panel)).toBe(to);
  expectSmooth([...stepped.widths, to], from, to);
};

/**
 * The widths move from `from` to `to` without turning back, through at least `between` frames
 * strictly between the two.
 */
const expectSmooth = (widths: number[], from: number, to: number, between = 3) => {
  const direction = Math.sign(to - from);
  expect(widths[0]).toBeCloseTo(from, 0);
  expect(widths[widths.length - 1]).toBeCloseTo(to, 0);
  widths.slice(1).forEach((width, index) => {
    expect((width - widths[index]!) * direction, `frame ${index + 1} of ${widths}`).toBeGreaterThan(
      -0.5
    );
  });
  const moving = widths.filter(
    (width) => (width - from) * direction > 1 && (to - width) * direction > 1
  );
  expect(new Set(moving.map(Math.round)).size, `widths ${widths}`).toBeGreaterThanOrEqual(between);
};

/** The widths jump from `from` to `to` with nothing in between. */
const expectInstant = (widths: number[], from: number, to: number) => {
  expect(widths[0]).toBeCloseTo(from, 0);
  expect(widths[widths.length - 1]).toBeCloseTo(to, 0);
  const between = widths.filter((width) => Math.abs(width - from) > 1 && Math.abs(width - to) > 1);
  expect(between, `widths ${widths}`).toEqual([]);
};

const widthOf = async (panel: Locator) => Math.round((await panel.boundingBox())?.width ?? 0);

/**
 * Where the conversation's timeline stands: the first row below the reader's top edge (under the
 * sticky header, as the timeline anchors it), how far that row's top is from the timeline's, and
 * how far the timeline is from its bottom.
 */
const timelineAnchor = (page: Page) =>
  page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-message-item]');
    let scroller = row?.parentElement ?? null;
    while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) throw new Error('Timeline scroller not found.');
    const viewport = scroller.getBoundingClientRect();
    const readerTop =
      viewport.top + (Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0) + 8;
    const rows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-item]'));
    const anchor = rows.find((candidate) => candidate.getBoundingClientRect().bottom > readerTop);
    return {
      text: (anchor?.textContent ?? '').slice(0, 12),
      top: Math.round((anchor?.getBoundingClientRect().top ?? 0) - viewport.top),
      fromBottom: Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop),
    };
  });

const openRoom = async (page: Page, messages = 0) => {
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `Panel motion ${Date.now()}`,
    topic: 'A room whose panels move',
  });
  for (let index = 0; index < messages; index += 1) {
    await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      // Long and short messages, so a wider conversation wraps them into fewer lines.
      body: `Message ${index + 1}: ${'a panel that moves keeps the reader in place '.repeat(
        1 + (index % 4) * 3
      )}`,
    });
  }
  await loginWithPassword(page, { homeserver, ...credentials });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: session.userId,
    viewMode: 'classic',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await waitForLoggedInShell(page);
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
  return { roomId, userId: session.userId };
};

test('the page navigation and the members panel open and close in one motion', async ({ page }) => {
  test.setTimeout(240_000);
  await openRoom(page);
  await slowMotion(page);
  const nav = page.locator(NAV);
  const members = page.locator(MEMBERS);
  const showMembers = page.getByRole('button', { name: 'Show Members', exact: true });
  const hideMembers = page.getByRole('button', { name: 'Hide Members', exact: true });
  if (await showMembers.isVisible()) await showMembers.click();
  await expect.poll(() => widthOf(members)).toBe(266);
  await expect.poll(() => widthOf(nav)).toBe(256);
  const toggles = [
    { selector: MEMBERS, button: hideMembers, from: 266, to: 0 },
    { selector: MEMBERS, button: showMembers, from: 0, to: 266 },
    {
      selector: NAV,
      button: page.getByRole('button', { name: 'Collapse navigation panel' }),
      from: 256,
      to: 0,
    },
    {
      selector: NAV,
      button: page.getByRole('button', { name: 'Expand navigation panel' }),
      from: 0,
      to: 256,
    },
  ];

  // Under reduced motion every toggle switches at once; its React commits are the toggle's own.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const instantCommits: number[] = [];
  for (const { selector, button, from, to } of toggles) {
    const instant = await sample(page, selector, () => button.click());
    expectInstant(instant.widths, from, to);
    instantCommits.push(instant.commits);
  }

  // Otherwise each one moves the width through the frames between, and React commits about as
  // often as for the instant switch: the browser moves the panel, React does not render per frame.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const { selector, button, from, to } of toggles) {
    await expectStepped(
      page,
      selector,
      await stepMotion(page, selector, () => button.click()),
      from,
      to
    );
  }
  for (const [index, { selector, button, from, to }] of toggles.entries()) {
    const moved = await sample(page, selector, () => button.click());
    expectSmooth(moved.widths, from, to, 1);
    expect(moved.commits, `commits moving, ${instantCommits[index]} at once`).toBeLessThanOrEqual(
      instantCommits[index]! + 3
    );
    // Closing, the content keeps its own width while the panel narrows around it.
    if (to === 0) {
      const content = selector === MEMBERS ? from - FRAME_STRIP : from;
      moved.contentWidths
        .filter((width) => width > 0)
        .forEach((width) => expect(Math.round(width)).toBe(content));
      await expect(page.locator(selector)).toHaveCount(0);
    }
  }

  // Right to left mirrors the motion: the members panel still closes toward its own edge.
  await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
  await expectStepped(
    page,
    MEMBERS,
    await stepMotion(page, MEMBERS, () => hideMembers.click()),
    266,
    0
  );
  await expectStepped(
    page,
    MEMBERS,
    await stepMotion(page, MEMBERS, () => showMembers.click()),
    0,
    266
  );
  const box = await members.boundingBox();
  expect(Math.round(box?.x ?? -1)).toBeLessThan(400);
  await page.screenshot({ path: test.info().outputPath('panels-rtl.png') });
});

test('a drag below the smallest width follows the pointer and closes or springs back', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openRoom(page);
  const members = page.locator(MEMBERS);
  const showMembers = page.getByRole('button', { name: 'Show Members', exact: true });
  if (await showMembers.isVisible()) await showMembers.click();
  await expect.poll(() => widthOf(members)).toBe(266);
  const handle = page.getByRole('separator', { name: 'Resize member panel' });
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error('Missing member resize handle');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + 240;

  // Toward the window's edge the panel narrows past its smallest width with the pointer, and its
  // content keeps that smallest width, clipped instead of squeezed.
  await page.mouse.move(x, y);
  await page.mouse.down();
  const dragged: number[] = [];
  for (const offset of [40, 80, 120, 150, 180, 200]) {
    await page.mouse.move(x + offset, y);
    await expect.poll(() => widthOf(members)).toBe(266 - offset);
    dragged.push(266 - offset);
    const content = members.locator(':scope > :first-child > *');
    expect(await widthOf(content)).toBe(Math.max(200, 266 - offset) - FRAME_STRIP);
  }
  await expect(members).toHaveAttribute('data-collapse-preview', 'true');
  // Released below the threshold, it moves the rest of the way out.
  const release = await stepMotion(page, MEMBERS, () => page.mouse.up());
  await expectStepped(page, MEMBERS, release, 66, 0);
  // The content kept its smallest width all the way out.
  release.contentWidths.forEach((width) => expect(Math.round(width)).toBe(200 - FRAME_STRIP));
  await expect(page.getByRole('button', { name: 'Show Members', exact: true })).toBeVisible();

  // Opened again it has its old width; a drag released above the threshold springs back to the
  // smallest width.
  await page.getByRole('button', { name: 'Show Members', exact: true }).click();
  await expect.poll(() => widthOf(members)).toBe(266);
  const again = await handle.boundingBox();
  if (!again) throw new Error('Missing member resize handle');
  const start = { x: again.x + again.width / 2, y: again.y + 240 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 90, start.y, { steps: 6 });
  await expect.poll(() => widthOf(members)).toBe(176);
  await expect(members).not.toHaveAttribute('data-collapse-preview', 'true');
  await expectStepped(
    page,
    MEMBERS,
    await stepMotion(page, MEMBERS, () => page.mouse.up()),
    176,
    200
  );
});

test('the conversation keeps its place while a panel moves', async ({ page }) => {
  test.setTimeout(240_000);
  await openRoom(page, 60);
  const members = page.locator(MEMBERS);
  const showMembers = page.getByRole('button', { name: 'Show Members', exact: true });
  const hideMembers = page.getByRole('button', { name: 'Hide Members', exact: true });
  if (await showMembers.isVisible()) await showMembers.click();
  await expect.poll(() => widthOf(members)).toBe(266);
  await expect(page.locator('[data-message-item]').last()).toBeVisible();

  // At the bottom, the timeline stays at the bottom through a close and an open. The motion's
  // frames (the panel and the conversation's reflow on each) block the page for no long task; the
  // click's own task, which mounts or unmounts the panel's content as before panels moved, is
  // reported. The page navigation, whose list mounts again when it opens, too.
  await expect.poll(async () => (await timelineAnchor(page)).fromBottom).toBeLessThan(3);
  const toggles = [await traceToggle(page, () => hideMembers.click())];
  expect((await timelineAnchor(page)).fromBottom).toBeLessThan(3);
  toggles.push(await traceToggle(page, () => showMembers.click()));
  expect((await timelineAnchor(page)).fromBottom).toBeLessThan(3);
  const collapse = page.getByRole('button', { name: 'Collapse navigation panel' });
  const expand = page.getByRole('button', { name: 'Expand navigation panel' });
  toggles.push(await traceToggle(page, () => collapse.click()));
  toggles.push(await traceToggle(page, () => expand.click()));
  expect((await timelineAnchor(page)).fromBottom).toBeLessThan(3);
  const listed = (key: 'click' | 'motion') =>
    toggles.map(({ [key]: { wall, cpu } }) => `${wall} ms (${cpu} ms CPU)`).join(', ');
  test
    .info()
    .annotations.push(
      { type: 'click task of each toggle', description: listed('click') },
      { type: 'longest motion task of each toggle', description: listed('motion') }
    );
  const production = await page.evaluate(
    () => !document.querySelector('script[src*="/@vite/client"]')
  );
  if (production) {
    const long = toggles.filter(({ motion }) => motion.cpu >= 50);
    expect(long, `motion tasks: ${listed('motion')}`).toEqual([]);
  }

  // Scrolled up, the message in the middle stays in view, and nothing moves once the panel has.
  await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-message-item]');
    let scroller = row?.parentElement ?? null;
    while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    scroller?.scrollTo({ top: (scroller.scrollHeight - scroller.clientHeight) / 2 });
  });
  await expect.poll(async () => (await timelineAnchor(page)).fromBottom).toBeGreaterThan(300);
  const before = await timelineAnchor(page);
  const place = async () => {
    const { text, top } = await timelineAnchor(page);
    return { text, top };
  };
  await sample(page, MEMBERS, () => hideMembers.click(), 400);
  await expect(members).toHaveCount(0);
  const settled = await place();
  expect(settled.text).toBe(before.text);
  expect(Math.abs(settled.top - before.top), `${before.top} then ${settled.top}`).toBeLessThan(3);
  // The timeline settles with the panel: a second later it has not remeasured into a jump.
  await page.waitForTimeout(1_000);
  expect(await place()).toEqual(settled);
  await sample(page, MEMBERS, () => showMembers.click(), 400);
  await expect.poll(() => widthOf(members)).toBe(266);
  const reopened = await place();
  expect(reopened.text).toBe(before.text);
  expect(Math.abs(reopened.top - before.top), `${before.top} then ${reopened.top}`).toBeLessThan(3);
  await page.waitForTimeout(1_000);
  expect(await place()).toEqual(reopened);
});
