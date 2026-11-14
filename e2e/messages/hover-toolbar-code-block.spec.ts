import { expect, test, type Locator, type Page } from '@playwright/test';
import { activeAccountButtonNamePattern } from '../helpers/auth';
import { buildLoginPath } from '../env';
import {
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
} from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// In a thread, a reply that continues the one above shows no sender line, and one that starts
// with a code block has the block's Wrap lines, Expand and Copy code buttons at the top of its
// row. When that row's top is under the room header and the thread's banner, its hover toolbar
// moves down into the row; it must not land on those buttons, nor go back under the header. Set
// E2E_SCREENSHOT_DIR to save the row at each scroll position.

const PASSWORD = 'hover-toolbar-code-block-password';
const SCREENSHOT = process.env.E2E_SCREENSHOT_DIR;
const BUTTONS = ['Wrap lines', 'Expand', 'Copy code'];

const code = Array.from(
  { length: 60 },
  (_, index) => `export const value${index} = compute(${index});`
).join('\n');
const codeMessage = {
  msgtype: 'm.text',
  body: `\`\`\`ts\n${code}\n\`\`\``,
  format: 'org.matrix.custom.html',
  formatted_body: `<pre><code class="language-ts">${code}\n</code></pre>\n`,
};

const signIn = async (page: Page, username: string) => {
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(HOMESERVER, {
    timeout: 60_000,
  });
  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByRole('button', { name: activeAccountButtonNamePattern })).toBeVisible({
    timeout: 120_000,
  });
};

/**
 * Whether something else in the button's row, its hover toolbar, lies over the middle of `button`
 * and takes its click. The room header and the thread's banner are outside the row.
 */
const coveredInRow = async (button: Locator, row: Locator): Promise<boolean> => {
  const box = await button.boundingBox();
  if (!box) return false;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const hits = (element: Element, at: typeof point) =>
    element.contains(document.elementFromPoint(at.x, at.y));
  return (await row.evaluate(hits, point)) && !(await button.evaluate(hits, point));
};

test('the hover toolbar keeps off the code block buttons of a row without a sender line', async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1280, height: 800 });

  const username = `hovercode_${Date.now().toString(36)}`;
  const { access_token: token } = await matrixFetch<{ access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  const helper = await registerAgentAccount(HOMESERVER, 'helper');
  const roomId = await createPrivateRoom(HOMESERVER, token, {
    name: 'Hover Toolbar Code',
    topic: 'A code block that continues a message',
    invite: [helper.userId],
  });
  await joinRoom(HOMESERVER, helper.accessToken, roomId);
  const send = (accessToken: string, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, accessToken, roomId, content, 'hover-toolbar-code-block');
  const rootId = await send(token, { msgtype: 'm.text', body: 'Show me the module' });
  const inThread = {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  };
  for (let index = 0; index < 12; index += 1) {
    await send(token, {
      msgtype: 'm.text',
      body: `Earlier note ${index}`,
      'm.relates_to': inThread,
    });
  }
  await send(helper.accessToken, {
    msgtype: 'm.text',
    body: 'Here is the module:',
    'm.relates_to': inThread,
  });
  const codeId = await send(helper.accessToken, { ...codeMessage, 'm.relates_to': inThread });
  // Enough after it for the timeline to scroll the row up under the header.
  for (let index = 0; index < 40; index += 1) {
    await send(token, { msgtype: 'm.text', body: `Later note ${index}`, 'm.relates_to': inThread });
  }

  await signIn(page, username);
  await page.goto(`/home/${encodeURIComponent(roomId)}/?threadId=${encodeURIComponent(rootId)}`);

  const row = page.locator(`[data-message-id="${codeId}"]`).first();
  const block = row.locator('pre');
  await expect(block.getByRole('button', { name: 'Expand', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  // The row continues the message above: no sender line.
  await expect(row.locator('[data-message-sender-line]')).toHaveCount(0);

  // The row's top 60 px below the header's lower edge (the timeline's scroll padding), where the
  // toolbar keeps its usual place above the row, at that edge, then 10 to 50 px under it.
  const blocked: string[] = [];
  for (const under of [-60, 0, 10, 20, 30, 40, 50]) {
    // Scrolled until the row is there: the timeline may still settle after a jump.
    let covered = 0;
    await expect(async () => {
      covered = await row.evaluate((element, by) => {
        let scroller = element.parentElement;
        while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
          scroller = scroller.parentElement;
        }
        if (!scroller) throw new Error('The row has no scroller');
        const line =
          scroller.getBoundingClientRect().top +
          Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop);
        scroller.scrollBy({
          top: element.getBoundingClientRect().top - line + by,
          behavior: 'instant',
        });
        return line;
      }, under);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      );
      const rowTop = (await row.boundingBox())?.y ?? 0;
      expect(Math.abs(rowTop - (covered - under))).toBeLessThan(1);
    }, 'the timeline scrolls the row under the header').toPass({ timeout: 15_000 });
    const box = await block.boundingBox();
    if (!box) throw new Error('The code block has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 200));
    const reply = row.locator('button[aria-label="Reply"]');
    await expect(reply).toBeVisible();
    // Let the placement settle after the scroll.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    // The toolbar stays below the header.
    const bar = await reply.evaluate(
      (element) => element.parentElement!.getBoundingClientRect().top
    );
    expect(bar, `the toolbar's top at ${under} px`).toBeGreaterThanOrEqual(covered - 1);
    for (const name of BUTTONS) {
      const button = block.getByRole('button', { name, exact: true });
      if (await coveredInRow(button, row)) blocked.push(`${name} at ${under} px`);
    }
    if (SCREENSHOT) {
      await page.screenshot({
        path: `${SCREENSHOT}/hover-toolbar-code-block-${under}.png`,
        clip: { x: 0, y: 0, width: 1280, height: 400 },
      });
    }
  }
  expect(blocked).toEqual([]);

  // Expand and Copy code take a click.
  await block.getByRole('button', { name: 'Expand', exact: true }).click({ timeout: 5_000 });
  await expect(block.getByRole('button', { name: 'Collapse', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  await block.getByRole('button', { name: 'Copy code', exact: true }).click({ timeout: 5_000 });
  await expect(block.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
});
