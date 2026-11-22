/* eslint-disable no-await-in-loop, no-console -- investigative scroll-jump probe v2. */
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

type DomScrollDrop = {
  op: string;
  before: number;
  after: number;
  shBefore: number;
  shAfter: number;
  nodeKey: string;
  refKey: string;
  activeTag: string;
  activeKey: string;
  stack: string;
};

declare global {
  interface Window {
    __domScrollDrops?: DomScrollDrop[];
    __scrollEvents?: { t: number; y: number; sh: number; w: number; pad: number }[];
  }
}

const installDomDropTracer = (page: Page) =>
  page.addInitScript(() => {
    if (window !== window.top) return;
    window.__domScrollDrops = [];
    window.__scrollEvents = [];
    const selector = '[data-compact-room-view]:not([data-page-slide-copy] *, [inert] *)';
    const keyOf = (n: Node | null | undefined): string => {
      if (!(n instanceof Element)) return String(n?.nodeName ?? 'null');
      return (
        n.getAttribute('data-scroll-anchor') ??
        n.getAttribute('data-compact-section') ??
        `${n.tagName}.${String(n.className).slice(0, 20)}`
      );
    };
    const wrap = (proto: object, name: 'insertBefore' | 'appendChild' | 'removeChild') => {
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (!desc || typeof desc.value !== 'function') return;
      const orig = desc.value as (...args: unknown[]) => unknown;
      Object.defineProperty(proto, name, {
        ...desc,
        value(this: Node, ...args: unknown[]) {
          const view = document.querySelector<HTMLElement>(selector);
          const inside =
            view && this instanceof Node && (this === view || view.contains(this));
          if (!inside) return orig.apply(this, args);
          const before = view.scrollTop;
          const shBefore = view.scrollHeight;
          const result = orig.apply(this, args);
          const after = view.scrollTop;
          const shAfter = view.scrollHeight;
          if (Math.abs(after - before) >= 2) {
            const ae = document.activeElement;
            window.__domScrollDrops!.push({
              op: name,
              before,
              after,
              shBefore,
              shAfter,
              nodeKey: keyOf(args[0] as Node),
              refKey: keyOf(args[1] as Node),
              activeTag: ae ? ae.tagName : 'none',
              activeKey: keyOf(ae?.closest?.('[data-scroll-anchor]') ?? ae),
              stack: new Error().stack?.split('\n').slice(2, 10).join(' | ') ?? '',
            });
          }
          return result;
        },
      });
    };
    wrap(Node.prototype, 'insertBefore');
    wrap(Node.prototype, 'appendChild');
    wrap(Node.prototype, 'removeChild');

    document.addEventListener(
      'scroll',
      (evt) => {
        const t = evt.target;
        if (t instanceof HTMLElement && t.matches(selector)) {
          window.__scrollEvents!.push({
            t: performance.now(),
            y: t.scrollTop,
            sh: t.scrollHeight,
            w: t.clientWidth,
            pad: parseFloat(getComputedStyle(t).paddingTop) || 0,
          });
          if (window.__scrollEvents!.length > 200) window.__scrollEvents!.shift();
        }
      },
      true
    );
  });

const takeDomDrops = (page: Page) =>
  page.evaluate(() => {
    const d = window.__domScrollDrops?.splice(0) ?? [];
    const s = window.__scrollEvents?.splice(0) ?? [];
    return { drops: d, scrollEvents: s };
  });

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

const logFrames = (label: string, frames: ListFrame[], maxPrint = 10) => {
  let printed = 0;
  console.log(`[${label}] frames=${frames.length}`);
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
    if (interesting && printed < maxPrint) {
      printed += 1;
      console.log(
        `  f${i} y:${prev.y.toFixed(1)}->${cur.y.toFixed(1)}(dy=${dy.toFixed(1)}) ` +
          `w:${prev.width}->${cur.width} pad:${prev.paddingTop.toFixed(0)}->${cur.paddingTop.toFixed(0)} ` +
          `sh:${prev.scrollHeight}->${cur.scrollHeight} topD=${Number.isFinite(topD) ? topD.toFixed(1) : 'n/a'} ` +
          `paintD=${Number.isFinite(paintD) ? paintD.toFixed(1) : 'n/a'} ` +
          `layShift=${Number.isFinite(layShift) ? layShift.toFixed(1) : 'n/a'} ` +
          `ord=${ordChg} pend=${cur.pending} held=${cur.held} writes=${cur.writes.length} ` +
          `reatt=${cur.reattached.length}`
      );
      for (const w of cur.writes) {
        const stack = w.stack.split('\n').slice(0, 5).join(' | ');
        console.log(
          `    WRITE ${w.method}(req=${w.requested ?? ''}) ${w.before.toFixed(1)}->${w.after.toFixed(1)} :: ${stack}`
        );
      }
    }
  }
};

const logDomDrops = (label: string, drops: DomScrollDrop[]) => {
  if (drops.length === 0) return;
  console.log(`[DOM-DROPS ${label}] count=${drops.length}`);
  for (const d of drops.slice(0, 6)) {
    console.log(
      `  ${d.op} y:${d.before.toFixed(1)}->${d.after.toFixed(1)} sh:${d.shBefore}->${d.shAfter} ` +
        `node=${d.nodeKey} ref=${d.refKey} active=${d.activeTag}(${d.activeKey}) :: ${d.stack}`
    );
  }
};

test.describe('Compact scroll jumps deep diagnostic', () => {
  test('desktop beside + scroll-reset-to-0 + height-growth-during-scroll-up @webkit', async ({
    page,
    browserName,
  }) => {
    test.setTimeout(180_000);
    test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver not running');
    await page.setViewportSize({ width: 1600, height: 900 });

    const suffix = randomUUID().slice(0, 8);
    const reader = await registerDisposableUser(`jmp2_${suffix}`, password);
    const agent = await registerAgentAccount(hs, `jmp2agent_${suffix}`);
    const roomId = await createRoom(hs, reader.accessToken, {
      name: 'Compact Jump Deep Diagnostic Room',
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

    // 65 threads with long titles that wrap when narrowed in 'beside' mode
    const roots: string[] = [];
    for (let i = 0; i < 65; i += 1) {
      const root = await send(
        `Thread #${i} - Long descriptive title that stays on one line when wide and wraps onto two or three lines when a thread column opens beside the list`
      );
      await send(
        `Initial reply for thread #${i}: short preview.`,
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
    // Force BESIDE thread layout so opening a thread keeps CompactRoomView mounted and narrows it!
    await page.addInitScript((user) => {
      localStorage.setItem('mindroom.threadColumn.layout', JSON.stringify('beside'));
      const key = `compactRoomSections:${user}`;
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ on: false, folded: [] }));
    }, reader.userId);
    await installDomDropTracer(page);
    await installListRecorder(page);
    await page.goto(rootPath);

    const view = () => page.locator(`${COMPACT}${LIVE}:not([data-thread-board-column] *)`);
    const card = (root: string) => view().locator(`[data-thread-root-id="${root}"]${LIVE}`);
    const ready = async () => {
      await expect(view().locator('[data-scroll-anchor]').first()).toBeAttached({ timeout: 30_000 });
      await page.evaluate(settleView);
    };
    await ready();
    console.log(`=== DEEP DESKTOP ENGINE=${browserName} ===`);

    const scrollByWheel = async (steps: number, dy: number) => {
      const rect = (await view().boundingBox())!;
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      for (let i = 0; i < steps; i += 1) {
        await page.mouse.wheel(0, dy);
        await page.waitForTimeout(16);
      }
    };

    // === EXP 1: Trace EXACT DOM call that drops scrollTop to 0 when an old thread sorts to top ===
    await scrollByWheel(25, 250);
    await page.evaluate(settleView);
    await page.mouse.move(8, 8);
    await page.waitForTimeout(800);
    const e1Before = (await takeFrames(page)).at(-1)!;
    await takeDomDrops(page);
    console.log(
      `[EXP1-before] y=${e1Before.y} max=${e1Before.max} sh=${e1Before.scrollHeight} ` +
        `visible=${e1Before.visible.map((r) => roots.indexOf(r.key)).join(',')}`
    );
    // Reply to roots[1] (bottom of list) -> sorts to index 0!
    await send('EXP1 live reply sorting roots[1] to top', roots[1]!);
    await page.waitForTimeout(1000);
    const e1Frames = await takeFrames(page);
    const e1Dom = await takeDomDrops(page);
    logFrames(`EXP1-resort-from-bottom-${browserName}`, [e1Before, ...e1Frames], 12);
    logDomDrops(`EXP1-resort-from-bottom-${browserName}`, e1Dom.drops);

    // === EXP 2: Same, but reply to a thread MIDDLE-BELOW viewport (NOT in view!) while scrolled mid-list ===
    await view().evaluate((el) => {
      el.scrollTop = 2000;
    });
    await page.evaluate(settleView);
    await page.mouse.move(8, 8);
    await page.waitForTimeout(800);
    const e2Before = (await takeFrames(page)).at(-1)!;
    await takeDomDrops(page);
    console.log(
      `[EXP2-before] y=${e2Before.y} visible=${e2Before.visible.map((r) => roots.indexOf(r.key)).join(',')}`
    );
    // Reply to roots[2] (far below viewport, ~4000px down!)
    await send('EXP2 live reply sorting offscreen roots[2] to top', roots[2]!);
    await page.waitForTimeout(1000);
    const e2Frames = await takeFrames(page);
    const e2Dom = await takeDomDrops(page);
    logFrames(`EXP2-resort-offscreen-below-${browserName}`, [e2Before, ...e2Frames], 12);
    logDomDrops(`EXP2-resort-offscreen-below-${browserName}`, e2Dom.drops);

    // === EXP 3: Open a thread BESIDE the Compact list (narrows CompactRoomView!) ===
    await view().evaluate((el) => {
      el.scrollTop = 2600;
    });
    await page.evaluate(settleView);
    const e3Before = (await takeFrames(page)).at(-1)!;
    await takeDomDrops(page);
    const clickedKey = e3Before.visible[2]!.key;
    const beforeClicked = e3Before.visible.find((r) => r.key === clickedKey)!;
    await card(clickedKey).click();
    await expect(page).toHaveURL(/threadId=/);
    await page.waitForTimeout(900);
    const e3Frames = await takeFrames(page);
    const e3Dom = await takeDomDrops(page);
    const e3After = e3Frames.at(-1)!;
    const afterClicked = e3After.visible.find((r) => r.key === clickedKey);
    logFrames(`EXP3-open-beside-${browserName}`, [e3Before, ...e3Frames], 12);
    logDomDrops(`EXP3-open-beside-${browserName}`, e3Dom.drops);
    console.log(
      `[EXP3-CLICKED-CARD ${browserName}] w:${e3Before.width}->${e3After.width} ` +
        `y:${e3Before.y.toFixed(1)}->${e3After.y.toFixed(1)} ` +
        `sh:${e3Before.scrollHeight}->${e3After.scrollHeight} ` +
        `clickedTop:${beforeClicked.top.toFixed(1)}->${afterClicked?.top.toFixed(1) ?? 'OFFSCREEN'} ` +
        `firstVisibleTop:${e3Before.visible[0]!.top.toFixed(1)}->${
          e3After.visible.find((r) => r.key === e3Before.visible[0]!.key)?.top.toFixed(1) ?? 'OFFSCREEN'
        }`
    );

    // Close thread, open Filter bar, and open thread BESIDE again!
    await page.goBack();
    await page.waitForTimeout(500);
    await page.locator('[data-thread-filter-bar-toggle]').first().click();
    await page.waitForTimeout(400);
    await view().evaluate((el) => {
      el.scrollTop = 2600;
    });
    await page.evaluate(settleView);
    const e4Before = (await takeFrames(page)).at(-1)!;
    await takeDomDrops(page);
    const e4Key = e4Before.visible[2]!.key;
    const e4BeforeCard = e4Before.visible.find((r) => r.key === e4Key)!;
    await card(e4Key).click();
    await expect(page).toHaveURL(/threadId=/);
    await page.waitForTimeout(900);
    const e4Frames = await takeFrames(page);
    const e4After = e4Frames.at(-1)!;
    const e4AfterCard = e4After.visible.find((r) => r.key === e4Key);
    logFrames(`EXP4-open-beside-with-filterbar-${browserName}`, [e4Before, ...e4Frames], 12);
    console.log(
      `[EXP4-CLICKED-CARD ${browserName}] w:${e4Before.width}->${e4After.width} ` +
        `pad:${e4Before.paddingTop}->${e4After.paddingTop} ` +
        `y:${e4Before.y.toFixed(1)}->${e4After.y.toFixed(1)} ` +
        `clickedTop:${e4BeforeCard.top.toFixed(1)}->${e4AfterCard?.top.toFixed(1) ?? 'OFFSCREEN'}`
    );

    // === EXP 5: Fast scroll UP while a card ABOVE the viewport grows height (e.g. thread init / edit) ===
    await page.goBack();
    await page.waitForTimeout(500);
    await view().evaluate((el) => {
      el.scrollTop = 3000;
    });
    await page.evaluate(settleView);
    await takeFrames(page);
    await takeDomDrops(page);
    // Start fast wheel UP and concurrently grow 3 cards ABOVE viewport (simulating lazy thread hydration / edit)
    const growAbove = view().evaluate(async (el) => {
      await new Promise((r) => setTimeout(r, 40));
      const cards = [...el.querySelectorAll<HTMLElement>('[data-scroll-anchor]')];
      for (const idx of [2, 5, 8]) {
        const c = cards[idx];
        if (c) c.style.paddingBottom = '60px';
      }
    });
    await scrollByWheel(12, -160);
    await growAbove;
    await page.waitForTimeout(400);
    const e5Frames = await takeFrames(page);
    logFrames(`EXP5-fast-scroll-up-height-growth-above-${browserName}`, e5Frames, 15);
  });
});
