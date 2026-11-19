import { expect, test, type Page } from '@playwright/test';

const probe = async (page: Page, query: string, dx: number) => {
  await page.goto(`/e2e/fixtures/splitter-drag.html${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const panel = page.getByTestId('example-panel');
  const splitter = page.getByRole('separator', { name: 'Resize Example panel' });
  await expect(splitter).toBeVisible();
  await page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { log: string[] }).log = log;
    for (const type of ['pointerdown', 'pointercancel', 'lostpointercapture', 'gotpointercapture', 'pointerup', 'selectstart', 'mousedown', 'dragstart']) {
      document.addEventListener(type, (event) => log.push(`${type}${event.defaultPrevented ? '!' : ''}`), true);
    }
  });
  const before = (await panel.boundingBox())!.width;
  const box = (await splitter.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 100;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + 10, { steps: 8 });
  const during = (await panel.boundingBox())!.width;
  await page.mouse.move(x + dx, y + 20, { steps: 8 });
  await page.mouse.up();
  const after = (await panel.boundingBox())!.width;
  const result = await page.evaluate(() => ({
    selection: window.getSelection()?.toString() ?? '',
    log: [...new Set((window as unknown as { log: string[] }).log)],
  }));
  console.log(JSON.stringify({ browser: page.context().browser()?.browserType().name(), query, dx, before, during, after, ...result }));
};

for (const [query, dx] of [['', -300], ['', 200], ['?width=500', -300], ['?width=500', 200]] as const) {
  test(`probe ${query || 'widest'} ${dx} @webkit`, async ({ page }) => {
    await probe(page, query, dx);
  });
}
