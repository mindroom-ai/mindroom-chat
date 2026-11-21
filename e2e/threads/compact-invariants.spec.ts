/* eslint-disable no-await-in-loop -- replay interactions sequentially on one room and page. */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { compactOracle, fullyVisible, const passiveOps = ['reply', 'new', 'resolve', 'pin', 'start', 'finish', 'title'];
const bag = `${passiveOps.join(
  ' '
)} filter sections fold sort wheel flick hover leave arrow back link resize pill`.split(' ');
const prefix =
  'wheel reply wheel reply pill pin back link sections start finish resolve fold title sections sort filter new wheel reply flick hover leave arrow resize'.split(
    ' '
  );
const boardOps = 'wheel reply start finish resolve pin new wheel reply resize'.split(' ');
test('Compact oracle catches injected jumps, remounts and drift @webkit', async ({ page }) => {
  await installListRecorder(page);
  await page.route('**/compact-oracle-probe', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<main data-compact-room-view style="height: 130px; overflow:auto; overflow-anchor:none">${
      Array.from({ length: 12 }, (_, i) => `<div data-scroll-anchor="card-${i}" style="height:50px"><div data-motion-row>Card ${i}</div></div>`).join('')
    }</main>`,
  }));
  for (const defect of ['bottom jump', 'lower jump', 'remount', 'slow drift', 'reset to top']) {
    await test.step(defect, async () => {
      await page.goto('/compact-oracle-probe');
      const view = page.locator(COMPACT);
      await view.evaluate((element, bottom) => { element.scrollTop = bottom ? element.scrollHeight : 200; }, defect === 'bottom jump');
      await page.evaluate(settleView);
      let before = (await takeFrames(page)).at(-1)!;
      const catches: string[] = [];
      const oracle = compactOracle((id, reason) => catches.push(`${id}: ${reason}`));
      oracle.scope();
      oracle.sample(before, before);
      await view.evaluate(async (element, { defect: kind, key }) => {
        const row = element.querySelector<HTMLElement>(`[data-scroll-anchor="${key}"]`)!;
        const paint = row.firstElementChild as HTMLElement;
        if (kind === 'remount') row.replaceWith(row.cloneNode(true));
        else if (kind === 'reset to top') element.scrollTop = 0;
        else if (kind === 'slow drift') {
          for (let i = 1; i <= 6; i += 1) {
            paint.style.translate = `0px ${i * 0.5}px`;
            await new Promise(requestAnimationFrame);
          }
        } else paint.style.translate = '0px 30px';
      }, { defect, key: before.visible[defect === 'lower jump' ? 1 : 0]!.key });
      await page.evaluate(settleView);
      for (const next of await takeFrames(page)) {
        oracle.sample(before, next);
        before = next;
      }
      expect(catches, defect).toContain(defect === 'remount'
        ? 'I1: calm survivor detached and reattached' : 'I1: calm visible survivor drifted');
    });
  }
});

const password = 'compact-harness-test-only';
const settleView = () => new Promise<void>((resolve, reject) => {
  let previous: ListFrame | undefined;
  let stable = 0;
  const deadline = performance.now() + 5000;
  const tick = () => {
    const sample = window.compactRecorder.last;
    if (sample && sample !== previous) {
      stable = previous && previous.view === sample.view && Math.abs(previous.y - sample.y) < 0.1 && !sample.moving && !sample.pending ? stable + 1 : 0;
      previous = sample;
    }
    if (stable >= 5) resolve();
    else if (performance.now() > deadline) reject(Error('Compact scroller did not settle'));
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
for (const phone of [false, true]) {
  const form = phone ? 'phone' : 'desktop';
  const size = { width: phone ? 390 : 1440, height: phone ? 780 : 900 };
  test.describe(form, () => {
    // Mobile WebKit rejects mouse.wheel; the narrow viewport still takes the phone layout.
    test.use({
      viewport: size,
      hasTouch: phone,
      isMobile: async ({ browserName }, use) => {
        await use(phone && browserName === 'chromium');
      },
    });
    test('records Compact frame invariants @webkit', async ({ page, browserName }, info) => {
      test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${hs}`);
      const seed = Number(process.env.SEED ?? 725);
      const ops = Number(process.env.OPS ?? process.env.COMPACT_INVARIANTS_OPS ?? 40);
      test.setTimeout(235_000 + Math.max(0, ops - 40) * 2200);
      expect(
        Number.isSafeInteger(seed) && Number.isSafeInteger(ops) && ops > 0,
        'integer seed and positive operation count'
      ).toBe(true);
      let state = seed;
      const pick = (length: number) => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return Math.floor((state / 2 ** 32) * length);
      };
      const counts = { I1: 0, I2: 0, I3: 0, I4: 0, I5: 0, I6: 0, I7: 0 };
      const strict = (process.env.COMPACT_INVARIANTS_STRICT ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      expect(strict.every((id) => id === 'all' || invariants.some((known) => id === known))).toBe(
        true
      );
      const enforced: Invariant[] = ['I3', 'I4'];
      const log: string[] = [];
      const incidents: { id: Invariant; op: number; reason: string; before?: ListFrame; after?: ListFrame; dy?: number }[] = [];
      const started = Date.now();
      let sampleCount = 0;
      let before: ListFrame | undefined;
      let frame: ListFrame | undefined;
      let sequence = 0;
      const seen = new Set<string>();
      const replay = () =>
        `SEED=${seed} OPS=${sequence + 1}; op=${sequence}; ${log.slice(-5).join(', ')}`;
      const report = (id: Invariant, reason: string) => {
        const key = `${sequence}/${id}/${reason}`;
        if (seen.has(key)) return;
        seen.add(key);
        counts[id] += 1;
        incidents.push({ id, op: sequence, reason, before, after: frame, dy: frame && before ? frame.y - before.y : undefined });
        console.log(`${id}: ${reason}; ${replay()}`);
      };
      const oracle = compactOracle(report);
      try {
        const suffix = randomUUID().slice(0, 8);
        const reader = await registerDisposableUser(`inv_${suffix}`, password);
        const agent = await registerAgentAccount(hs, `invagent_${suffix}`);
        const roomId = await createRoom(hs, reader.accessToken, {
          name: 'Sample workshop',
          invite: [agent.userId],
        });
        await joinRoom(hs, agent.accessToken, roomId);
        const rootPath = `/home/${encodeURIComponent(roomId)}`;
        const roots: string[] = [];
        const pinned = new Set<string>();
        const resolved = new Set<string>();
        const runs = new Map<string, string>();
        let delivery: string | undefined;
        const bodies: string[] = [];
        page.on('response', (response) => {
          if (!response.url().includes('/sync?') || !response.ok()) return;
          void response.text().then((body) => {
            bodies.push(body);
            if (bodies.length > 8) bodies.shift();
          }).catch(() => {});
        });
        const synced = async () => {
          if (delivery) await expect.poll(() => bodies.some((body) => body.includes(JSON.stringify(delivery))),
            { message: 'the browser received the Matrix change', timeout: 10_000 }).toBe(true);
        };
        const sendState = async (type: string, key: string, content: Record<string, unknown>) => {
          const path = `/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(type)}/${encodeURIComponent(key)}`;
          const response = await matrixFetch<{ event_id: string }>(hs, path, {
            method: 'PUT', accessToken: reader.accessToken, body: JSON.stringify(content),
          });
          delivery = response.event_id;
        };
        const send = async (body: string, root?: string, pending = false) => {
          delivery = await sendRoomMessage(hs, root ? agent.accessToken : reader.accessToken, roomId, {
            msgtype: 'm.text', body,
            ...(root ? { 'm.relates_to': { rel_type: 'm.thread', event_id: root, is_falling_back: true,
              'm.in_reply_to': { event_id: root } } } : {}),
            ...(pending ? { 'io.mindroom.stream_status': 'pending' } : {}),
          });
          return delivery;
        };
        const add = async (label: string) => {
          const root = await send(label);
          await send(`Answer to ${label}`, root);
          roots.push(root);
          return root;
        };
        for (let i = 0; i < 32; i += 1) await add(`Sample ticket ${i}`);
        runs.set(roots[2]!, await send('Starting a sample run', roots[2], true));
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
        let board = false;
        const boardEnabled = process.env.MINDROOM_CLIENT_PLUGINS?.includes('example-plugin');
        const view = () =>
          page.locator(
            board
              ? `${BOARD} ${COMPACT}${LIVE}`
              : `${COMPACT}${LIVE}:not([data-thread-board-column] *)`
          );
        const card = (root: string) => view().locator(`[data-thread-root-id="${root}"]${LIVE}`);
        const ready = async () => {
          await expect(view().locator('[data-scroll-anchor]').first()).toBeAttached({
            timeout: 30_000,
          });
          await expect(page.locator('html[data-page-slide]')).toHaveCount(0);
          await page.evaluate(settleView);
        };
        const touch = phone && browserName === 'chromium' ? await fingersOn(page) : undefined;
        const sort = page.locator(`[data-sort-direction]${LIVE}`).first();
        const sections = page.locator(`[data-thread-sections]${LIVE}`).first();
        const choose = async () => {
          const rect = await view().boundingBox();
          if (!rect) throw Error('Compact scroller not visible');
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        };
        const wheel = async (dy: number) => {
          const { x, y } = await choose();
          await page.mouse.move(x, y);
          await page.mouse.wheel(0, dy);
          await page.mouse.move(8, 8);
        };
        await ready();
        frame = (await takeFrames(page)).at(-1);
        expect(frame?.visible.length, 'initial visible witnesses').toBeGreaterThan(0);
        oracle.scope();
        oracle.sample(frame!, frame!);
        let pool: string[] = [];
        const boardAt = 27;
        let knownWinner: string | undefined;
        const openBoard = async () => {
          await roomMoreOptions(page).click();
          await page.getByRole('menuitemcheckbox', { name: 'Example board', exact: true }).click();
          board = true;
          await page.evaluate(() => {
            window.compactRecorder.board = true;
          });
          await ready();
          await page.locator(BOARD).scrollIntoViewIfNeeded();
          const more = page.locator(BOARD).getByRole('button', { name: 'Show more' });
          if (await more.isVisible()) await more.click();
        };
        for (; sequence < ops; sequence += 1) {
          if (!pool.length) pool = [...bag];
          let op = prefix[sequence] ?? pool.splice(pick(pool.length), 1)[0]!;
          if (boardEnabled && sequence === boardAt) op = 'board';
          if (board) op = boardOps[(sequence - boardAt - 1) % boardOps.length]!;
          const control = op === 'sections' ? sections : op === 'sort' ? sort : undefined;
          if (control && !(await control.isVisible())) op = 'filter';
          const previous = frame!;
          delivery = undefined;
          let target = roots[pick(roots.length)]!;
          const roll = pick(1800);
          const label = `Sample ${op} ${sequence}`;
          if (op === 'reply' && sequence <= 3) knownWinner = target = roots[sequence - 1]!;
          if (op === 'link') target = previous.order.filter(([key]) => roots.includes(key) && !resolved.has(key)).at(-5)?.[0] ?? target;
          if (op === 'pin' && pinned.size && board) target = pinned.values().next().value!;
          if (op === 'finish') target = runs.keys().next().value ?? target;
          let delta = op === 'wheel' ? roll - 900 || 400 : 0;
          if (sequence === 0) delta = Math.floor(previous.height / 4);
          if (sequence === 2) delta = previous.height;
          if (sequence === 18) delta = -previous.y;
          log.push(
            `${sequence}:${board ? 'board/' : ''}${op}(ticket ${roots.indexOf(
              target
            )}, roll ${roll}${delta ? `, ${delta}px` : ''})`
          );
          switch (op) {
            case 'reply':
              if (sequence <= 3) await page.evaluate((proof) => { window.compactRecorder.evidence = proof; }, [target, label] as [string, string]);
              await send(label, target);
              break;
            case 'new':
              target = await add(label);
              break;
            case 'resolve': {
              const on = !resolved.delete(target);
              if (on) resolved.add(target);
              await sendState(
                'com.mindroom.thread.tags',
                JSON.stringify([target, 'resolved']),
                on ? { set_by: reader.userId, set_at: new Date().toISOString() } : {}
              );
              break;
            }
            case 'pin':
              if (!pinned.delete(target)) pinned.add(target);
              await sendState('m.room.pinned_events', '', {
                pinned: [...pinned],
              });
              break;
            case 'start':
              if (!runs.has(target)) runs.set(target, await send(label, target, true));
              break;
            case 'finish': {
              const event = runs.get(target);
              if (!event) break;
              const content = {
                msgtype: 'm.text',
                body: label,
                'io.mindroom.stream_status': 'completed',
              };
              delivery = await sendRoomMessage(hs, agent.accessToken, roomId, {
                ...content,
                'm.new_content': content,
                'm.relates_to': { rel_type: 'm.replace', event_id: event },
              });
              runs.delete(target);
              break;
            }
            case 'title':
              await sendState('io.mindroom.thread_summary', target, {
                version: 1,
                summary: `${label} ${'with further details '.repeat(18)}`,
                message_count: 2,
                generated_at: new Date().toISOString(),
                model: 'sample',
              });
              break;
            case 'filter':
              if (phone) await roomMoreOptions(page).click();
              await page.locator('[data-thread-filter-bar-toggle]').first().click();
              break;
            case 'sections':
              await sections.click();
              break;
            case 'fold': {
              const button = view().locator('[data-compact-section] button').first();
              if (await button.isVisible()) await button.click();
              break;
            }
            case 'sort':
              await sort.click();
              break;
            case 'wheel':
              await wheel(delta);
              break;
            case 'flick': {
              if (!touch) {
                await wheel(previous.height * 0.8);
                break;
              }
              const { x, y } = await choose();
              await touch('touchStart', [[1, x, y + 110]]);
              for (let step = 1; step <= 6; step += 1)
                await touch('touchMove', [[1, x, y + 110 - step * 38]]);
              await touch('touchEnd', []);
              break;
            }
            case 'hover': {
              const { x, y } = await choose();
              await page.mouse.move(x, y);
              break;
            }
            case 'leave':
              await page.mouse.move(8, 8);
              break;
            case 'arrow': {
              const row = fullyVisible(previous)[0];
              if (row) {
                await card(row.key).evaluate((element: HTMLElement) => element.focus({ preventScroll: true }));
                await page.keyboard.press(roll % 2 ? 'ArrowUp' : 'ArrowDown');
              }
              break;
            }
            case 'back': {
              const row = fullyVisible(previous)[0];
              if (!row) break;
              await card(row.key).click();
              await page.mouse.move(8, 8);
              await expect(page).toHaveURL(/threadId=/);
              await takeFrames(page);
              const mover = roots.find((key) => !previous.visible.some((old) => old.key === key))!;
              await send(label, mover);
              await synced();
              oracle.start(previous, undefined, mover);
              await page.goBack();
              await ready();
              break;
            }
            case 'link':
              if (!previous.order.some(([key]) => key === target) || resolved.has(target)) break;
              oracle.start(previous, target);
              await page.goto(`${rootPath}/${encodeURIComponent(target)}?focusEvent=1`);
              await ready();
              break;
            case 'resize':
              oracle.scope();
              await page.setViewportSize({ ...size, height: size.height - (roll % 200) });
              break;
            case 'pill': {
              const pill = view().getByRole('button', { name: 'Show updated order' });
              if (await pill.isVisible()) await pill.click();
              else if (previous.y > 0) await wheel(-previous.y);
              break;
            }
            case 'board':
              await openBoard();
              break;
          }
          await synced();
          if (op === 'reply' && sequence <= 3) await expect.poll(async () => {
            const texts = await card(target).allTextContents();
            return !texts.length || texts.some((text) => text.includes(label));
          }, { message: 'mounted reply preview reflects the sync' }).toBe(true);
          await page.evaluate(settleView);
          const samples = await takeFrames(page);
          expect(samples.length, `no frames after ${op}`).toBeGreaterThan(0);
          sampleCount += samples.length;
          for (const next of samples) {
            before = frame;
            frame = next;
            oracle.sample(before!, frame);
          }
          oracle.settle(frame!, sequence <= 4 ? knownWinner : undefined);
        }
      } catch (error) {
        console.log(`Harness error: ${replay()}`);
        throw error;
      } finally {
        const project = `${info.project.name}-${form}`;
        const dir = `test-results/compact-invariants${
          info.repeatEachIndex ? `/run-${info.repeatEachIndex + 1}` : ''
        }`;
        await mkdir(dir, { recursive: true });
        const summary = {
          seed,
          ops,
          project,
          ms: Date.now() - started,
          sampleCount,
          counts,
          enforced,
          log,
          mode: 'oracle: reader latch; baseline products may recompute from geometry',
          incidents,
        };
        await writeFile(`${dir}/${project}-retry-${info.retry}.json`, JSON.stringify(summary, null, 2));
        for (const id of invariants)
          if (counts[id])
            info.annotations.push({
              type: id,
              description: `${counts[id]} incidents; SEED=${seed} OPS=${ops}`,
            });
      }
      const first = incidents.find(({ id }) => enforced.includes(id) || strict.includes(id) || strict.includes('all'));
      expect(first, `SEED=${seed} OPS=${first ? first.op + 1 : ops}; first failure: ${JSON.stringify(first)}`).toBeUndefined();
    });
  });
}
