import { expect, test, type Page } from '@playwright/test';

// Every step of the interface tour on its fixture page (e2e/fixtures/tour.tsx), on a wide screen,
// on a small phone and in a right-to-left language: the part a step is about lies inside the
// stage, the four state cards are all in view, and the buttons stay in view where they are from
// step to step. Motion is reduced, so each step shows the end of its scene at once.

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

/** The frame that clips the stage's room. */
const frameOf = (page: Page): Promise<Box> =>
  page.locator('[data-tour-stage]').evaluate((room) => {
    const { x, y, width, height } = (room.parentElement as HTMLElement).getBoundingClientRect();
    return { x, y, width, height };
  });

const SCREENS = [
  { name: 'a wide screen', viewport: { width: 1280, height: 800 }, query: 'level=full' },
  { name: 'a small phone', viewport: { width: 375, height: 667 }, query: 'level=full' },
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
    await page.goto(`/e2e/fixtures/tour.html?${query}`);
    await page.locator('body[data-fixture-ready="true"]').waitFor();
    const dialog = page.locator('[data-tour-dialog]');
    await expect(dialog).toBeVisible();
    const screen: Box = { x: 0, y: 0, ...viewport };

    const mainButtons: Box[] = [];
    const seen: string[] = [];
    for (let at = 0; at < STEP_COUNT; at += 1) {
      const step = (await dialog.getAttribute('data-tour-step')) ?? '';
      seen.push(step);
      await expect(page.locator('[data-tour-stage][data-tour-settled]')).toBeVisible();
      const frame = await frameOf(page);
      expect(inside(frame, screen, 0), `${step}: the stage is on the screen`).toBe(true);

      // The part the step is about, under its ring, is not cut off by the stage.
      const ring = page.locator('[data-tour-spotlight]');
      if ((await ring.count()) > 0) {
        await expect
          .poll(async () => inside(await boxOf(page, '[data-tour-spotlight]'), frame), {
            message: `${step}: the spotlight lies inside the stage`,
          })
          .toBe(true);
        const ringBox = await boxOf(page, '[data-tour-spotlight]');
        expect(ringBox.width, `${step}: the spotlight has a size`).toBeGreaterThan(8);
        expect(ringBox.height, `${step}: the spotlight has a size`).toBeGreaterThan(8);
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
