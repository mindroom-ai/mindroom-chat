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
