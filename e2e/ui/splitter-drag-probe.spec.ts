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
  const emulated = await page.evaluate(
    ([px, py]) => {
      const p = document.querySelector('main p')!;
      const style = getComputedStyle(p);
      const sel = window.getSelection()!;
      const a = document.caretRangeFromPoint(px - 400, py);
      const b = document.caretRangeFromPoint(px - 100, py + 60);
      let caret = 'null';
      if (a && b) {
        sel.setBaseAndExtent(a.startContainer, a.startOffset, b.startContainer, b.startOffset);
        caret = sel.toString();
      }
      sel.removeAllRanges();
      sel.selectAllChildren(document.querySelector('main')!);
      const all = sel.toString().length;
      sel.removeAllRanges();
      const ev = new Event('selectstart', { cancelable: true, bubbles: true });
      const selectstartAllowed = p.dispatchEvent(ev);
      return { userSelect: style.userSelect, webkitUserSelect: style.webkitUserSelect, caret, all, selectstartAllowed, aNode: a?.startContainer.nodeName };
    },
    [x + dx / 2, y + 10]
  );
  await page.mouse.move(x + dx, y + 20, { steps: 8 });
  await page.mouse.up();
  const after = (await panel.boundingBox())!.width;
  const result = await page.evaluate(() => ({
    selection: window.getSelection()?.toString() ?? '',
    log: [...new Set((window as unknown as { log: string[] }).log)],
  }));
  console.log(JSON.stringify({ browser: page.context().browser()?.browserType().name(), query, dx, before, during, after, emulated, ...result }));
};

for (const [query, dx] of [['', -300], ['', 200], ['?width=500', -300], ['?width=500', 200]] as const) {
  test(`probe ${query || 'widest'} ${dx} @webkit`, async ({ page }) => {
    await probe(page, query, dx);
  });
}
