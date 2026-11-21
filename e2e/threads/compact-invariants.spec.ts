/* eslint-disable no-await-in-loop -- replay interactions sequentially on one room and page. */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  disposableHomeserverIsUp,
  registerDisposableUser,
  DISPOSABLE_HOMESERVER as hs,
} from '../helpers/disposableAccounts';
import { fingersOn } from '../helpers/fingers';
import {
  BOARD,
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
  sendStateEvent,
} from '../helpers/matrix';
import { roomMoreOptions } from '../helpers/roomMenu';

const invariants = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7'] as const;
type Invariant = (typeof invariants)[number];
const cards = (frame: ListFrame) => frame.order.filter(([key]) => !key.startsWith('header:'));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const away = (frame: ListFrame) => frame.y > frame.height / 2;
const difference = (a: number, b: number) => Math.abs(a - b) > 1;
const positionWrites = (f: ListFrame) => f.writes.filter((w) => w.before !== w.after);
const restore = (stack: string) => stack.includes('scrollAnchorMemory');
const passiveOps = ['reply', 'new', 'resolve', 'pin', 'start', 'finish', 'title'];
const bag = `${passiveOps.join(
  ' '
)} filter sections fold sort wheel flick hover leave arrow back link resize pill`.split(' ');
const prefix =
  'wheel reply wheel reply pill pin back link sections start finish resolve fold title sections sort filter new wheel reply flick hover leave arrow resize'.split(
    ' '
  );
const boardOps = 'wheel reply start finish resolve pin new wheel reply resize'.split(' ');

function inspect(
  a: ListFrame,
  b: ListFrame,
  op: string,
  direction: number,
  report: (id: Invariant, reason: string) => void
) {
  const keys = new Set(b.order.map(([key]) => key));
  if (keys.size !== b.order.length) report('I4', 'duplicate displayed key');
  const writes = positionWrites(b);
  if (writes.length > 1) report('I3', 'multiple effective JS calls in one frame');
  if (op === 'wheel' && writes.some((w) => (w.after - w.before) * direction < -1))
    report('I3', 'JS write reversed the wheel direction');
  if (op === 'wheel' && writes.some((w) => restore(w.stack)))
    report('I6', 'placement wrote after reader scroll');
  if (a.view !== b.view || !a.order.length || !b.order.length) return;
  const before = cards(a).filter(([key]) => keys.has(key));
  const oldKeys = new Set(before.map(([key]) => key));
  const after = cards(b).filter(([key]) => oldKeys.has(key));
  const reordered = !same(before, after);
  if (!passiveOps.includes(op) || b.input.length) return;
  if (away(a)) {
    if (reordered) report('I1', 'calm survivor order/group changed');
    if (b.reattached.some((key) => oldKeys.has(key)))
      report('I1', 'calm survivor detached and reattached');
    const anchor = a.visible.find(
      (row) => oldKeys.has(row.key) && row.bottom > a.start && row.top < a.end
    );
    const next = b.visible.find((row) => row.key === anchor?.key);
    if (anchor && b.y > 1 && b.y < b.max - 1 && (!next || difference(anchor.painted, next.painted)))
      report('I1', 'calm visible witness drifted');
  } else {
    if (difference(b.y, Math.min(a.y, b.max))) report('I2', 'live offset changed');
    if (reordered) {
      for (const next of b.visible) {
        const old = a.visible.find((row) => row.key === next.key);
        if (!old || difference(old.top, old.painted) || !difference(old.top, next.top)) continue;
        if (difference(old.painted, next.origin ?? next.painted))
          report('I2', 'live survivor teleported instead of gliding');
      }
    }
  }
  // Geometry may move during a correction; a change of the actual hold is the contract breach.
  if (a.held !== b.held && away(a) !== away(b) && a.height === b.height && b.y < b.max - 1)
    report('I5', 'hold followed a passive half-screen crossing');
  if (writes.some((w) => restore(w.stack)))
    report('I6', 'settled placement wrote during a later update');
  if (away(a) && b.held && !b.pill && a.pill && same(a.order, b.order))
    report('I7', 'pending-order affordance disappeared before catch-up');
}

const password = 'compact-harness-test-only';
const framesPass = (count: number) =>
  new Promise<void>((done) => {
    const tick = () => {
      if (--count === 0) done();
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
      const enforced: Invariant[] = ['I4'];
      const log: string[] = [];
      const incidents: { id: Invariant; op: number; reason: string; frame?: ListFrame }[] = [];
      const started = Date.now();
      let sampleCount = 0;
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
        incidents.push({ id, op: sequence, reason, frame });
        console.log(`${id}: ${reason}; ${replay()}`);
      };

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
        const sendState = (type: string, key: string, content: Record<string, unknown>) =>
          sendStateEvent(hs, reader.accessToken, roomId, type, key, content);
        const send = (body: string, root?: string, pending = false) =>
          sendRoomMessage(hs, root ? agent.accessToken : reader.accessToken, roomId, {
            msgtype: 'm.text',
            body,
            ...(root
              ? {
                  'm.relates_to': {
                    rel_type: 'm.thread',
                    event_id: root,
                    is_falling_back: true,
                    'm.in_reply_to': { event_id: root },
                  },
                }
              : {}),
            ...(pending ? { 'io.mindroom.stream_status': 'pending' } : {}),
          });
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
          await page.evaluate(framesPass, 3);
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
          let target = roots[pick(roots.length)]!;
          const roll = pick(1800);
          const label = `Sample ${op} ${sequence}`;
          if (op === 'reply' && sequence <= 3) knownWinner = target = roots[sequence - 1]!;
          if (op === 'link') target = roots.at(-5)!;
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
              await sendRoomMessage(hs, agent.accessToken, roomId, {
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
              const key = previous.visible.find(({ key }) => !key.startsWith('header:'))?.key;
              if (key) {
                await card(key).focus();
                await page.keyboard.press(roll % 2 ? 'ArrowUp' : 'ArrowDown');
              }
              break;
            }
            case 'back': {
              const row = previous.visible.find(
                (r) =>
                  !r.key.startsWith('header:') &&
                  r.painted > previous.start &&
                  r.bottom < previous.end
              );
              if (!row) break;
              await card(row.key).click();
              await page.mouse.move(8, 8);
              await expect(page).toHaveURL(/threadId=/);
              await takeFrames(page);
              await page.goBack();
              await ready();
              break;
            }
            case 'link':
              await page.goto(`${rootPath}/${encodeURIComponent(target)}?focusEvent=1`);
              await ready();
              break;
            case 'resize':
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
          // Confirm the two known winners actually reach the client.
          if (op === 'reply' && sequence <= 3 && (await card(target).count()))
            await expect(card(target)).toContainText(label);
          await page.evaluate(
            framesPass,
            op === 'wheel' || op === 'flick' || passiveOps.includes(op) ? 24 : 8
          );
          const samples = await takeFrames(page);
          expect(samples.length, `no frames after ${op}`).toBeGreaterThan(0);
          sampleCount += samples.length;
          let prior = previous;
          for (const next of samples) {
            frame = next;
            inspect(prior, next, op, Math.sign(delta), report);
            prior = next;
          }
          if (
            op === 'link' &&
            !prior.visible.some(
              (r) => r.key === target && r.bottom > prior.start && r.painted < prior.end
            )
          )
            report('I6', 'linked card not in readable viewport');
          if (
            op === 'back' &&
            !prior.visible.some((r) =>
              previous.visible.some((p) => p.key === r.key && !difference(p.painted, r.painted))
            )
          )
            report('I6', 'Back did not restore a visible witness');
          if (op === 'wheel' && !away(previous) && away(prior) && !prior.held)
            report('I5', 'reader crossed half a screen without entering hold');
          if (sequence === 4 && knownWinner && !prior.held && prior.order[0]?.[0] !== knownWinner)
            report('I7', 'catch-up did not apply the known live winner');
          // Check a known live winner in the seeded newest-first flat list.
          if (
            op === 'reply' &&
            sequence <= 3 &&
            !prior.pending &&
            prior.order.some(([key]) => key === target)
          ) {
            if (away(previous) && previous.order[0]?.[0] !== target && !prior.pill)
              report('I7', 'known stale order without pill');
            if (!away(previous) && !prior.held && prior.order[0]?.[0] !== target)
              report('I2', 'live reply did not lead newest-first list');
          }
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
          incidents,
        };
        await writeFile(`${dir}/${project}.json`, JSON.stringify(summary, null, 2));
        for (const id of invariants)
          if (counts[id])
            info.annotations.push({
              type: id,
              description: `${counts[id]} incidents; SEED=${seed} OPS=${ops}`,
            });
      }
      const failures = invariants.filter(
        (id) =>
          counts[id] && (enforced.includes(id) || strict.includes(id) || strict.includes('all'))
      );
      expect(failures, `SEED=${seed} OPS=${ops}; see test-results/compact-invariants`).toEqual([]);
    });
  });
}
