import { expect, test, type Page } from '@playwright/test';

// An invented icon for the model, served for the fixture's `mxc://localhost/icon`.
const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#6b4fd8"/><circle cx="20" cy="20" r="10" fill="#fff"/></svg>';

// The logo and the bars against their button, whose size follows Page Zoom (the root font size).
const proportions = (page: Page, name: string) =>
  page.getByRole('button', { name }).evaluate((button) => {
    const box = button.getBoundingClientRect();
    const parts = [button.firstElementChild!, button.querySelector('[data-effort-glyph]')!];
    const [logo, bars] = parts.map((part) => part.getBoundingClientRect());
    const round = (value: number) => Math.round(value * 1000) / 1000;
    return {
      logo: round(logo.height / box.height),
      bars: round(bars.height / box.height),
      inside: [logo, bars].every(
        (rect) =>
          rect.left >= box.left &&
          rect.right <= box.right &&
          rect.top >= box.top &&
          rect.bottom <= box.bottom
      ),
    };
  });

// MODEL_ICON_SHOTS=<directory> also saves a screenshot at each zoom.
const measure = async (page: Page, zoom: number) => {
  await page.evaluate((percent) => {
    document.documentElement.style.fontSize = `${percent}%`;
  }, zoom);
  const look = {
    custom: await proportions(page, 'Custom icon'),
    mark: await proportions(page, 'Provider mark'),
  };
  if (process.env.MODEL_ICON_SHOTS) {
    await page.locator('main').screenshot({
      path: `${process.env.MODEL_ICON_SHOTS}/model-button-zoom-${zoom}.png`,
    });
  }
  return look;
};

test('the model button keeps its logo and effort bars in proportion at every Page Zoom', async ({
  page,
}) => {
  await page.route('**/_matrix/media/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: ICON })
  );
  await page.goto('/e2e/fixtures/model-icon-zoom.html');
  await expect(page.locator('img')).toHaveJSProperty('complete', true);

  const zoomedOut = await measure(page, 75);
  const zoomedIn = await measure(page, 150);
  // eslint-disable-next-line no-console
  console.log(`model button proportions: 75% ${JSON.stringify(zoomedOut)}, 150% ${JSON.stringify(zoomedIn)}`);
  expect(zoomedIn).toEqual(zoomedOut);
  expect(zoomedOut.custom.inside && zoomedOut.mark.inside).toBe(true);
});
