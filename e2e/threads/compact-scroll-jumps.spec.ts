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

/** Waits until `key` leads the list (in the Pinned list for `pinned`) and the list rests. */
const waitForFirst = async (page: Page, key: string, pinned = false) => {
  await page.waitForFunction(
    ([first, group]) => {
      const lead = window.compactRecorder.last?.order[0];
      return lead?.[0] === first && (!group || lead[1] === group);
    },
    [key, pinned ? 'pinned' : ''] as const,
    { timeout: 20_000 }
  );
  await page.evaluate(settleView);
};

/**
 * The furthest `key` showed from where `before` had it in any of `frames`, in its place in the
 * list and as painted; a frame that does not show it counts as a jump.
 */
const worstShift = (before: ListFrame, frames: ListFrame[], key: string): number => {
  const was = before.visible.find((row) => row.key === key)!;
  return Math.max(
    0,
    ...frames.map((frame) => {
      const now = frame.visible.find((row) => row.key === key);
      if (!now) return 9999;
      return Math.max(Math.abs(now.top - was.top), Math.abs(now.painted - was.painted));
    })
  );
};

type SeededRoom = {
  roomId: string;
  rootPath: string;
  roots: string[];
  send: (body: string, root?: string) => Promise<string>;
  editRoot: (rootId: string, body: string) => Promise<string>;
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

  const editRoot = async (rootId: string, newBody: string) =>
    sendRoomMessage(hs, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: `* ${newBody}`,
      'm.new_content': { msgtype: 'm.text', body: newBody },
      'm.relates_to': { rel_type: 'm.replace', event_id: rootId },
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
      localStorage.setItem(
        `compactRoomSections:${user}`,
        JSON.stringify({ on: false, folded: [] })
      );
    },
    { user: reader.userId, threadLayout: layout }
  );
  await installListRecorder(page);
  await page.goto(rootPath);

  const view = page.locator(`${COMPACT}${LIVE}:not([data-thread-board-column] *)`);
  await expect(view.locator('[data-scroll-anchor]').first()).toBeAttached({ timeout: 30_000 });
  await page.evaluate(settleView);
  return { roomId, rootPath, roots, send, editRoot };
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

test.describe('Compact scroll jump regressions', () => {
  for (const form of ['desktop', 'phone'] as const) {
    const viewport = form === 'phone' ? { width: 390, height: 780 } : { width: 1440, height: 900 };

    test(`1A (${form}): live re-sort from below viewport keeps scrolled-down cards in place @webkit`, async ({
      page,
      browserName,
    }) => {
      test.setTimeout(120_000);
      test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver not running');
      await page.setViewportSize(viewport);

      const { send } = await seedLongCompactRoom(page, {
        layout: form === 'phone' ? 'full' : 'beside',
      });
      await wheelBurst(page, 12, 220);
      await page.evaluate(settleView);
      await page.mouse.move(8, 8);
      await page.waitForTimeout(800); // > MOUSE_REST_HOLD_MS (700 ms)

      const before = (await takeFrames(page)).at(-1)!;
      const belowKey = before.order.at(-2)![0];
      await send('Live reply re-sorting older thread to top while scrolled down', belowKey);
      await waitForFirst(page, belowKey);
      const frames = [before, ...(await takeFrames(page))];
      const after = frames.at(-1)!;
      // In every frame, not only once the list rests.
      const topShift = worstShift(before, frames, before.visible[0]!.key);

      expect(
        after.y,
        `[${browserName}/${form}] scrollTop jumped ${before.y}->${after.y} (reatt=${Math.max(
          ...frames.map((f) => f.reattached.length)
        )}, writes=${frames.map(formatWrites).filter(Boolean).join(' | ') || 'none'})`
      ).toBeGreaterThan(before.y - 200);
      expect(
        topShift,
        `[${browserName}/${form}] visible anchor jumped by ${topShift.toFixed(
          1
        )}px in some frame (y: ${before.y}->${after.y})`
      ).toBeLessThanOrEqual(2);
    });

    test(`1B (${form}): WebKit compensates non-parent card height growth @webkit`, async ({
      page,
      browserName,
    }) => {
      test.setTimeout(120_000);
      test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver not running');
      test.skip(browserName !== 'webkit', 'WebKit scroll fallback bug (Chromium anchors natively)');
      await page.setViewportSize(viewport);

      await seedLongCompactRoom(page, { layout: form === 'phone' ? 'full' : 'beside' });
      await wheelBurst(page, 16, 220);
      await page.evaluate(settleView);
      await page.waitForTimeout(200); // let scroll settle
      const beforeGrow = (await takeFrames(page)).at(-1)!;

      // Part 1: non-parent-commit card height growth above viewport (memoized child / badge / font)
      await compactView(page).evaluate((el) => {
        const cards = [...el.querySelectorAll<HTMLElement>('[data-scroll-anchor]')];
        for (const idx of [2, 5, 8]) {
          const card = cards[idx];
          if (card) card.style.paddingBottom = '60px';
        }
      });
      await page.waitForTimeout(300);
      const afterGrow = (await takeFrames(page)).at(-1)!;
      const beforeGrowMap = new Map(beforeGrow.visible.map((r) => [r.key, r]));
      const grownAnchor = afterGrow.visible.find((r) => beforeGrowMap.has(r.key));
      const growShift = grownAnchor
        ? Math.abs(grownAnchor.top - beforeGrowMap.get(grownAnchor.key)!.top)
        : 9999;
      expect(
        growShift,
        `[webkit/${form}] non-parent height growth shifted visible anchor by ${growShift.toFixed(
          1
        )}px (y: ${beforeGrow.y}->${afterGrow.y})`
      ).toBeLessThanOrEqual(2);
    });

    test(`1B-wheel (${form}): root edits landing mid-fast-scroll-up do not fight the compositor @webkit`, async ({
      page,
      browserName,
    }) => {
      test.fixme(true, 'WebKit mid-wheel snap-back: follow-up, as on main');
      test.setTimeout(120_000);
      test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver not running');
      test.skip(browserName !== 'webkit', 'WebKit scroll fallback bug (Chromium anchors natively)');
      await page.setViewportSize(viewport);

      const { roots, editRoot } = await seedLongCompactRoom(page, {
        layout: form === 'phone' ? 'full' : 'beside',
      });
      await wheelBurst(page, 16, 220);
      await page.evaluate(settleView);
      await page.waitForTimeout(200); // let scroll settle
      const afterGrow = (await takeFrames(page)).at(-1)!;
      const rect = (await compactView(page).boundingBox())!;
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const edited = [roots[60]!, roots[59]!, roots[58]!];
      const heights = () =>
        compactView(page).evaluate(
          (el, ids) =>
            ids.map(
              (id) =>
                el
                  .querySelector(`[data-scroll-anchor="${CSS.escape(id)}"]`)
                  ?.getBoundingClientRect().height ?? 0
            ),
          edited
        );
      const heightsBefore = await heights();
      // Long enough to wrap onto a second line in a wide list as well.
      const title =
        'Long edited title that wraps onto a second line above the active scroll position during fast upward wheel scrolling. '.repeat(
          3
        );
      // Wheel up, send the edits a few steps in, and go on until a card grew and for some steps
      // after: the growth lands inside the burst. Stop short of the top of the list.
      const editAt = 4;
      const stepsAfter = 8;
      const stepsBefore = Math.floor((afterGrow.y - 300) / 100) - stepsAfter;
      let edits: Promise<string>[] = [];
      let grewAfter = -1;
      for (let step = 0; grewAfter < 0 ? step < stepsBefore : step < grewAfter + stepsAfter; ) {
        await page.mouse.wheel(0, -100);
        await page.waitForTimeout(16);
        step += 1;
        if (step === editAt) edits = edited.map((root) => editRoot(root, title));
        const grew = async () => (await heights()).some((h, i) => h > heightsBefore[i]! + 5);
        if (grewAfter < 0 && step > editAt && (await grew())) grewAfter = step;
      }
      await Promise.all(edits);
      expect(
        grewAfter,
        `[webkit/${form}] no edited card grew within ${stepsBefore} wheel steps (heights ${heightsBefore.join()} -> ${(
          await heights()
        ).join()})`
      ).toBeGreaterThan(editAt);
      await page.waitForTimeout(500);
      const raceFrames = await takeFrames(page);
      const backwardsSnaps: string[] = [];
      for (let i = 1; i < raceFrames.length; i += 1) {
        const prev = raceFrames[i - 1]!;
        const cur = raceFrames[i]!;
        const dy = cur.y - prev.y;
        const prevMap = new Map(prev.visible.map((r) => [r.key, r]));
        const common = cur.visible.find((r) => prevMap.has(r.key));
        const paintD = common ? common.painted - prevMap.get(common.key)!.painted : 0;
        // With or without a write of the page's own in the frame.
        if (dy > 5 && paintD < -5) {
          backwardsSnaps.push(
            `f${i}: y ${prev.y.toFixed(1)}->${cur.y.toFixed(1)} (dy=+${dy.toFixed(
              1
            )}, paintD=${paintD.toFixed(1)}, writes=${formatWrites(cur) || 'none'})`
          );
        }
      }
      expect(
        backwardsSnaps,
        `[webkit/${form}] compositor backwards snaps during fast scroll up: ${backwardsSnaps.join(
          '; '
        )}`
      ).toEqual([]);
    });

    test(`2C (${form}): a card opened by its link is reached and stays in place as a thread arrives above @webkit`, async ({
      page,
      browserName,
    }) => {
      test.fixme(true, "link restore far down the list: follow-up, the follower's stop rule");
      test.setTimeout(120_000);
      test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver not running');
      await page.setViewportSize(viewport);

      const { rootPath, roots, send } = await seedLongCompactRoom(page, {
        layout: form === 'phone' ? 'full' : 'beside',
      });
      const linkTarget = roots[15]!;
      await takeFrames(page);
      await page.goto(`${rootPath}/${encodeURIComponent(linkTarget)}?focusEvent=1`);
      await expect(compactView(page).locator('[data-scroll-anchor]').first()).toBeAttached({
        timeout: 30_000,
      });
      await page.evaluate(settleView);
      const restore = await takeFrames(page);
      const placed = restore.at(-1)!;
      expect(
        placed.visible.some((r) => r.key === linkTarget),
        `[${browserName}/${form}] linked card ${linkTarget} never reached viewport (y=${
          placed.y
        }, writes=${restore.map(formatWrites).filter(Boolean).join(' | ')})`
      ).toBe(true);

      // The browser's scroll anchoring, or the list's own, scrolls for the card that joins: the
      // restore must not take that for the reader's scroll, nor scroll on top of it.
      const arrived = await send('New thread arriving above the linked card');
      await waitForFirst(page, arrived);
      const frames = await takeFrames(page);
      const shift = worstShift(placed, frames, linkTarget);
      expect(
        shift,
        `[${browserName}/${form}] linked card moved ${shift.toFixed(1)}px in some frame (writes=${
          frames.map(formatWrites).filter(Boolean).join(' | ') || 'none'
        })`
      ).toBeLessThanOrEqual(2);
    });
  }

  test('2A (desktop): opening a thread beside the Compact list compensates inset changes and anchors below header @webkit', async ({
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
    const anchor = before.visible[0]!;
    const clicked = before.visible[Math.min(2, before.visible.length - 1)]!;

    await compactView(page).locator(`[data-thread-root-id="${clicked.key}"]${LIVE}`).click();
    await expect(page).toHaveURL(/threadId=/);
    await page.waitForTimeout(900);
    const frames = [before, ...(await takeFrames(page))];

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

    // On the width-narrowing frame itself, the topmost visible card below the header stays anchored.
    const narrowFrame = frames.find((f) => f.width < before.width);
    const narrowAnchor = narrowFrame?.visible.find((r) => r.key === anchor.key);
    const anchorShift = narrowAnchor ? Math.abs(narrowAnchor.top - anchor.top) : 9999;

    expect(padBounceJumps, `[${browserName}] uncompensated header/filter inset jumps`).toEqual([]);
    expect(
      anchorShift,
      `[${browserName}] topmost visible card shifted ${anchorShift.toFixed(
        1
      )}px on narrow (${anchor.top.toFixed(1)}->${narrowAnchor?.top.toFixed(1) ?? 'OFFSCREEN'})`
    ).toBeLessThanOrEqual(2);
  });

  test('2B (desktop): opening a thread beside list releases hover-held re-sort @webkit', async ({
    page,
    browserName,
  }) => {
    test.setTimeout(120_000);
    test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver not running');
    await page.setViewportSize({ width: 1440, height: 900 });

    const { roots, send } = await seedLongCompactRoom(page, { layout: 'beside' });
    // Mid-list: at its end, the list could not scroll on by the height of the card that leaves.
    await wheelBurst(page, 12, 220);
    await page.evaluate(settleView);
    const before = (await takeFrames(page)).at(-1)!;
    const target = before.visible[Math.min(2, before.visible.length - 1)]!;
    const targetCard = compactView(page).locator(`[data-thread-root-id="${target.key}"]${LIVE}`);

    await targetCard.hover();
    const held = 'Held live reply released when moving pointer to opened thread';
    await page.evaluate(
      (evidence) => {
        window.compactRecorder.evidence = evidence;
      },
      [roots[4]!, held] as [string, string]
    );
    // The pointer keeps moving within the card while the reply is sent and until it shows: at
    // rest, its hold on the order would run out after 700 ms.
    const sent = send(held, roots[4]);
    const box = (await targetCard.boundingBox())!;
    const deadline = Date.now() + 20_000;
    for (let step = 0; ; step += 1) {
      if (await page.evaluate(() => !!window.compactRecorder.last?.replySeen)) break;
      if (Date.now() > deadline) throw Error('the reply did not show in its card');
      const dx = step % 2 ? 6 : -6;
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2);
      await page.waitForTimeout(100);
    }
    await sent;
    // The reply is in, and the pointer still holds the order: its thread has not sorted first.
    const beforeClick = (await takeFrames(page)).at(-1)!;
    expect(beforeClick.held, `[${browserName}] the list is held before the click`).toBe(true);
    expect(beforeClick.order[0]![0]).not.toBe(roots[4]);

    await targetCard.click();
    await expect(page).toHaveURL(/threadId=/);
    await page.mouse.move(1250, 450);
    // Let go, the list sorts the thread that got the reply first.
    await waitForFirst(page, roots[4]!);
    const frames = [before, ...(await takeFrames(page))];
    const after = frames.at(-1)!;

    expect(after.y, `[${browserName}] scrollTop jumped ${before.y}->${after.y}`).toBeGreaterThan(
      before.y - 200
    );
    // In every frame since the click, not only once the list rests. The card that was clicked:
    // the header grows over the topmost one as the list narrows.
    const shift = worstShift(before, frames, target.key);
    expect(
      shift,
      `[${browserName}] visible card moved ${shift.toFixed(1)}px in some frame (y: ${before.y}->${
        after.y
      })`
    ).toBeLessThanOrEqual(2);
  });

  test('1C (desktop): pinning the first card in view while the pointer holds the order keeps the next one in place @webkit', async ({
    page,
    browserName,
  }) => {
    test.setTimeout(120_000);
    test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver not running');
    await page.setViewportSize({ width: 1440, height: 900 });

    await seedLongCompactRoom(page, { layout: 'beside' });
    await wheelBurst(page, 12, 220);
    await page.evaluate(settleView);
    // A card right below the header, so the topmost card in view shows whole and can be pinned.
    await compactView(page).evaluate((el) => {
      const edge =
        el.getBoundingClientRect().top + (parseFloat(getComputedStyle(el).scrollPaddingTop) || 0);
      const card = [...el.querySelectorAll('[data-scroll-anchor]')].find(
        (row) => row.getBoundingClientRect().top >= edge
      );
      if (card) el.scrollBy(0, card.getBoundingClientRect().top - edge - 2);
    });
    await page.evaluate(settleView);
    const before = (await takeFrames(page)).at(-1)!;
    const pinned = before.visible[0]!;
    const next = before.visible[1]!;

    // The pointer on the card holds the order; the pinned card moves to the Pinned list anyway.
    const shell = compactView(page).locator(`[data-scroll-anchor="${pinned.key}"]${LIVE}`);
    await shell.locator('[data-thread-root-id]').hover();
    await shell.locator('[data-compact-thread-pin]').click();
    await waitForFirst(page, pinned.key, true);
    const frames = [before, ...(await takeFrames(page))];
    const after = frames.at(-1)!;

    expect(after.y, `[${browserName}] scrollTop jumped ${before.y}->${after.y}`).toBeGreaterThan(
      before.y - 200
    );
    const shift = worstShift(before, frames, next.key);
    expect(
      shift,
      `[${browserName}] card after the pinned one moved ${shift.toFixed(1)}px in some frame (y: ${
        before.y
      }->${after.y})`
    ).toBeLessThanOrEqual(2);
  });
});
