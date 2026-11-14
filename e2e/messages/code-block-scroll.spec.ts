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
import { roomViewSwitch } from '../helpers/roomViewSwitch';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// A long code block starts collapsed to its first lines. It scrolls inside itself with the wheel,
// sideways when its lines do not wrap, and with the arrow keys once focused; the timeline around
// it stays put until the block reaches its end, and then takes the scroll. Expand shows the whole
// block in place. An agent sends the block the way the MindRoom backend renders a fence.
// Set E2E_SCREENSHOT_DIR to save the collapsed block at its top and scrolled.

const PASSWORD = 'code-block-scroll-password';
const SCREENSHOT = process.env.E2E_SCREENSHOT_DIR;

const codeLines = Array.from({ length: 200 }, (_, index) =>
  index % 10 === 3
    ? `export const wide${index} = describe('${'a line wider than the message column, '.repeat(
        5
      )}', ${index});`
    : `export const value${index}: number = compute(${index}, 'line ${index}');`
);
const code = codeLines.join('\n');
const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const codeMessage = {
  msgtype: 'm.text',
  body: `Here is the module:\n\n\`\`\`ts\n${code}\n\`\`\``,
  format: 'org.matrix.custom.html',
  formatted_body: `<p>Here is the module:</p>\n<pre><code class="language-ts">${escapeHtml(
    code
  )}\n</code></pre>\n`,
};

/** Signs in through the login page; a loaded machine can take a minute to show the shell. */
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

type ScrollState = {
  top: number;
  left: number;
  maxTop: number;
  maxLeft: number;
  timelineTop: number;
  timelineLeft: number;
};

/** The block's scroll position and that of the nearest ancestor that scrolls: the timeline. */
const readScroll = (scrollArea: Locator): Promise<ScrollState> =>
  scrollArea.evaluate((element) => {
    let timeline = element.parentElement;
    while (
      timeline &&
      !(
        /auto|scroll/.test(getComputedStyle(timeline).overflowY) &&
        timeline.scrollHeight > timeline.clientHeight
      )
    ) {
      timeline = timeline.parentElement;
    }
    return {
      top: element.scrollTop,
      left: element.scrollLeft,
      maxTop: element.scrollHeight - element.clientHeight,
      maxLeft: element.scrollWidth - element.clientWidth,
      timelineTop: timeline ? timeline.scrollTop : -1,
      timelineLeft: timeline ? timeline.scrollLeft : -1,
    };
  });

/** Reads the scroll state once a wheel scroll has come to rest. */
const settledScroll = async (scrollArea: Locator): Promise<ScrollState> => {
  let last = JSON.stringify(await readScroll(scrollArea));
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await readScroll(scrollArea));
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [150] }
    )
    .toBe(true);
  return JSON.parse(last) as ScrollState;
};

/** Puts the pointer over the middle of the block, and checks nothing lies on top of it there. */
const pointAtBlock = async (page: Page, scrollArea: Locator) => {
  await scrollArea.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const box = await scrollArea.boundingBox();
  if (!box) throw new Error('The code block has no box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  expect(
    await scrollArea.evaluate(
      (element, point) => element.contains(document.elementFromPoint(point.x, point.y)),
      { x, y }
    )
  ).toBe(true);
  await page.mouse.move(x, y);
};

/**
 * Wheels down over the block until it reaches its end: the block moves and the timeline does
 * not. At the end, the next wheel scrolls the timeline.
 */
const wheelThroughBlock = async (
  page: Page,
  scrollArea: Locator,
  onScrolled?: () => Promise<void>
) => {
  await pointAtBlock(page, scrollArea);
  const start = await settledScroll(scrollArea);
  expect(start.top).toBe(0);
  expect(start.maxTop).toBeGreaterThan(1000);
  expect(start.timelineTop, 'the timeline scrolls').toBeGreaterThanOrEqual(0);

  await page.mouse.wheel(0, 120);
  let state = await settledScroll(scrollArea);
  expect(state.top).toBeGreaterThan(0);
  expect(state.timelineTop).toBe(start.timelineTop);
  await onScrolled?.();

  for (let wheels = 0; state.top < state.maxTop - 1; wheels += 1) {
    expect(wheels, 'wheels to reach the end of the block').toBeLessThan(40);
    const before = state.top;
    await page.mouse.wheel(0, 480);
    state = await settledScroll(scrollArea);
    expect(state.top).toBeGreaterThan(before);
    expect(state.timelineTop).toBe(start.timelineTop);
  }

  // The block is at its end, so the scroll goes on to the timeline.
  await expect(async () => {
    await page.mouse.wheel(0, 120);
    expect((await settledScroll(scrollArea)).timelineTop).toBeGreaterThan(start.timelineTop);
  }).toPass({ timeout: 10_000 });
  expect((await readScroll(scrollArea)).top).toBeGreaterThanOrEqual(state.maxTop - 1);
};

test('a long code block scrolls inside itself in the room timeline and in a thread', async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const username = `codescroll_${Date.now().toString(36)}`;
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
    name: 'Code Block Scroll',
    topic: 'A long code block from an agent',
    invite: [helper.userId],
  });
  await joinRoom(HOMESERVER, helper.accessToken, roomId);
  const send = (accessToken: string, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, accessToken, roomId, content, 'code-block-scroll');

  const rootId = await send(token, { msgtype: 'm.text', body: 'Show me the module' });
  const inThread = {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  };
  const threadCodeId = await send(helper.accessToken, {
    ...codeMessage,
    'm.relates_to': inThread,
  });
  // Messages after each block leave the timeline room to scroll on past it.
  for (let index = 0; index < 15; index += 1) {
    await send(token, {
      msgtype: 'm.text',
      body: `Thread note ${index}`,
      'm.relates_to': inThread,
    });
  }
  const roomCodeId = await send(helper.accessToken, codeMessage);
  for (let index = 0; index < 15; index += 1) {
    await send(token, { msgtype: 'm.text', body: `Room note ${index}` });
  }

  await signIn(page, username);
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await expect(roomViewSwitch(page)).toBeVisible({ timeout: 30_000 });
  if ((await roomViewSwitch(page).getAttribute('aria-pressed')) === 'true') {
    await roomViewSwitch(page).click();
  }

  const row = (eventId: string) => page.locator(`[data-message-id="${eventId}"]`).first();
  const roomBlock = row(roomCodeId).locator('pre');
  // The code element's parent is the block's scroll area.
  const roomScroll = roomBlock.locator('code').first().locator('xpath=..');
  await expect(roomScroll).toContainText('value0', { timeout: 60_000 });
  await expect(roomBlock.getByRole('button', { name: 'Expand', exact: true })).toBeVisible();

  if (SCREENSHOT) {
    await pointAtBlock(page, roomScroll);
    await roomBlock.screenshot({ path: `${SCREENSHOT}/L14-code-block-scroll-top.png` });
  }
  await wheelThroughBlock(page, roomScroll, async () => {
    if (!SCREENSHOT) return;
    await page.mouse.wheel(0, 600);
    await settledScroll(roomScroll);
    await roomBlock.screenshot({ path: `${SCREENSHOT}/L14-code-block-scroll-scrolled.png` });
  });

  // The collapsed block is a keyboard stop with a name.
  await expect(row(roomCodeId).getByRole('region', { name: 'Code', exact: true })).toHaveAttribute(
    'tabindex',
    '0'
  );

  // Unwrapped lines scroll sideways under the wheel; the timeline does not move.
  await roomBlock.getByRole('button', { name: 'Wrap lines', exact: true }).click();
  await expect(roomBlock.getByRole('button', { name: 'Wrap lines', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await pointAtBlock(page, roomScroll);
  const unwrapped = await settledScroll(roomScroll);
  expect(unwrapped.maxLeft).toBeGreaterThan(100);
  expect(unwrapped.left).toBe(0);
  await page.mouse.wheel(240, 0);
  const sideways = await settledScroll(roomScroll);
  expect(sideways.left).toBeGreaterThan(0);
  expect(sideways.timelineTop).toBe(unwrapped.timelineTop);
  expect(sideways.timelineLeft).toBe(unwrapped.timelineLeft);

  // Focused, the block scrolls with the arrow keys.
  await roomScroll.evaluate((element) => element.scrollTo({ top: 0, left: 0 }));
  await row(roomCodeId).getByRole('region', { name: 'Code', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await readScroll(roomScroll)).top).toBeGreaterThan(0);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await readScroll(roomScroll)).left).toBeGreaterThan(0);

  // Expand shows the whole block where it is, and Collapse caps it again.
  await roomScroll.evaluate((element) => element.scrollTo({ top: 0, left: 0 }));
  await pointAtBlock(page, roomScroll);
  const beforeExpand = await settledScroll(roomScroll);
  const headerTop = (await roomBlock.boundingBox())?.y;
  await roomBlock.getByRole('button', { name: 'Expand', exact: true }).click();
  const collapse = roomBlock.getByRole('button', { name: 'Collapse', exact: true });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await readScroll(roomScroll)).maxTop).toBeLessThanOrEqual(1);
  const afterExpand = await settledScroll(roomScroll);
  expect(afterExpand.timelineTop).toBe(beforeExpand.timelineTop);
  expect(Math.abs(((await roomBlock.boundingBox())?.y ?? 0) - (headerTop ?? 0))).toBeLessThan(2);
  await collapse.click();
  await expect(roomBlock.getByRole('button', { name: 'Expand', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  await expect.poll(async () => (await readScroll(roomScroll)).maxTop).toBeGreaterThan(1000);

  // Copy still copies the whole block.
  await roomBlock.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect(roomBlock.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('value0: number');
  expect(copied).toContain('value199: number');

  // The same block in a thread.
  await page.goto(`/home/${encodeURIComponent(roomId)}/?threadId=${encodeURIComponent(rootId)}`);
  const threadScroll = row(threadCodeId).locator('pre code').first().locator('xpath=..');
  await expect(threadScroll).toContainText('value0', { timeout: 60_000 });
  await expect(
    row(threadCodeId).getByRole('region', { name: 'Code', exact: true })
  ).toHaveAttribute('tabindex', '0');
  await wheelThroughBlock(page, threadScroll);
});
