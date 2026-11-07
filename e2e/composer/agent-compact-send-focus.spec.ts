import { composer, expect, openLobby, test, uniqueWord, waitForThreadEvent } from '../helpers/agentStack';

// DIAG scratch: a send from the lobby's Compact cards on a phone, then the agents answer.
test.describe.configure({ timeout: 300_000 });

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1';

const diag = () => {
  const log: string[] = [];
  (window as unknown as { __diag: string[] }).__diag = log;
  const start = performance.now();
  const at = () => Math.round(performance.now() - start);
  const name = (t: Element | null) =>
    t ? `${t.tagName} ${t.getAttribute('data-editable-name') ?? t.getAttribute('aria-label') ?? ''}` : 'none';
  document.addEventListener('focusin', (e) => log.push(`${at()} focusin ${name(e.target as Element)}`), true);
  document.addEventListener('focusout', (e) => log.push(`${at()} focusout ${name(e.target as Element)}`), true);
  const watch = () =>
    new MutationObserver((records) =>
      records.forEach((r) =>
        r.removedNodes.forEach((n) => {
          if (n instanceof HTMLElement && (n.matches('[data-editable-name="RoomInput"]') || n.querySelector('[data-editable-name="RoomInput"]')))
            log.push(`${at()} removed editable within ${n.tagName}.${n.className}`);
        })
      )
    ).observe(document.body, { childList: true, subtree: true });
  if (document.body) watch();
  else document.addEventListener('DOMContentLoaded', watch);
  let last = '';
  const poll = () => {
    const a = name(document.activeElement);
    if (a !== last) log.push(`${at()} active ${a}`);
    last = a;
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
};

for (const ua of ['default', 'iphone'] as const) {
  test.describe(`phone ${ua}`, () => {
    test.use({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      ...(ua === 'iphone' ? { userAgent: IPHONE_SAFARI } : {}),
    });
    test(`a send from the Compact cards keeps the focus (${ua})`, { tag: '@webkit' }, async ({ page, stack }) => {
      await page.addInitScript(diag);
      await openLobby(page, stack);
      await expect(page.locator('[data-compact-room-view="true"]')).toBeVisible({ timeout: 60_000 });
      await composer(page).tap();
      await expect(composer(page)).toBeFocused();
      const word = uniqueWord('focus');
      await page.keyboard.type(`${word} hello there`);
      await page.evaluate(() => ((window as unknown as { __diag: string[] }).__diag.length = 0));
      await page.getByRole('button', { name: 'Send message' }).tap();
      await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
      const states: string[] = [];
      for (let i = 0; i < 20; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        states.push(await page.evaluate(() => document.activeElement?.tagName ?? 'none'));
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(500);
      }
      const url = page.url();
      const rootId = decodeURIComponent(/threadId=([^&]+)/.exec(url)?.[1] ?? '');
      console.log(`root ${rootId} states ${states.join(',')}`);
      if (rootId.startsWith('$'))
        await waitForThreadEvent(stack, rootId, (event) => event.sender !== stack.tester.userId, {
          description: 'an agent reply',
        }).catch(() => undefined);
      await page.waitForTimeout(3_000);
      const log = await page.evaluate(() => (window as unknown as { __diag: string[] }).__diag);
      console.log(`DIAG ${ua}:\n${log.join('\n')}`);
      await expect(composer(page)).toBeFocused();
    });
  });
}
