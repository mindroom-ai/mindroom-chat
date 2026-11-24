import { expect, test, type Page } from '@playwright/test';

// Every step of the interface tour on its fixture page (e2e/fixtures/tour.tsx), on a wide screen,
// on a small phone (in English and in two languages of longer texts) and in a right-to-left
// language: the spotlight is around the part a step is about, which lies inside the stage, the
// four state cards are all in view, and the buttons stay in view where they are from step to
// step. Motion is reduced there, so each step shows the end of its scene at once; a last test
// plays a scene and checks the spotlight on a part only an early phase shows.

const STEP_COUNT = 12;

type Box = { x: number; y: number; width: number; height: number };

const boxOf = async (page: Page, selector: string): Promise<Box> => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return box;
};

/** Whether `inner` lies inside `outer`, give or take the ring's width. */
const inside = (inner: Box, outer: Box, slack = 3): boolean =>
  inner.x >= outer.x - slack &&
  inner.y >= outer.y - slack &&
  inner.x + inner.width <= outer.x + outer.width + slack &&
  inner.y + inner.height <= outer.y + outer.height + slack;

/**
 * The part each step's spotlight is around once its scene has played; none where the step is
 * about the whole list, or where what it was about has gone.
 */
const SPOTLIGHT: Record<string, string | undefined> = {
  conversation: 'card:budget',
  start: 'thread',
  reply: 'card:launch',
  title: 'title:launch',
  order: 'card:vendor',
  states: undefined,
  resolve: undefined,
  filters: 'filterUnresolved',
  snooze: 'menuSnooze',
  pinAndTag: 'card:budget',
  views: 'viewSwitch',
  activity: 'bell',
};

/** Whether the ring is around the part: outside it on every side, by a few px at most. */
const around = (ring: Box, part: Box): boolean =>
  inside(part, ring, 1) && ring.width - part.width <= 12 && ring.height - part.height <= 12;

/** Waits for the ring to rest around the part it names, and returns its box. */
const expectSpotlightOn = async (page: Page, part: string, step: string): Promise<Box> => {
  const ring = `[data-tour-spotlight="${part}"]`;
  const marked = `[data-tour-stage] [data-tour-part="${part}"]`;
  await expect(page.locator(ring), `${step}: the spotlight is on ${part}`).toHaveCount(1);
  await expect
    .poll(async () => around(await boxOf(page, ring), await boxOf(page, marked)), {
      message: `${step}: the spotlight is around ${part}`,
    })
    .toBe(true);
  return boxOf(page, ring);
};

/** The frame that clips the stage's room. */
const frameOf = (page: Page): Promise<Box> =>
  page.locator('[data-tour-stage]').evaluate((room) => {
    const { x, y, width, height } = (room.parentElement as HTMLElement).getBoundingClientRect();
    return { x, y, width, height };
  });

/**
 * Opens the fixture page and waits for the dialog in its own fonts: the page says it is ready
 * before the dialog has asked for them, and a font arriving between two steps would move what
 * the steps are compared by.
 */
const openTour = async (page: Page, query: string) => {
  await page.goto(`/e2e/fixtures/tour.html?${query}`);
  await page.locator('body[data-fixture-ready="true"]').waitFor();
  const dialog = page.locator('[data-tour-dialog]');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return dialog;
};

const SCREENS = [
  { name: 'a wide screen', viewport: { width: 1280, height: 800 }, query: 'level=full' },
  { name: 'a small phone', viewport: { width: 375, height: 667 }, query: 'level=full' },
  // Windows too low for the dialog at its full height: the stage gives way first, down to the
  // height of the room at its smallest scale, then the text scrolls.
  { name: 'a low wide window', viewport: { width: 1280, height: 600 }, query: 'level=full' },
  { name: 'a low phone', viewport: { width: 375, height: 550 }, query: 'level=full' },
  // The app's page zoom scales the root font size, and the room with it.
  {
    name: 'a page zoomed to 150 %',
    viewport: { width: 1280, height: 1000 },
    query: 'level=full&zoom=150',
  },
  {
    name: 'a phone zoomed to 150 %',
    viewport: { width: 375, height: 667 },
    query: 'level=full&zoom=150',
  },
  // Languages whose texts run longer than the English ones.
  {
    name: 'a small phone in German',
    viewport: { width: 375, height: 667 },
    query: 'level=full&lang=de',
  },
  {
    name: 'a small phone in Russian',
    viewport: { width: 375, height: 667 },
    query: 'level=full&lang=ru',
  },
  {
    name: 'a right-to-left language',
    viewport: { width: 1280, height: 800 },
    query: 'level=full&lang=ar',
  },
] as const;

SCREENS.forEach(({ name, viewport, query }) => {
  test(`every step of the tour fits ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const dialog = await openTour(page, query);
    const screen: Box = { x: 0, y: 0, ...viewport };

    const mainButtons: Box[] = [];
    const seen: string[] = [];
    for (let at = 0; at < STEP_COUNT; at += 1) {
      const step = (await dialog.getAttribute('data-tour-step')) ?? '';
      seen.push(step);
      await expect(page.locator('[data-tour-stage][data-tour-settled]')).toBeVisible();
      const frame = await frameOf(page);
      expect(inside(frame, screen, 0), `${step}: the stage is on the screen`).toBe(true);

      // The part the step is about has the ring around it and is not cut off by the stage. A
      // phone's view switch is in its room menu, which has closed again by the scene's end.
      const part = step === 'views' && viewport.width < 600 ? undefined : SPOTLIGHT[step];
      if (part) {
        const ring = await expectSpotlightOn(page, part, step);
        expect(inside(ring, frame), `${step}: the spotlight lies inside the stage`).toBe(true);
      } else {
        await expect(page.locator('[data-tour-spotlight]'), `${step}: no spotlight`).toHaveCount(0);
      }

      if (step === 'states') {
        const cards = page.locator('[data-tour-stage] [data-thread-root-id]');
        await expect(cards).toHaveCount(4);
        const boxes = await cards.evaluateAll((elements) =>
          elements.map((element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
          })
        );
        boxes.forEach((box, index) =>
          expect(inside(box, frame), `states: card ${index + 1} is in view`).toBe(true)
        );
      }

      if (step === 'snooze') {
        const menuBox = await boxOf(page, '[data-tour-card-menu]');
        expect(inside(menuBox, frame), `${name} snooze: card menu lies inside stage`).toBe(true);
      }

      if (step === 'activity') {
        const panelBox = await boxOf(page, '[data-tour-activity]');
        expect(inside(panelBox, frame), `${name} activity: panel lies inside stage`).toBe(true);
        const rows = page.locator('[data-tour-activity-row]');
        const rowCount = await rows.count();
        expect(rowCount, `${name} activity: renders rows`).toBeGreaterThanOrEqual(2);
        const rowBoxes = await rows.evaluateAll((elements) =>
          elements.map((element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
          })
        );
        rowBoxes.forEach((box, index) => {
          expect(
            inside(box, panelBox, 1),
            `${name} activity: row ${index + 1} lies inside activity panel/sheet`
          ).toBe(true);
          expect(
            inside(box, frame, 1),
            `${name} activity: row ${index + 1} lies inside stage`
          ).toBe(true);
        });
        const panelMetrics = await page.locator('[data-tour-activity]').evaluate((panel) => {
          const header = panel.querySelector('header');
          return {
            overflow: getComputedStyle(panel).overflow,
            clippedVertically: panel.scrollHeight > panel.clientHeight,
            headerPaddingInlineStart: header
              ? Number.parseFloat(getComputedStyle(header).paddingInlineStart)
              : null,
          };
        });
        expect(
          panelMetrics.clippedVertically,
          `${name} activity: sheet/panel does not clip vertically`
        ).toBe(false);
        if (viewport.width < 600) {
          expect(
            panelMetrics.headerPaddingInlineStart ?? 0,
            `${name} activity: phone sheet title is inset from start edge`
          ).toBeGreaterThanOrEqual(8);
        } else {
          expect(
            panelMetrics.overflow,
            `${name} activity: desktop panel does not clip menu corners/shadow`
          ).not.toBe('hidden');
        }
      }

      // The step's title and the main button are on the screen.
      const main = await boxOf(page, '[data-tour-action="next"], [data-tour-action="done"]');
      expect(inside(main, screen, 0), `${step}: the main button is on the screen`).toBe(true);
      mainButtons.push(main);
      await expect(dialog.getByRole('heading', { level: 3 })).toBeInViewport();

      if (at < STEP_COUNT - 1) await page.locator('[data-tour-action="next"]').click();
    }
    expect(new Set(seen).size).toBe(STEP_COUNT);
    await expect(page.locator('[data-tour-action="done"]')).toBeVisible();

    // Next keeps its place from step to step, so a pointer resting on it goes through the tour:
    // the same row, and the same edge at the end of the line (Done is a little narrower).
    const [first] = mainButtons;
    if (!first) throw new Error('no step was seen');
    const endEdge = (box: Box) => (query.includes('lang=ar') ? box.x : box.x + box.width);
    mainButtons.forEach((box, index) => {
      expect(Math.abs(box.y - first.y), `step ${index + 1}: same row`).toBeLessThanOrEqual(1);
      expect(
        Math.abs(endEdge(box) - endEdge(first)),
        `step ${index + 1}: same edge`
      ).toBeLessThanOrEqual(1);
    });
  });
});

test('the spotlight is on the check of a card while the scene of Resolve plays', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // The page's clock stands still, so a scene stays in its first phase however long the
  // measuring takes, and goes on only when the test says so.
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1_000);
  const dialog = await openTour(page, 'level=full');
  const stage = page.locator('[data-tour-stage]');
  // Straight to the seventh step, whose first phase shows the card's buttons.
  for (let at = 1; at < 7; at += 1) await page.locator('[data-tour-action="next"]').click();
  await expect(dialog).toHaveAttribute('data-tour-step', 'resolve');
  await expect(stage).toHaveAttribute('data-tour-phase', '0');
  // The buttons sit over the card's end, centered on it, and the ring has to find them there.
  await expectSpotlightOn(page, 'resolveButton', 'resolve');

  // The scene goes on: the card is marked resolved, with the ring around the whole card.
  await page.clock.runFor(2_000);
  await expect(stage).toHaveAttribute('data-tour-phase', '1');
  await expectSpotlightOn(page, 'card:vendor', 'resolve');
});

const verifySnoozeAndPinAndTag = async (
  page: Page,
  name: string,
  query: string,
  phase0Part: 'pinButton' | 'menuPin'
) => {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1_000);
  const dialog = await openTour(page, query);
  const stage = page.locator('[data-tour-stage]');

  // Advance to Step 9 (`snooze`) and verify menuSnooze inside stage.
  for (let at = 1; at < 9; at += 1) await page.locator('[data-tour-action="next"]').click();
  await expect(dialog).toHaveAttribute('data-tour-step', 'snooze');
  const frame = await frameOf(page);
  await page.clock.runFor(1_500);
  await expect(stage).toHaveAttribute('data-tour-phase', '1');
  const snoozeRing = await expectSpotlightOn(page, 'menuSnooze', `snooze ${name} p1`);
  expect(inside(snoozeRing, frame), `${name} snooze p1: spotlight inside stage`).toBe(true);
  const snoozeMenuBox = await boxOf(page, '[data-tour-card-menu]');
  expect(inside(snoozeMenuBox, frame), `${name} snooze p1: menu inside stage`).toBe(true);

  // Advance to Step 10 (`pinAndTag`).
  await page.locator('[data-tour-action="next"]').click();
  await expect(dialog).toHaveAttribute('data-tour-step', 'pinAndTag');

  // Phase 0: pinButton (desktop hover) or menuPin inside Thread options (phone / touch tablet).
  await expect(stage).toHaveAttribute('data-tour-phase', '0');
  const ring0 = await expectSpotlightOn(page, phase0Part, `pinAndTag ${name} p0`);
  expect(inside(ring0, frame), `${name} p0: spotlight inside stage`).toBe(true);
  if (phase0Part === 'menuPin') {
    await expect(page.locator('[data-tour-stage] [data-tour-part="pinButton"]')).toHaveCount(0);
    const menuBox = await boxOf(page, '[data-tour-card-menu]');
    expect(inside(menuBox, frame), `${name} p0: menu inside stage`).toBe(true);
  }

  // Phase 1: Pinned section (450ms start delay + 1200ms phase 0).
  await page.clock.runFor(1_700);
  await expect(stage).toHaveAttribute('data-tour-phase', '1');
  const ring1 = await expectSpotlightOn(page, 'pinnedSection', `pinAndTag ${name} p1`);
  expect(inside(ring1, frame), `${name} p1: spotlight inside stage`).toBe(true);

  // Phase 2: Edit tags in Thread options (1100ms phase 1).
  await page.clock.runFor(1_150);
  await expect(stage).toHaveAttribute('data-tour-phase', '2');
  const ring2 = await expectSpotlightOn(page, 'menuTags', `pinAndTag ${name} p2`);
  expect(inside(ring2, frame), `${name} p2: spotlight inside stage`).toBe(true);
  const menu2Box = await boxOf(page, '[data-tour-card-menu]');
  expect(inside(menu2Box, frame), `${name} p2: menu inside stage`).toBe(true);

  // Phase 3: settled — pinned and tagged (1200ms phase 2).
  await page.clock.runFor(1_250);
  await expect(stage).toHaveAttribute('data-tour-phase', '3');
  const ring3 = await expectSpotlightOn(page, 'card:budget', `pinAndTag ${name} p3`);
  expect(inside(ring3, frame), `${name} p3: spotlight inside stage`).toBe(true);
};

for (const screen of [
  {
    name: 'desktop',
    viewport: { width: 1280, height: 800 },
    query: 'level=full',
    phase0Part: 'pinButton',
  },
  {
    name: 'phone',
    viewport: { width: 375, height: 667 },
    query: 'level=full',
    phase0Part: 'menuPin',
  },
  {
    name: 'low phone',
    viewport: { width: 375, height: 550 },
    query: 'level=full',
    phase0Part: 'menuPin',
  },
  {
    name: 'phone zoomed to 150 %',
    viewport: { width: 375, height: 667 },
    query: 'level=full&zoom=150',
    phase0Part: 'menuPin',
  },
] as const) {
  test(`snooze and pinAndTag spotlight every phase inside the stage on ${screen.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(screen.viewport);
    await verifySnoozeAndPinAndTag(page, screen.name, screen.query, screen.phase0Part);
  });
}

test('touch tablet (820×1180, hover: none) uses desktop chrome with menuPin in pinAndTag Phase 0', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await page.goto('/e2e/fixtures/tour.html?level=full');
    const media = await page.evaluate(() => ({
      noHover: window.matchMedia('(hover: none)').matches,
      coarse: window.matchMedia('(pointer: coarse)').matches,
    }));
    expect(media.noHover, 'touch tablet emulates (hover: none)').toBe(true);
    expect(media.coarse, 'touch tablet emulates (pointer: coarse)').toBe(true);

    await verifySnoozeAndPinAndTag(page, 'touch tablet', 'level=full', 'menuPin');

    // Still uses wide room chrome (desktop header with view switch, not phone room menu).
    await expect(page.locator('[data-tour-header] [data-room-view-switch]')).toBeVisible();
  } finally {
    await context.close();
  }
});
