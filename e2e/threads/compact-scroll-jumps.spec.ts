/* eslint-disable no-await-in-loop -- replay user scroll and thread-open actions sequentially. */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  disposableHomeserverIsUp,
  registerDisposableUser,
  DISPOSABLE_HOMESERVER as hs,
} from '../helpers/disposableAccounts';
import {
  COMPACT,
  LIVE,
  installListRecorder,
  takeFrames,
  type ListFrame,
} from '../helpers/listRecorder';
import {
  createDefaultThreadFilterState,
  joinRoom,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

const password = 'compact-jumps-repro-only';

const settleView = () =>
  new Promise<void>((resolve, reject) => {
    let previous: ListFrame | undefined;
    let stable = 0;
    const deadline = performance.now() + 6000;
    const tick = () => {
      const sample = window.compactRecorder.last;
      if (sample && sample !== previous) {
        stable =
          previous &&
          previous.view === sample.view &&
          Math.abs(previous.y - sample.y) < 0.5 &&
          !sample.moving &&
          !sample.pending
            ? stable + 1
            : 0;
        previous = sample;
      }
      if (stable >= 5) resolve();
      else if (performance.now() > deadline) reject(Error('Compact scroller did not settle'));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

const formatWrites = (frame: ListFrame) =>
  frame.writes
    .map(
      (w) =>
        `${w.method}(req=${w.requested ?? ''}) ${w.before.toFixed(1)}->${w.after.toFixed(1)} @ ${
          w.stack.split('\n')[0] ?? ''
        }`
    )
    .join('; ');

type SeededRoom = {
  roomId: string;
  rootPath: string;
  roots: string[];
  send: (body: string, root?: string) => Promise<string>;
};

const seedLongCompactRoom = async (
  page: Page,
  options: { threadCount?: number; longTitles?: boolean; layout?: 'beside' | 'full' } = {}
): Promise<SeededRoom> => {
  const { threadCount = 65, longTitles = false, layout = 'beside' } = options;
  const suffix = randomUUID().slice(0, 8);
  const reader = await registerDisposableUser(`repro_${suffix}`, password);
  const agent = await registerAgentAccount(hs, `reproagent_${suffix}`);
  const roomId = await createRoom(hs, reader.accessToken, {
    name: 'Compact Jump Repro Room',
    invite: [agent.userId],
  });
  await joinRoom(hs, agent.accessToken, roomId);

  const send = async (body: string, root?: string) =>
    sendRoomMessage(hs, root ? agent.accessToken : reader.accessToken, roomId, {
      msgtype: 'm.text',
      body,
      'm.relates_to': root
        ? {
            rel_type: 'm.thread',
            event_id: root,
            is_falling_back: true,
            'm.in_reply_to': { event_id: root },
          }
        : undefined,
    });

  const roots: string[] = [];
  for (let i = 0; i < threadCount; i += 1) {
    const extra = longTitles
      ? ' - Long descriptive title that stays on one line when wide and wraps onto two or three lines when a thread column opens beside the list'
      : '';
    const root = await send(`Thread #${i}${extra}`);
    await send(`Reply #${i}`, root);
    roots.push(root);
  }

  const rootPath = `/home/${encodeURIComponent(roomId)}`;
  await loginWithPassword(page, { homeserver: hs, username: reader.username, password });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.addInitScript(
    ({ user, threadLayout }) => {
      localStorage.setItem('mindroom.threadColumn.layout', JSON.stringify(threadLayout));
      localStorage.setItem(`compactRoomSections:${user}`, JSON.stringify({ on: false, folded: [] }));
    },
    { user: reader.userId, threadLayout: layout }
  );
  await installListRecorder(page);
  await page.goto(rootPath);

  const view = page.locator(`${COMPACT}${LIVE}:not([data-thread-board-column] *)`);
  await expect(view.locator('[data-scroll-anchor]').first()).toBeAttached({ timeout: 30_000 });
  await page.evaluate(settleView);
  return { roomId, rootPath, roots, send };
};

const compactView = (page: Page) =>
  page.locator(`${COMPACT}${LIVE}:not([data-thread-board-column] *)`);

const wheelBurst = async (page: Page, steps: number, dy: number) => {
  const rect = await compactView(page).boundingBox();
  if (!rect) throw Error('Compact scroller not visible');
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(16);
  }
};

test.describe('Compact scroll jump reproductions (expected to fail on main)', () => {
  test('1A: live re-sort from below viewport jumps scrolled-down list (WebKit resets to 0, Chromium shifts +90px) @webkit', async ({
    page,
    browserName,
  }) => {
    test.setTimeout(120_000);
    test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver not running');
    await page.setViewportSize({ width: 1440, height: 900 });

    const { send } = await seedLongCompactRoom(page);
    await wheelBurst(page, 12, 220);
    await page.evaluate(settleView);
    await page.mouse.move(8, 8);
    await page.waitForTimeout(800); // > MOUSE_REST_HOLD_MS (700 ms)

    const before = (await takeFrames(page)).at(-1)!;
    const belowKey = before.order.at(-2)![0];
    await send('Live reply re-sorting older thread to top while scrolled down', belowKey);
    await page.waitForTimeout(900);
    const frames = [before, ...(await takeFrames(page))];
    const after = frames.at(-1)!;

    const beforeMap = new Map(before.visible.map((r) => [r.key, r]));
    const surviving = after.visible.find((r) => beforeMap.has(r.key));
    const topShift = surviving ? Math.abs(surviving.top - beforeMap.get(surviving.key)!.top) : 9999;

    expect(
      after.y,
      `[${browserName}] scrollTop jumped ${before.y}->${after.y} (reatt=${Math.max(
        ...frames.map((f) => f.reattached.length)
      )}, writes=${frames.map(formatWrites).filter(Boolean).join(' | ') || 'none'})`
    ).toBeGreaterThan(before.y - 200);
    expect(
      topShift,
      `[${browserName}] visible anchor jumped by ${topShift.toFixed(1)}px (y: ${before.y}->${
        after.y
      })`
    ).toBeLessThanOrEqual(2);
  });

  test('1B: fast scroll up in WebKit fails to anchor non-parent card height growth above viewport @webkit', async ({
    page,
    browserName,
  }) => {
    test.setTimeout(120_000);
    test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver not running');
    test.skip(browserName !== 'webkit', 'WebKit scroll fallback bug (Chromium anchors natively)');
    await page.setViewportSize({ width: 1440, height: 900 });

    await seedLongCompactRoom(page);
    await wheelBurst(page, 16, 220);
    await page.evaluate(settleView);
    await takeFrames(page);

    // Non-parent-commit card height growth above viewport (e.g. memoized card child / badge / font reflow)
    // lands mid-scroll-up; useCompactScrollFallback only runs on CompactRoomView commits.
    const growAbove = compactView(page).evaluate(async (el) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      const cards = [...el.querySelectorAll<HTMLElement>('[data-scroll-anchor]')];
      for (const idx of [2, 5, 8]) {
        const card = cards[idx];
        if (card) card.style.paddingBottom = '60px';
      }
    });
    await wheelBurst(page, 10, -140);
    await growAbove;
    await page.waitForTimeout(400);
    const frames = await takeFrames(page);

    // Compare expected visual shift (-dy) against actual visual shift (painted delta):
    // when cards above grow by +180px without scrollTop compensation, (paintD + dy) jumps by +180px.
    const uncompensatedJumps: string[] = [];
    for (let i = 1; i < frames.length; i += 1) {
      const prev = frames[i - 1]!;
      const cur = frames[i]!;
      const prevMap = new Map(prev.visible.map((r) => [r.key, r]));
      const common = cur.visible.find((r) => prevMap.has(r.key));
      if (!common) continue;
      const dy = cur.y - prev.y;
      const paintD = common.painted - prevMap.get(common.key)!.painted;
      const uncompensated = paintD + dy;
      if (Math.abs(uncompensated) > 10) {
        uncompensatedJumps.push(
          `f${i}: uncompensated=${uncompensated.toFixed(1)}px (dy=${dy.toFixed(
            1
          )}, paintD=${paintD.toFixed(1)}, sh=${prev.scrollHeight}->${cur.scrollHeight}, writes=${
            cur.writes.length
          })`
        );
      }
    }

    expect(
      uncompensatedJumps,
      `[webkit] uncompensated card height growth during fast scroll up: ${uncompensatedJumps.join(
        '; '
      )}`
    ).toEqual([]);
  });

  test('2A: opening a thread beside the Compact list jumps visible cards (inset bounce + under-header anchor) @webkit', async ({
    page,
    browserName,
  }) => {
    test.setTimeout(120_000);
    test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver not running');
    // 1600px wide so long titles are 1 line when wide and wrap onto 2 lines when thread opens beside.
    await page.setViewportSize({ width: 1600, height: 900 });

    await seedLongCompactRoom(page, { longTitles: true, layout: 'beside' });
    await compactView(page).evaluate((el) => {
      el.scrollTop = 2600;
    });
    await page.evaluate(settleView);
    const before = (await takeFrames(page)).at(-1)!;
    const clicked = before.visible[Math.min(2, before.visible.length - 1)]!;

    await compactView(page).locator(`[data-thread-root-id="${clicked.key}"]${LIVE}`).click();
    await expect(page).toHaveURL(/threadId=/);
    await page.waitForTimeout(900);
    const frames = [before, ...(await takeFrames(page))];
    const after = frames.at(-1)!;

    const padBounceJumps: string[] = [];
    for (let i = 1; i < frames.length; i += 1) {
      const prev = frames[i - 1]!;
      const cur = frames[i]!;
      const padD = cur.paddingTop - prev.paddingTop;
      const prevMap = new Map(prev.visible.map((r) => [r.key, r]));
      const common = cur.visible.find((r) => prevMap.has(r.key));
      const paintD = common ? common.painted - prevMap.get(common.key)!.painted : 0;
      if (Math.abs(padD) >= 5 && Math.abs(paintD) >= 5) {
        padBounceJumps.push(
          `f${i}: pad ${prev.paddingTop}->${cur.paddingTop} paintD=${paintD.toFixed(1)}px`
        );
      }
    }

    const afterClicked = after.visible.find((r) => r.key === clicked.key);
    const clickedShift = afterClicked ? Math.abs(afterClicked.top - clicked.top) : 9999;

    expect(padBounceJumps, `[${browserName}] uncompensated header/filter inset jumps`).toEqual([]);
    expect(
      clickedShift,
      `[${browserName}] clicked card jumped ${clickedShift.toFixed(1)}px (${clicked.top.toFixed(
        1
      )}->${afterClicked?.top.toFixed(1) ?? 'OFFSCREEN'}, w=${before.width}->${after.width})`
    ).toBeLessThanOrEqual(10);
  });

  test('2B: opening a thread beside list releases hover-held re-sort (React restoreSelection writes scrollTop=0 in Chromium) @webkit', async ({
    page,
    browserName,
  }) => {
    test.setTimeout(120_000);
    test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver not running');
    await page.setViewportSize({ width: 1440, height: 900 });

    const { roots, send } = await seedLongCompactRoom(page, { layout: 'beside' });
    await wheelBurst(page, 24, 240);
    await page.evaluate(settleView);
    const before = (await takeFrames(page)).at(-1)!;
    const target = before.visible[Math.min(2, before.visible.length - 1)]!;
    const targetCard = compactView(page).locator(`[data-thread-root-id="${target.key}"]${LIVE}`);

    await targetCard.hover();
    await send('Held live reply released when moving pointer to opened thread', roots[4]);
    await page.waitForTimeout(400);
    await takeFrames(page);

    await targetCard.click();
    await expect(page).toHaveURL(/threadId=/);
    await page.mouse.move(1250, 450);
    await page.waitForTimeout(900);
    const frames = [before, ...(await takeFrames(page))];
    const after = frames.at(-1)!;

    expect(
      after.y,
      `[${browserName}] scrollTop jumped ${before.y}->${after.y} writes=${frames
        .map(formatWrites)
        .filter(Boolean)
        .join(' | ')}`
    ).toBeGreaterThan(before.y - 200);
    expect(
      frames.some((f) => f.reattached.length > 10),
      `[${browserName}] moving to opened thread released a full DOM reorder (max reatt=${Math.max(
        ...frames.map((f) => f.reattached.length)
      )})`
    ).toBe(false);
  });

  test('2C: opening a deep thread via link jumps across staged chunks (multi-frame scrollAnchorMemory writes) @webkit', async ({
    page,
    browserName,
  }) => {
    test.setTimeout(120_000);
    test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver not running');
    await page.setViewportSize({ width: 1440, height: 900 });

    const { rootPath, roots } = await seedLongCompactRoom(page, { layout: 'full' });
    const linkTarget = roots[15]!; // ~50th card in 65-thread room (below first staged chunk)
    await takeFrames(page);
    await page.goto(`${rootPath}/${encodeURIComponent(linkTarget)}?focusEvent=1`);
    await expect(compactView(page).locator('[data-scroll-anchor]').first()).toBeAttached({
      timeout: 30_000,
    });
    await page.evaluate(settleView);
    await page.waitForTimeout(400);

    const frames = await takeFrames(page);
    const jumpFrames = frames.filter((f, idx) => idx > 0 && Math.abs(f.y - frames[idx - 1]!.y) > 50);

    expect(
      jumpFrames.length,
      `[${browserName}] link restore jumped across ${jumpFrames.length} separate frames: ${jumpFrames
        .map((f) => `y=${f.y.toFixed(0)} [${formatWrites(f)}]`)
        .join(' -> ')}`
    ).toBeLessThanOrEqual(1);
  });
});
