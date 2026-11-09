import { expect, test, type Locator, type Page } from '@playwright/test';
import { defined } from '../../src/test/utils/defined';

// The live transcript inside the floating call window (src/app/calls/window/WindowTranscript.tsx),
// laid out by a browser: under the stage in a window narrower than 560 px, beside it from 560 px
// wide, and only its latest line over the stage in a window under 240 px tall (under 340 px while
// narrower than 560 px). The divider between the stage and the transcript follows the pointer,
// also off the window, and the arrow keys, and keeps where it was left; the transcript keeps its
// newest line in view through a resize of the window, a divider move and a resize to the subtitle
// and back, and keeps the place someone scrolled up to. The fixture is the app's own window and
// call view around a stand-in call with 40 transcript lines: no homeserver, call service or
// MindRoom.

test.use({ viewport: { width: 1280, height: 800 } });

type Box = { x: number; y: number; width: number; height: number };

const boxOf = async (locator: Locator): Promise<Box> =>
  defined(await locator.boundingBox(), 'a box on the page');

/** The fixture's window at `width` by `height` px, and its parts. */
const openWindow = async (page: Page, width: number, height: number) => {
  await page.goto(`/e2e/fixtures/call-window-transcript.html?width=${width}&height=${height}`);
  await page.locator('body[data-fixture-ready]').waitFor({ state: 'attached' });
  const callWindow = page.getByTestId('call-window');
  const split = callWindow.locator('[data-call-transcript-layout]');
  const pane = callWindow.locator('[data-call-window-transcript]');
  return {
    callWindow,
    split,
    stage: split.locator(':scope > div', { has: page.locator('[data-call-stage]') }),
    pane,
    // The box the transcript scrolls in.
    log: pane.locator(':scope > div'),
    divider: callWindow.getByRole('separator', { name: 'Resize the transcript' }),
    subtitle: callWindow.locator('[data-call-window-subtitle]'),
  };
};
type CallWindow = Awaited<ReturnType<typeof openWindow>>;

/**
 * The divider gives the stage `percent` of the length it and the transcript share, and the browser
 * laid them out so.
 */
const expectSplit = async ({ split, stage, pane, divider }: CallWindow, percent: number) => {
  await expect(divider).toHaveAttribute('aria-valuenow', String(percent));
  const side = (await split.getAttribute('data-call-transcript-layout')) === 'side';
  const length = side ? 'width' : 'height';
  const [stageBox, paneBox] = await Promise.all([boxOf(stage), boxOf(pane)]);
  expect(stageBox[length] / (stageBox[length] + paneBox[length])).toBeCloseTo(percent / 100, 2);
};

/** The stage's share the account keeps for the divider, as the window stored it. */
const storedSplit = (page: Page) =>
  page.evaluate(
    (key) =>
      (JSON.parse(localStorage.getItem(key) ?? '{}') as { transcriptSplit?: number })
        .transcriptSplit,
    'mindroom.callWindow:@robin:matrix.localhost'
  );

/** Where the transcript is scrolled to, and how far from its end that is. */
const scrollOf = (log: Locator) =>
  log.evaluate((body) => ({
    top: body.scrollTop,
    fromEnd: body.scrollHeight - body.clientHeight - body.scrollTop,
  }));

/**
 * Waits two frames: in the first the browser lays out what changed and tells its resize observers,
 * and in the second it fires the scroll events the first caused.
 */
const twoFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );

/** Presses the mouse in the middle of `from`, moves it to `to` in a few steps, and holds it. */
const pressAndMove = async (page: Page, from: Locator, to: { x: number; y: number }) => {
  const box = await boxOf(from);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
};

/** Drags the window's bottom (`s`) or right (`e`) edge by `by` px, as a person resizes it. */
const resizeBy = async (page: Page, { callWindow }: CallWindow, edge: 's' | 'e', by: number) => {
  const grip = callWindow.locator(`[data-call-window-edge="${edge}"]`);
  const { x, y, width, height } = await boxOf(grip);
  const size = edge === 's' ? 'height' : 'width';
  const before = (await boxOf(callWindow))[size];
  const to = {
    x: x + width / 2 + (edge === 'e' ? by : 0),
    y: y + height / 2 + (edge === 's' ? by : 0),
  };
  await pressAndMove(page, grip, to);
  await page.mouse.up();
  await expect.poll(async () => (await boxOf(callWindow))[size]).toBe(before + by);
};

test.describe('the layout by the window size', () => {
  for (const [width, height, layout] of [
    [400, 480, 'stacked'],
    [559, 480, 'stacked'],
    [400, 340, 'stacked'],
    [560, 480, 'side'],
    [900, 600, 'side'],
    [560, 240, 'side'],
    [560, 239, 'subtitle'],
    [900, 239, 'subtitle'],
    [400, 339, 'subtitle'],
  ] as const) {
    test(`a ${width} by ${height} px window shows the ${layout} layout`, async ({ page }) => {
      const { callWindow, split, stage, pane, log, divider, subtitle } = await openWindow(
        page,
        width,
        height
      );
      expect(await boxOf(callWindow)).toMatchObject({ width, height });
      await expect(split).toHaveAttribute('data-call-transcript-layout', layout);
      const stageBox = await boxOf(stage);
      const paneBox = await boxOf(pane);
      // The log is there in every layout, so screen readers hear each new line.
      await expect(callWindow.getByRole('log', { name: 'Transcript so far' })).toBeAttached();

      if (layout === 'subtitle') {
        await expect(divider).toHaveCount(0);
        // The transcript is out of sight; the latest line shows over the bottom of the stage.
        expect(paneBox.width).toBeLessThanOrEqual(1);
        expect(paneBox.height).toBeLessThanOrEqual(1);
        await expect(subtitle).toHaveText(/^Avery Quinn Line 40: the release notes/);
        await expect(subtitle).toBeInViewport({ ratio: 1 });
        // The stage keeps the subtitle's room free at its end (its content box ends above it), and
        // the subtitle sits in that room, inside the stage from side to side. (A voice stage's
        // face still runs into it in a window 239 px tall.)
        const stageContentEnd = await callWindow
          .locator('[data-call-stage]')
          .evaluate(
            (element) =>
              element.getBoundingClientRect().bottom -
              parseFloat(getComputedStyle(element).paddingBlockEnd)
          );
        const subtitleBox = await boxOf(subtitle);
        // The latest line is a long one: the subtitle is at least two lines tall, and its room is
        // checked against them.
        const lineHeight = await subtitle.evaluate((element) =>
          parseFloat(getComputedStyle(element).lineHeight)
        );
        expect(subtitleBox.height).toBeGreaterThan(2 * lineHeight);
        expect(subtitleBox.y).toBeGreaterThanOrEqual(stageContentEnd);
        expect(subtitleBox.y + subtitleBox.height).toBeLessThanOrEqual(
          stageBox.y + stageBox.height
        );
        expect(subtitleBox.x).toBeGreaterThanOrEqual(stageBox.x);
        expect(subtitleBox.x + subtitleBox.width).toBeLessThanOrEqual(stageBox.x + stageBox.width);
        return;
      }

      await expect(subtitle).toHaveCount(0);
      const dividerBox = await boxOf(divider);
      // The transcript has a pane of its own, over 30 px tall, scrolled to its newest line.
      expect(paneBox.height).toBeGreaterThan(30);
      await expect(log.getByText(/^Line 40: /)).toBeInViewport();
      await expect(divider).toHaveAttribute('aria-valuenow', '60');
      if (layout === 'side') {
        // Stage, divider and transcript side by side, the transcript at the end.
        await expect(divider).toHaveAttribute('aria-orientation', 'vertical');
        expect(dividerBox.x).toBeCloseTo(stageBox.x + stageBox.width, 0);
        expect(paneBox.x).toBeCloseTo(dividerBox.x + dividerBox.width, 0);
        for (const box of [dividerBox, paneBox]) {
          expect(box.y).toBeCloseTo(stageBox.y, 0);
          expect(box.height).toBeCloseTo(stageBox.height, 0);
        }
      } else {
        // Stage, divider and transcript one under the other, each as wide as the others.
        await expect(divider).toHaveAttribute('aria-orientation', 'horizontal');
        expect(dividerBox.y).toBeCloseTo(stageBox.y + stageBox.height, 0);
        expect(paneBox.y).toBeCloseTo(dividerBox.y + dividerBox.height, 0);
        for (const box of [dividerBox, paneBox]) {
          expect(box.x).toBeCloseTo(stageBox.x, 0);
          expect(box.width).toBeCloseTo(stageBox.width, 0);
        }
      }
    });
  }
});

// The stage keeps a face's height (80 px), more than a quarter of a 400 by 480 px window's
// split: the divider's tests use a taller window, where every share of the stage shows as set.
const TALL = { width: 400, height: 640 };

test('the divider follows the pointer, also off the window, and keeps where it was let go', async ({
  page,
}) => {
  const parts = await openWindow(page, TALL.width, TALL.height);
  const { callWindow, split, divider } = parts;
  const windowBox = await boxOf(callWindow);
  const splitBox = await boxOf(split);
  // Right of the window and below it, over the page: only the pointer capture brings the moves
  // there to the divider.
  const offWindow = windowBox.x + windowBox.width + 200;
  const belowWindow = windowBox.y + windowBox.height + 100;

  await pressAndMove(page, divider, { x: offWindow, y: splitBox.y + 0.3 * splitBox.height });
  await expectSplit(parts, 30);
  // Past the end of the window it stops at 80 percent.
  await page.mouse.move(offWindow, belowWindow, { steps: 4 });
  await expect(divider).toHaveAttribute('aria-valuenow', '80');
  await page.mouse.move(offWindow, splitBox.y + 0.7 * splitBox.height, { steps: 4 });
  await expect(divider).toHaveAttribute('aria-valuenow', '70');
  // Kept once let go, not before.
  expect(await storedSplit(page)).toBeUndefined();
  await page.mouse.up();

  await expectSplit(parts, 70);
  expect(await storedSplit(page)).toBe(0.7);
  // The press was the divider's: the window stayed where it was.
  expect(await boxOf(callWindow)).toEqual(windowBox);
  // A pointer moving over the grip after the release, no button held, drags nothing: from its
  // bottom to its top it would set 71 to 68.
  const grip = await boxOf(divider);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height - 1);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 1, { steps: 4 });
  await twoFrames(page);
  await expect(divider).toHaveAttribute('aria-valuenow', '70');

  // The split stays through a resize to the subtitle and back, and into the side layout, where
  // the pointer moves it across, also from below the window.
  await resizeBy(page, parts, 's', -320);
  await expect(split).toHaveAttribute('data-call-transcript-layout', 'subtitle');
  await resizeBy(page, parts, 's', 320);
  await expectSplit(parts, 70);
  await resizeBy(page, parts, 'e', 300);
  await expect(split).toHaveAttribute('data-call-transcript-layout', 'side');
  await expectSplit(parts, 70);

  const sideBox = await boxOf(split);
  await pressAndMove(page, divider, { x: sideBox.x + 0.45 * sideBox.width, y: belowWindow });
  await page.mouse.up();
  await expectSplit(parts, 45);
  expect(await storedSplit(page)).toBe(0.45);
});

test('the arrow keys move the focused divider the way they point, and each step stays', async ({
  page,
}) => {
  let parts = await openWindow(page, TALL.width, TALL.height);
  await parts.divider.focus();
  const step = async (key: string, value: number) => {
    await page.keyboard.press(key);
    await expectSplit(parts, value);
    expect(await storedSplit(page)).toBe(value / 100);
  };
  // Under the stage, Down gives the stage more and Up less.
  await step('ArrowDown', 65);
  await step('ArrowUp', 60);
  await step('ArrowUp', 55);
  await step('Home', 25);
  await step('End', 80);

  // Beside the stage, Left and Right move it, Up and Down do not.
  parts = await openWindow(page, 700, 480);
  await parts.divider.focus();
  for (const key of ['ArrowDown', 'ArrowUp']) {
    await page.keyboard.press(key);
    await expect(parts.divider).toHaveAttribute('aria-valuenow', '60');
  }
  expect(await storedSplit(page)).toBeUndefined();
  await step('ArrowRight', 65);
  await step('ArrowLeft', 60);
  await step('ArrowLeft', 55);
});

test('the transcript keeps its newest line in view through layout changes, unless scrolled up', async ({
  page,
}) => {
  const parts = await openWindow(page, TALL.width, TALL.height);
  const { split, log, divider } = parts;
  const atEnd = async () => {
    await twoFrames(page);
    expect((await scrollOf(log)).fromEnd).toBeLessThanOrEqual(1);
  };
  await atEnd();

  // A larger stage leaves the transcript less room: by the keys, and by the pointer.
  await divider.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(divider).toHaveAttribute('aria-valuenow', '70');
  await atEnd();
  const splitBox = await boxOf(split);
  await pressAndMove(page, divider, { x: splitBox.x + 20, y: splitBox.y + 0.8 * splitBox.height });
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '80');
  await atEnd();

  // The window made smaller by its edge, and to the subtitle, where the transcript is out of
  // sight, and back.
  await resizeBy(page, parts, 's', -280);
  await expect(split).toHaveAttribute('data-call-transcript-layout', 'stacked');
  await atEnd();
  const subtitleAndBack = async () => {
    await resizeBy(page, parts, 's', -40);
    await expect(split).toHaveAttribute('data-call-transcript-layout', 'subtitle');
    await resizeBy(page, parts, 's', 40);
    await expect(split).toHaveAttribute('data-call-transcript-layout', 'stacked');
  };
  await subtitleAndBack();
  await atEnd();

  // Scrolled up, the transcript stays where the person left it. (The divider's focus went to the
  // window's handle while the divider was gone.)
  await divider.focus();
  await page.keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '25');
  const logBox = await boxOf(log);
  await page.mouse.move(logBox.x + logBox.width / 2, logBox.y + logBox.height / 2);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await scrollOf(log)).fromEnd).toBeGreaterThan(300);
  await twoFrames(page);
  const { top } = await scrollOf(log);
  const keptPlace = async () => {
    await twoFrames(page);
    expect((await scrollOf(log)).top).toBe(top);
  };
  await page.keyboard.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', '80');
  await keptPlace();
  await subtitleAndBack();
  await keptPlace();
});

test('the keys scroll the transcript after a click in it, and Tab reaches it', async ({ page }) => {
  const { pane, log, divider } = await openWindow(page, 400, 640);
  const end = (await scrollOf(log)).top;
  expect(end).toBeGreaterThan(0);

  // A click on a line, then Home and Page Up: the transcript scrolls, as a box the page scrolls in.
  await pane.locator('[data-live-transcript-text]').last().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('PageUp');
  await expect.poll(async () => (await scrollOf(log)).top).toBe(0);

  // The box itself takes the focus, named, and Tab reaches it from the divider before it.
  const transcript = pane.getByRole('group', { name: 'Live transcript' });
  await expect(transcript).toBeFocused();
  await divider.focus();
  await page.keyboard.press('Tab');
  await expect(transcript).toBeFocused();
  await page.keyboard.press('End');
  await expect.poll(async () => (await scrollOf(log)).fromEnd).toBeLessThan(2);
});
