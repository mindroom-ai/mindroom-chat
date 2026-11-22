/* eslint-disable no-await-in-loop, no-console -- investigative scroll-jump probe v3 (zero-perturbation tracer). */
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

const password = 'compact-jumps-test-only';

type TraceEvent = {
  t: number;
  kind: string;
  y: number;
  sh: number;
  pad: number;
  w: number;
  detail: string;
};

declare global {
  interface Window {
    __traceEvents?: TraceEvent[];
    __traceEnabled?: boolean;
  }
}

/**
 * Zero-perturbation tracer: does NOT read layout during insertBefore/appendChild.
 * Only logs scrollTop at points that already read layout (getBoundingClientRect on the scroller)
 * and on native scroll events, plus counts DOM mutations without touching scrollTop.
 */
const installZeroPerturbTracer = (page: Page) =>
  page.addInitScript(() => {
    if (window !== window.top) return;
    window.__traceEvents = [];
    window.__traceEnabled = false;
    const selector = '[data-compact-room-view]:not([data-page-slide-copy] *, [inert] *)';
    const push = (kind: string, view: HTMLElement, detail: string) => {
      if (!window.__traceEnabled) return;
      window.__traceEvents!.push({
        t: Math.round(performance.now()),
        kind,
        y: view.scrollTop,
        sh: view.scrollHeight,
        pad: parseFloat(getComputedStyle(view).paddingTop) || 0,
        w: view.clientWidth,
        detail,
      });
    };

    // Wrap getBoundingClientRect ONLY on the scroller itself (already forces layout)
    const origRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const rect = origRect.call(this);
      if (window.__traceEnabled && this instanceof HTMLElement && this.matches(selector)) {
        const stack = new Error().stack?.split('\n').slice(1, 5).join(' | ') ?? '';
        push('rect', this, stack);
      }
      return rect;
    };

    // Track scroll events on the scroller
    document.addEventListener(
      'scroll',
      (evt) => {
        const t = evt.target;
        if (t instanceof HTMLElement && t.matches(selector)) {
          push('scroll-evt', t, '');
        }
      },
      true
    );
  });

const setTrace = (page: Page, enabled: boolean) =>
  page.evaluate((on) => {
    window.__traceEnabled = on;
    return window.__traceEvents?.splice(0) ?? [];
  }, enabled);

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

const dumpTrace = (label: string, events: TraceEvent[], max = 14) => {
  console.log(`[TRACE ${label}] count=${events.length}`);
  for (const e of events.slice(0, max)) {
    console.log(`  t=${e.t} ${e.kind} y=${e.y.toFixed(1)} sh=${e.sh} w=${e.w} pad=${e.pad} ${e.detail}`);
  }
};

const dumpFrames = (label: string, frames: ListFrame[], max = 10) => {
  let printed = 0;
  console.log(`[FRAMES ${label}] total=${frames.length}`);
  for (let i = 1; i < frames.length; i += 1) {
    const prev = frames[i - 1]!;
    const cur = frames[i]!;
    const dy = cur.y - prev.y;
    const prevByKey = new Map(prev.visible.map((r) => [r.key, r]));
    const common = cur.visible
      .map((r) => ({ prev: prevByKey.get(r.key), cur: r }))
      .filter((pair): pair is { prev: NonNullable<typeof pair.prev>; cur: typeof pair.cur } =>
        Boolean(pair.prev)
      );
    const first = common[0];
    const topD = first ? first.cur.top - first.prev.top : Number.NaN;
    const paintD = first ? first.cur.painted - first.prev.painted : Number.NaN;
    const layShift = first ? topD + dy : Number.NaN;
    const ordChg =
      prev.order.length !== cur.order.length ||
      prev.order.some(([k, g], idx) => cur.order[idx]?.[0] !== k || cur.order[idx]?.[1] !== g);
    const interesting =
      prev.view !== cur.view ||
      Math.abs(dy) >= 2 ||
      Math.abs(topD) >= 2 ||
      Math.abs(paintD) >= 2 ||
      Math.abs(cur.width - prev.width) >= 1 ||
      Math.abs(cur.paddingTop - prev.paddingTop) >= 1 ||
      Math.abs(cur.scrollHeight - prev.scrollHeight) >= 2 ||
      ordChg ||
      cur.writes.length > 0;
    if (interesting && printed < max) {
      printed += 1;
      console.log(
        `  f${i} y:${prev.y.toFixed(1)}->${cur.y.toFixed(1)}(dy=${dy.toFixed(1)}) ` +
          `w:${prev.width}->${cur.width} pad:${prev.paddingTop.toFixed(0)}->${cur.paddingTop.toFixed(0)} ` +
          `sh:${prev.scrollHeight}->${cur.scrollHeight} topD=${Number.isFinite(topD) ? topD.toFixed(1) : 'n/a'} ` +
          `paintD=${Number.isFinite(paintD) ? paintD.toFixed(1) : 'n/a'} ` +
          `layShift=${Number.isFinite(layShift) ? layShift.toFixed(1) : 'n/a'} ` +
          `ord=${ordChg} held=${cur.held} writes=${cur.writes.length} reatt=${cur.reattached.length}`
      );
      for (const w of cur.writes) {
        console.log(
          `    WRITE ${w.method}(req=${w.requested ?? ''}) ${w.before.toFixed(1)}->${w.after.toFixed(1)} :: ${w.stack
            .split('\n')
            .slice(0, 4)
            .join(' | ')}`
        );
      }
    }
  }
};

test.describe('Compact scroll jumps zero-perturbation root cause proof', () => {
  test('prove webkit reset-to-0 + card-edit during scroll-up + click-while-held + partial card click @webkit', async ({
    page,
    browserName,
  }) => {
    test.setTimeout(180_000);
    test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver not running');
    await page.setViewportSize({ width: 1440, height: 900 });

    const suffix = randomUUID().slice(0, 8);
    const reader = await registerDisposableUser(`jmp3_${suffix}`, password);
    const agent = await registerAgentAccount(hs, `jmp3agent_${suffix}`);
    const roomId = await createRoom(hs, reader.accessToken, {
      name: 'Zero-Perturb Proof Room',
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

    const editRoot = async (rootId: string, newBody: string) =>
      sendRoomMessage(hs, reader.accessToken, roomId, {
        msgtype: 'm.text',
        body: `* ${newBody}`,
        'm.new_content': { msgtype: 'm.text', body: newBody },
        'm.relates_to': { rel_type: 'm.replace', event_id: rootId },
      });

    const roots: string[] = [];
    for (let i = 0; i < 65; i += 1) {
      const root = await send(
        `Thread #${i} - Short title`
      );
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
    await page.addInitScript((user) => {
      localStorage.setItem('mindroom.threadColumn.layout', JSON.stringify('beside'));
      const key = `compactRoomSections:${user}`;
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ on: false, folded: [] }));
    }, reader.userId);
    await installZeroPerturbTracer(page);
    await installListRecorder(page);
    await page.goto(rootPath);

    const view = () => page.locator(`${COMPACT}${LIVE}:not([data-thread-board-column] *)`);
    const card = (root: string) => view().locator(`[data-thread-root-id="${root}"]${LIVE}`);
    const ready = async () => {
      await expect(view().locator('[data-scroll-anchor]').first()).toBeAttached({ timeout: 30_000 });
      await page.evaluate(settleView);
    };
    await ready();
    console.log(`=== ZERO-PERTURB ENGINE=${browserName} ===`);

    const wheelScroll = async (steps: number, dy: number) => {
      const rect = (await view().boundingBox())!;
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      for (let i = 0; i < steps; i += 1) {
        await page.mouse.wheel(0, dy);
        await page.waitForTimeout(16);
      }
    };

    // === TEST A: WebKit reset-to-0 WITHOUT layout perturbation, scrolled by wheel to middle (y~2500) ===
    await wheelScroll(12, 220);
    await page.evaluate(settleView);
    await page.mouse.move(8, 8);
    await page.waitForTimeout(800);
    const aBefore = (await takeFrames(page)).at(-1)!;
    await setTrace(page, true);
    console.log(`[A-before] y=${aBefore.y} sh=${aBefore.scrollHeight}`);
    await send('Test A live reply sorting roots[1] from bottom to top', roots[1]!);
    await page.waitForTimeout(1000);
    const aTrace = await setTrace(page, false);
    const aFrames = await takeFrames(page);
    dumpFrames(`A-resort-mid-scroll-${browserName}`, [aBefore, ...aFrames], 10);
    dumpTrace(`A-resort-mid-scroll-${browserName}`, aTrace, 14);

    // === TEST B: Real Matrix root edit (making a card above viewport wrap to 3 lines) DURING fast scroll UP ===
    await wheelScroll(15, 220);
    await page.evaluate(settleView);
    await page.mouse.move(8, 8);
    await page.waitForTimeout(800);
    await takeFrames(page);
    await setTrace(page, true);
    // Edit top 3 cards (above viewport!) to become long 3-line titles while fast scrolling up!
    const editPromise = (async () => {
      await editRoot(
        roots[63]!,
        'Thread #63 - Edited with a very long multi-line title that forces wrapping onto multiple lines above the current viewport while scrolling up fast in Compact view'
      );
      await editRoot(
        roots[62]!,
        'Thread #62 - Edited with a very long multi-line title that forces wrapping onto multiple lines above the current viewport while scrolling up fast in Compact view'
      );
      await editRoot(
        roots[61]!,
        'Thread #61 - Edited with a very long multi-line title that forces wrapping onto multiple lines above the current viewport while scrolling up fast in Compact view'
      );
    })();
    await wheelScroll(12, -140);
    await editPromise;
    await page.waitForTimeout(800);
    const bTrace = await setTrace(page, false);
    const bFrames = await takeFrames(page);
    dumpFrames(`B-root-edit-during-fast-scroll-up-${browserName}`, bFrames, 14);
    dumpTrace(`B-root-edit-during-fast-scroll-up-${browserName}`, bTrace, 10);

    // === TEST C: Click a card partially obscured under the floating header (does focus scroll it?) ===
    await wheelScroll(12, 220);
    await page.evaluate(settleView);
    // Find a card whose top < start (partially under floating header) and bottom > start + 25
    const partialInfo = await view().evaluate((el) => {
      const style = getComputedStyle(el);
      const start = parseFloat(style.scrollPaddingTop) || 0;
      const vTop = el.getBoundingClientRect().top;
      for (const row of el.querySelectorAll<HTMLElement>('[data-scroll-anchor]')) {
        const r = row.getBoundingClientRect();
        const relTop = r.top - vTop;
        const relBot = r.bottom - vTop;
        if (relTop < start - 10 && relBot > start + 25) {
          return {
            key: row.dataset.scrollAnchor!,
            relTop,
            relBot,
            start,
            clickX: r.left + r.width / 2,
            clickY: vTop + start + 15,
          };
        }
      }
      return null;
    });
    console.log(`[C-partial] info=${JSON.stringify(partialInfo)}`);
    if (partialInfo) {
      const cBefore = (await takeFrames(page)).at(-1)!;
      await setTrace(page, true);
      await page.mouse.click(partialInfo.clickX, partialInfo.clickY);
      await expect(page).toHaveURL(/threadId=/);
      await page.waitForTimeout(800);
      const cTrace = await setTrace(page, false);
      const cFrames = await takeFrames(page);
      dumpFrames(`C-click-partially-under-header-${browserName}`, [cBefore, ...cFrames], 10);
      dumpTrace(`C-click-partially-under-header-${browserName}`, cTrace, 10);
      await page.goBack();
      await page.waitForTimeout(400);
    }

    // === TEST D: Hover a card (orderHeld=true), live reply arrives (held), then CLICK card to open thread! ===
    await wheelScroll(10, 200);
    await page.evaluate(settleView);
    const dBefore = (await takeFrames(page)).at(-1)!;
    const dKey = dBefore.visible[2]!.key;
    // Hover the card -> holds order
    await card(dKey).hover();
    // Send live reply to roots[4] while hovering -> held!
    await send('Test D live reply held during hover then released on open', roots[4]!);
    await page.waitForTimeout(400);
    await takeFrames(page);
    await setTrace(page, true);
    // Click card to open thread beside, then move mouse into the thread panel (realistic user flow!)
    await card(dKey).click();
    await expect(page).toHaveURL(/threadId=/);
    await page.mouse.move(1250, 450); // move pointer over the open thread column!
    await page.waitForTimeout(1000);
    const dTrace = await setTrace(page, false);
    const dFrames = await takeFrames(page);
    dumpFrames(`D-open-thread-with-held-resort-${browserName}`, dFrames, 12);
    dumpTrace(`D-open-thread-with-held-resort-${browserName}`, dTrace, 12);
  });
});
