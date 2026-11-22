/* eslint-disable no-await-in-loop, no-console -- investigative probe v4: isolate reatt=2 vs reatt=63, mid-scroll edit, sections unread open. */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
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

const summary = (label: string, frames: ListFrame[]) => {
  console.log(`[${label}] frames=${frames.length}`);
  for (let i = 1; i < frames.length; i += 1) {
    const p = frames[i - 1]!;
    const c = frames[i]!;
    const dy = c.y - p.y;
    const pMap = new Map(p.visible.map((r) => [r.key, r]));
    const first = c.visible.find((r) => pMap.has(r.key));
    const topD = first ? first.top - pMap.get(first.key)!.top : Number.NaN;
    const paintD = first ? first.painted - pMap.get(first.key)!.painted : Number.NaN;
    const layShift = first ? topD + dy : Number.NaN;
    const ord =
      p.order.length !== c.order.length ||
      p.order.some(([k, g], idx) => c.order[idx]?.[0] !== k || c.order[idx]?.[1] !== g);
    if (
      Math.abs(dy) >= 2 ||
      Math.abs(topD) >= 2 ||
      Math.abs(paintD) >= 2 ||
      Math.abs(c.paddingTop - p.paddingTop) >= 1 ||
      Math.abs(c.scrollHeight - p.scrollHeight) >= 2 ||
      ord ||
      c.writes.length > 0
    ) {
      console.log(
        `  f${i} y:${p.y.toFixed(1)}->${c.y.toFixed(1)}(dy=${dy.toFixed(1)}) ` +
          `pad:${p.paddingTop.toFixed(0)}->${c.paddingTop.toFixed(0)} ` +
          `sh:${p.scrollHeight}->${c.scrollHeight} topD=${Number.isFinite(topD) ? topD.toFixed(1) : 'n/a'} ` +
          `paintD=${Number.isFinite(paintD) ? paintD.toFixed(1) : 'n/a'} ` +
          `layShift=${Number.isFinite(layShift) ? layShift.toFixed(1) : 'n/a'} ` +
          `ord=${ord} held=${c.held} writes=${c.writes.length} reatt=${c.reattached.length}`
      );
      for (const w of c.writes) {
        console.log(
          `    WRITE ${w.method}(req=${w.requested ?? ''}) ${w.before.toFixed(1)}->${w.after.toFixed(1)} :: ${w.stack
            .split('\n')
            .slice(0, 3)
            .join(' | ')}`
        );
      }
    }
  }
};

test('isolate reatt=2 vs reatt=63, mid-scroll-up edit, and sections unread open @webkit', async ({
  page,
  browserName,
}) => {
  test.setTimeout(180_000);
  test.skip(!(await disposableHomeserverIsUp()), 'Disposable homeserver not running');
  await page.setViewportSize({ width: 1440, height: 900 });

  const suffix = randomUUID().slice(0, 8);
  const reader = await registerDisposableUser(`jmp4_${suffix}`, password);
  const agent = await registerAgentAccount(hs, `jmp4agent_${suffix}`);
  const roomId = await createRoom(hs, reader.accessToken, {
    name: 'Isolation Probe Room',
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
  for (let i = 0; i < 65; i += 1) {
    const root = await send(`Thread #${i} - Short`);
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
    localStorage.setItem(`compactRoomSections:${user}`, JSON.stringify({ on: false, folded: [] }));
  }, reader.userId);
  await installListRecorder(page);
  await page.goto(rootPath);

  const view = () => page.locator(`${COMPACT}${LIVE}:not([data-thread-board-column] *)`);
  await expect(view().locator('[data-scroll-anchor]').first()).toBeAttached({ timeout: 30_000 });
  await page.evaluate(settleView);
  console.log(`=== ISOLATE ENGINE=${browserName} ===`);

  const wheelTo = async (steps: number, dy: number) => {
    const rect = (await view().boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    for (let i = 0; i < steps; i += 1) {
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(16);
    }
  };

  // --- CHECK 1: Re-sort a card ABOVE viewport (index 2 -> index 0, reatt=2, visible cards untouched!) ---
  await wheelTo(12, 220);
  await page.evaluate(settleView);
  await page.mouse.move(8, 8);
  await page.waitForTimeout(800);
  const c1Before = (await takeFrames(page)).at(-1)!;
  const aboveKey = c1Before.order[2]![0];
  await send('Check 1 reply to index 2 (above viewport)', aboveKey);
  await page.waitForTimeout(900);
  const c1Frames = await takeFrames(page);
  summary(`C1-resort-above-viewport-reatt2-${browserName}`, [c1Before, ...c1Frames]);

  // --- CHECK 2: Re-sort a card BELOW viewport (index 63 -> index 0, reatt=63, visible cards re-inserted!) ---
  const c2Before = (await takeFrames(page)).at(-1) ?? c1Before;
  const belowKey = c2Before.order.at(-2)![0];
  await send('Check 2 reply to index 63 (below viewport)', belowKey);
  await page.waitForTimeout(900);
  const c2Frames = await takeFrames(page);
  summary(`C2-resort-below-viewport-reatt63-${browserName}`, [c2Before, ...c2Frames]);

  // --- CHECK 3: Mid-fast-scroll-up edit of card above viewport (does scrollTop !== before.scrollTop skip fallback?) ---
  await wheelTo(16, 220);
  await page.evaluate(settleView);
  await page.mouse.move(8, 8);
  await page.waitForTimeout(800);
  await takeFrames(page);
  // Start fast wheel UP continuously, firing root edits DURING the wheel burst!
  const rect = (await view().boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  let editSent = false;
  for (let i = 0; i < 24; i += 1) {
    await page.mouse.wheel(0, -100);
    if (i === 4 && !editSent) {
      editSent = true;
      void editRoot(
        roots[60]!,
        'Thread #60 - Very long edited title that wraps onto three or four lines when rendered inside the compact card above the active scroll position during fast upward wheel scrolling'
      );
      void editRoot(
        roots[59]!,
        'Thread #59 - Very long edited title that wraps onto three or four lines when rendered inside the compact card above the active scroll position during fast upward wheel scrolling'
      );
      void editRoot(
        roots[58]!,
        'Thread #58 - Very long edited title that wraps onto three or four lines when rendered inside the compact card above the active scroll position during fast upward wheel scrolling'
      );
    }
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(600);
  const c3Frames = await takeFrames(page);
  summary(`C3-mid-scroll-up-root-edit-${browserName}`, c3Frames);

  // --- CHECK 4: Sections mode ON + click an unread card to open thread beside ---
  const sectionsBtn = page.locator(`[data-thread-sections]${LIVE}`).first();
  if (!(await sectionsBtn.isVisible())) {
    await page.locator('[data-thread-filter-bar-toggle]').first().click();
    await page.waitForTimeout(300);
  }
  await sectionsBtn.click();
  await page.waitForTimeout(500);
  await wheelTo(10, 220);
  await page.evaluate(settleView);
  const c4Before = (await takeFrames(page)).at(-1)!;
  const unreadCard = c4Before.visible.find((r) => !r.key.startsWith('header:'));
  if (unreadCard) {
    await view().locator(`[data-thread-root-id="${unreadCard.key}"]${LIVE}`).click();
    await expect(page).toHaveURL(/threadId=/);
    await page.mouse.move(1250, 450);
    await page.waitForTimeout(1200);
    const c4Frames = await takeFrames(page);
    summary(`C4-sections-open-unread-beside-${browserName}`, [c4Before, ...c4Frames]);
  }
});
