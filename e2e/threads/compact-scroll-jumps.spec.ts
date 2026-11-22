/* eslint-disable no-await-in-loop, no-console -- investigative scroll-jump probe. */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  disposableHomeserverIsUp,
  registerDisposableUser,
  DISPOSABLE_HOMESERVER as hs,
} from '../helpers/disposableAccounts';
import { fingersOn } from '../helpers/fingers';
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

const password = 'compact-jumps-test-only';

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

type Anomaly = {
  frameIndex: number;
  kind: string;
  viewChanged: boolean;
  yBefore: number;
  yAfter: number;
  dy: number;
  wBefore: number;
  wAfter: number;
  padBefore: number;
  padAfter: number;
  shBefore: number;
  shAfter: number;
  orderChanged: boolean;
  pending: boolean;
  held: boolean;
  anchorKey?: string;
  anchorTopDelta?: number;
  anchorPaintedDelta?: number;
  maxRowJumpKey?: string;
  maxRowPaintedDelta?: number;
  layoutShift?: number;
  inputs: string[];
  writes: ListFrame['writes'];
};

const analyzeFrames = (
  label: string,
  frames: ListFrame[],
  mode: 'scrollUp' | 'still' | 'openOrRestore'
): Anomaly[] => {
  const anomalies: Anomaly[] = [];
  for (let i = 1; i < frames.length; i += 1) {
    const prev = frames[i - 1]!;
    const cur = frames[i]!;
    const viewChanged = prev.view !== cur.view;
    const dy = cur.y - prev.y;
    const orderChanged =
      prev.order.length !== cur.order.length ||
      prev.order.some(([k, g], idx) => cur.order[idx]?.[0] !== k || cur.order[idx]?.[1] !== g);
    const prevByKey = new Map(prev.visible.map((r) => [r.key, r]));
    const common = cur.visible
      .map((r) => ({ prev: prevByKey.get(r.key), cur: r }))
      .filter((pair): pair is { prev: NonNullable<typeof pair.prev>; cur: typeof pair.cur } =>
        Boolean(pair.prev)
      );
    const anchor = common[0];
    const anchorTopDelta = anchor ? anchor.cur.top - anchor.prev.top : undefined;
    const anchorPaintedDelta = anchor ? anchor.cur.painted - anchor.prev.painted : undefined;
    const layoutShift = anchor ? anchor.cur.top - anchor.prev.top + dy : undefined;

    let maxRow: { key: string; delta: number } | undefined;
    for (const pair of common) {
      const d = pair.cur.painted - pair.prev.painted;
      if (!maxRow || Math.abs(d) > Math.abs(maxRow.delta)) {
        maxRow = { key: pair.cur.key, delta: d };
      }
    }

    const inputs = cur.input.map((inp) => `${inp.type}(dir=${inp.direction},in=${inp.inside})`);
    const hasWrite = cur.writes.length > 0;
    const padChanged = Math.abs(cur.paddingTop - prev.paddingTop) >= 1;
    const widthChanged = Math.abs(cur.width - prev.width) >= 1;
    const shChanged = Math.abs(cur.scrollHeight - prev.scrollHeight) >= 1;

    let kind = '';
    if (viewChanged) {
      kind = 'remount';
    } else if (mode === 'scrollUp') {
      if (dy > 2) kind = `scrollTop-jumped-DOWN(+${dy.toFixed(1)}px)`;
      else if (anchorPaintedDelta !== undefined && anchorPaintedDelta < -3)
        kind = `card-jumped-UP(${anchorPaintedDelta.toFixed(1)}px)`;
      else if (layoutShift !== undefined && Math.abs(layoutShift) > 3)
        kind = `layout-shift-above(${layoutShift.toFixed(1)}px,dy=${dy.toFixed(1)})`;
      else if (hasWrite) kind = `programmatic-write-during-scrollUp`;
    } else if (mode === 'still') {
      if (Math.abs(dy) > 2 || (anchorPaintedDelta !== undefined && Math.abs(anchorPaintedDelta) > 2))
        kind = `unexpected-shift(dy=${dy.toFixed(1)},painted=${anchorPaintedDelta?.toFixed(1)})`;
      else if (hasWrite) kind = `programmatic-write`;
    } else {
      if (
        Math.abs(dy) > 2 ||
        (anchorPaintedDelta !== undefined && Math.abs(anchorPaintedDelta) > 2) ||
        hasWrite ||
        widthChanged ||
        padChanged ||
        shChanged
      ) {
        kind = `change(dy=${dy.toFixed(1)},painted=${anchorPaintedDelta?.toFixed(1)},w=${prev.width}->${cur.width},pad=${prev.paddingTop}->${cur.paddingTop},sh=${prev.scrollHeight}->${cur.scrollHeight})`;
      }
    }

    if (kind) {
      anomalies.push({
        frameIndex: i,
        kind,
        viewChanged,
        yBefore: prev.y,
        yAfter: cur.y,
        dy,
        wBefore: prev.width,
        wAfter: cur.width,
        padBefore: prev.paddingTop,
        padAfter: cur.paddingTop,
        shBefore: prev.scrollHeight,
        shAfter: cur.scrollHeight,
        orderChanged,
        pending: cur.pending,
        held: cur.held,
        anchorKey: anchor?.cur.key,
        anchorTopDelta,
        anchorPaintedDelta,
        maxRowJumpKey: maxRow?.key,
        maxRowPaintedDelta: maxRow?.delta,
        layoutShift,
        inputs,
        writes: cur.writes,
      });
    }
  }
  console.log(`[${label}] totalFrames=${frames.length} anomalies=${anomalies.length}`);
  for (const a of anomalies.slice(0, 12)) {
    console.log(
      `  f${a.frameIndex} ${a.kind} y:${a.yBefore.toFixed(1)}->${a.yAfter.toFixed(1)} ` +
        `topD=${a.anchorTopDelta?.toFixed(1) ?? 'n/a'} paintD=${a.anchorPaintedDelta?.toFixed(1) ?? 'n/a'} ` +
        `maxPaintD=${a.maxRowPaintedDelta?.toFixed(1) ?? 'n/a'} layShift=${a.layoutShift?.toFixed(1) ?? 'n/a'} ` +
        `ordChg=${a.orderChanged} pend=${a.pending} held=${a.held} inputs=[${a.inputs.join(',')}] ` +
        `writes=${a.writes.length}`
    );
    for (const w of a.writes) {
      const shortStack = w.stack.split('\n').slice(0, 5).join(' | ');
      console.log(
        `    WRITE ${w.method}(req=${w.requested ?? ''}) ${w.before.toFixed(1)}->${w.after.toFixed(1)} :: ${shortStack}`
      );
    }
  }
  return anomalies;
};

const summarizeNetShift = (label: string, before: ListFrame, after: ListFrame) => {
  const prevByKey = new Map(before.visible.map((r) => [r.key, r]));
  const common = after.visible
    .map((r) => ({ prev: prevByKey.get(r.key), cur: r }))
    .filter((pair): pair is { prev: NonNullable<typeof pair.prev>; cur: typeof pair.cur } =>
      Boolean(pair.prev)
    );
  const first = common[0];
  console.log(
    `[NET ${label}] viewSame=${before.view === after.view} y:${before.y.toFixed(1)}->${after.y.toFixed(1)} ` +
      `w:${before.width}->${after.width} pad:${before.paddingTop}->${after.paddingTop} ` +
      `sh:${before.scrollHeight}->${after.scrollHeight} ` +
      `common=${common.length} firstTopD=${first ? (first.cur.top - first.prev.top).toFixed(1) : 'NONE'} ` +
      `firstPaintD=${first ? (first.cur.painted - first.prev.painted).toFixed(1) : 'NONE'}`
  );
};

for (const phone of [false, true]) {
  const form = phone ? 'phone' : 'desktop';
  const size = { width: phone ? 390 : 1440, height: phone ? 780 : 900 };
  test.describe(`Compact scroll jumps probe (${form})`, () => {
    test.use({
      viewport: size,
      hasTouch: phone,
      isMobile: async ({ browserName }, use) => {
        await use(phone && browserName === 'chromium');
      },
    });

    test(`probe fast scroll up and open thread (${form}) @webkit`, async ({
      page,
      browserName,
    }) => {
      test.setTimeout(180_000);
      test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver not running');

      const suffix = randomUUID().slice(0, 8);
      const reader = await registerDisposableUser(`jmp_${suffix}`, password);
      const agent = await registerAgentAccount(hs, `jmpagent_${suffix}`);
      const roomId = await createRoom(hs, reader.accessToken, {
        name: 'Compact Scroll Jump Probe Room',
        invite: [agent.userId],
      });
      await joinRoom(hs, agent.accessToken, roomId);

      const send = async (body: string, root?: string, tokenOverride?: string) => {
        const relation = {
          rel_type: 'm.thread',
          event_id: root,
          is_falling_back: true,
          'm.in_reply_to': { event_id: root },
        };
        const token = tokenOverride ?? (root ? agent.accessToken : reader.accessToken);
        return sendRoomMessage(hs, token, roomId, {
          msgtype: 'm.text',
          body,
          'm.relates_to': root ? relation : undefined,
        });
      };

      // Seed 65 threads with varied title lengths (some wrap to 2-3 lines when narrowed!)
      const roots: string[] = [];
      for (let i = 0; i < 65; i += 1) {
        const longExtra =
          i % 2 === 0
            ? ' - investigating intermittent compact thread list scroll jumps across desktop split view and phone navigation when titles wrap'
            : '';
        const root = await send(`Thread #${i}${longExtra}`);
        await send(
          `Reply for thread #${i}: detailed status update with enough text to wrap across multiple lines on narrow widths.`,
          root
        );
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
      await page.addInitScript((user) => {
        const key = `compactRoomSections:${user}`;
        if (!localStorage.getItem(key))
          localStorage.setItem(key, JSON.stringify({ on: false, folded: [] }));
      }, reader.userId);
      await installListRecorder(page);
      await page.goto(rootPath);

      const view = () => page.locator(`${COMPACT}${LIVE}:not([data-thread-board-column] *)`);
      const card = (root: string) => view().locator(`[data-thread-root-id="${root}"]${LIVE}`);
      const ready = async () => {
        await expect(view().locator('[data-scroll-anchor]').first()).toBeAttached({
          timeout: 30_000,
        });
        await expect(page.locator('html[data-page-slide]')).toHaveCount(0);
        await page.evaluate(settleView);
      };
      await ready();
      console.log(`=== ENGINE=${browserName} FORM=${form} ===`);

      const center = async () => {
        const rect = await view().boundingBox();
        if (!rect) throw Error('No compact scroller box');
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      };

      const touch = phone && browserName === 'chromium' ? await fingersOn(page) : undefined;

      const fastScroll = async (dir: 'down' | 'up', steps: number, pxPerStep: number) => {
        const { x, y } = await center();
        if (touch) {
          const sign = dir === 'down' ? -1 : 1;
          for (let burst = 0; burst < Math.max(1, Math.floor(steps / 4)); burst += 1) {
            await touch('touchStart', [[1, x, y]]);
            for (let s = 1; s <= 5; s += 1) {
              await touch('touchMove', [[1, x, y + sign * s * 45]]);
              await page.waitForTimeout(12);
            }
            await touch('touchEnd', []);
            await page.waitForTimeout(60);
          }
          return;
        }
        await page.mouse.move(x, y);
        const dy = dir === 'down' ? pxPerStep : -pxPerStep;
        for (let s = 0; s < steps; s += 1) {
          await page.mouse.wheel(0, dy);
          await page.waitForTimeout(16);
        }
      };

      // --- S1: Fast scroll up (clean, no live updates) after scrolling deep ---
      await fastScroll('down', 18, 220);
      await page.evaluate(settleView);
      await takeFrames(page); // clear
      await fastScroll('up', 12, 220);
      await page.waitForTimeout(400);
      const s1Frames = await takeFrames(page);
      analyzeFrames(`S1-clean-fast-scroll-up-${browserName}-${form}`, s1Frames, 'scrollUp');

      // --- S2: Fast scroll up WITH live reply re-sorting an old thread to top (pointer away) ---
      await fastScroll('down', 18, 220);
      await page.evaluate(settleView);
      await page.mouse.move(8, 8);
      await page.waitForTimeout(800); // > MOUSE_REST_HOLD_MS (700ms)
      await takeFrames(page);
      // Fire reply to oldest thread right as we start scrolling up fast!
      const replyPromise = send('Live reply causing re-sort during fast scroll up', roots[0]!);
      await fastScroll('up', 10, 140);
      await replyPromise;
      await page.waitForTimeout(800);
      const s2Frames = await takeFrames(page);
      analyzeFrames(`S2-live-resort-during-scroll-up-${browserName}-${form}`, s2Frames, 'scrollUp');

      // --- S3: Live reply re-sorting while scrolled down & STILL (pointer away) ---
      await fastScroll('down', 14, 200);
      await page.evaluate(settleView);
      await page.mouse.move(8, 8);
      await page.waitForTimeout(800);
      const s3Before = (await takeFrames(page)).at(-1)!;
      await send('Live reply while still and scrolled down', roots[1]!);
      await page.waitForTimeout(1200);
      const s3Frames = await takeFrames(page);
      analyzeFrames(`S3-live-resort-while-still-${browserName}-${form}`, [s3Before, ...s3Frames], 'still');
      if (s3Frames.length > 0) {
        summarizeNetShift(`S3-still-resort-${browserName}-${form}`, s3Before, s3Frames.at(-1)!);
      }

      // --- S4: Open a thread from scrolled-down list ---
      // Scroll down to middle, settle, pick a fully visible card, click it!
      await fastScroll('down', 14, 180);
      await page.evaluate(settleView);
      const s4Before = (await takeFrames(page)).at(-1)!;
      const targetRow = s4Before.visible[Math.min(2, s4Before.visible.length - 1)]!;
      await card(targetRow.key).click();
      await expect(page).toHaveURL(/threadId=/);
      await page.waitForTimeout(900);
      const s4OpenFrames = await takeFrames(page);
      analyzeFrames(
        `S4a-open-thread-${browserName}-${form}`,
        [s4Before, ...s4OpenFrames],
        'openOrRestore'
      );
      if (!phone && s4OpenFrames.length > 0) {
        summarizeNetShift(`S4a-open-beside-${browserName}-${form}`, s4Before, s4OpenFrames.at(-1)!);
        // Check clicked card specifically!
        const beforeClicked = s4Before.visible.find((r) => r.key === targetRow.key);
        const afterClicked = s4OpenFrames.at(-1)!.visible.find((r) => r.key === targetRow.key);
        console.log(
          `[S4a-clicked-card] key=${targetRow.key} beforeTop=${beforeClicked?.top.toFixed(1)} ` +
            `afterTop=${afterClicked?.top.toFixed(1) ?? 'OFFSCREEN'}`
        );
      }

      // Now go Back (or close thread) and check restore + immediate fast scroll up!
      if (phone) {
        await page.goBack();
        await ready();
        await page.waitForTimeout(400);
        const s4BackFrames = await takeFrames(page);
        analyzeFrames(
          `S4b-back-after-open-${browserName}-${form}`,
          [s4Before, ...s4BackFrames],
          'openOrRestore'
        );
        if (s4BackFrames.length > 0) {
          summarizeNetShift(`S4b-back-net-${browserName}-${form}`, s4Before, s4BackFrames.at(-1)!);
        }

        // S4c: Reply right after Back (F1 scrollAnchorMemory follower!)
        const s4cBefore = s4BackFrames.at(-1) ?? s4Before;
        await send('Reply right after Back without scrolling', roots[2]!);
        await page.waitForTimeout(1000);
        const s4cFrames = await takeFrames(page);
        analyzeFrames(
          `S4c-reply-after-back-${browserName}-${form}`,
          [s4cBefore, ...s4cFrames],
          'still'
        );

        // S4d: Open again, go Back, IMMEDIATELY fast scroll up!
        await card(targetRow.key).click();
        await expect(page).toHaveURL(/threadId=/);
        await page.waitForTimeout(400);
        await takeFrames(page);
        await page.goBack();
        await expect(view().locator('[data-scroll-anchor]').first()).toBeAttached({
          timeout: 15_000,
        });
        await fastScroll('up', 10, 180);
        await page.waitForTimeout(500);
        const s4dFrames = await takeFrames(page);
        analyzeFrames(`S4d-fast-scroll-up-right-after-back-${browserName}-${form}`, s4dFrames, 'scrollUp');
      } else {
        // Desktop: also test with filter bar SHOWN (wraps on narrow!) and opening a thread!
        await page.goBack();
        await page.waitForTimeout(400);
        await page.locator('[data-thread-filter-bar-toggle]').first().click();
        await page.waitForTimeout(400);
        await page.evaluate(settleView);
        const s5Before = (await takeFrames(page)).at(-1)!;
        const s5Row = s5Before.visible[Math.min(2, s5Before.visible.length - 1)]!;
        await card(s5Row.key).click();
        await expect(page).toHaveURL(/threadId=/);
        await page.waitForTimeout(900);
        const s5Frames = await takeFrames(page);
        analyzeFrames(
          `S5-open-beside-with-filterbar-${browserName}-${form}`,
          [s5Before, ...s5Frames],
          'openOrRestore'
        );
        if (s5Frames.length > 0) {
          summarizeNetShift(`S5-filterbar-beside-${browserName}-${form}`, s5Before, s5Frames.at(-1)!);
        }

        // Desktop: also test Show in Full -> Back!
        const showFullBtn = page.getByRole('button', { name: /full/i }).first();
        if (await showFullBtn.isVisible()) {
          await showFullBtn.click();
          await page.waitForTimeout(400);
          await takeFrames(page);
          await page.goBack();
          await ready();
          await page.waitForTimeout(500);
          const s6BackFrames = await takeFrames(page);
          analyzeFrames(
            `S6-desktop-full-back-${browserName}-${form}`,
            [s5Before, ...s6BackFrames],
            'openOrRestore'
          );
        }
      }

      // --- S7: Open via link (?focusEvent=1) ---
      const linkTarget = roots[15]!;
      await takeFrames(page);
      await page.goto(`${rootPath}/${encodeURIComponent(linkTarget)}?focusEvent=1`);
      await ready();
      await page.waitForTimeout(600);
      const s7Frames = await takeFrames(page);
      analyzeFrames(`S7-open-via-link-${browserName}-${form}`, s7Frames, 'openOrRestore');
      // Now send a reply after link without scrolling!
      if (s7Frames.length > 0) {
        const s7Last = s7Frames.at(-1)!;
        await send('Reply right after link open', roots[3]!);
        await page.waitForTimeout(1000);
        const s7After = await takeFrames(page);
        analyzeFrames(`S7b-reply-after-link-${browserName}-${form}`, [s7Last, ...s7After], 'still');
      }
    });
  });
}
