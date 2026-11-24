import { randomUUID } from 'node:crypto';
import {
  type BrowserContextOptions,
  type Page,
  type Route,
  chromium,
  expect,
} from '@playwright/test';
import { loginWithPassword } from './auth';
import { png, send, wait } from './busyThreadRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER,
  type DisposableUser,
  registerDisposableUser,
} from './disposableAccounts';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  seedRoomOverviewState,
} from './matrix';
import { clearProbeCacheStore, installThreadJumpProbe } from './threadJumpProbe';
import { launchWebKit } from './webkit';

export type ThreadJumpSetup = { engine: 'chromium' | 'webkit'; viewport: 'desktop' | 'phone' };

export const THREAD_JUMP_VIEWPORTS: Record<ThreadJumpSetup['viewport'], BrowserContextOptions> = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true },
};

export const THREAD_JUMP_PASSWORD = 'thread-timeline-jumps-password';
export const THREAD_ROWS_SELECTOR = '[data-timeline-rows][data-thread-count]';
export const THREAD_SCROLL_OWNER_FLAG_KEY = 'mindroom.threadScrollOwner';

export type ThreadJumpFixtureWorld = {
  reader: DisposableUser;
  agent: DisposableUser;
  roomId: string;
  longThreadRootId: string;
};

const inThread = (rootId: string, replyTo: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: replyTo },
  },
});

const uploadPng = async (token: string, width: number, height: number, hue: number) => {
  const res = await fetch(`${DISPOSABLE_HOMESERVER}/_matrix/media/v3/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
    body: png(width, height, hue),
  });
  return ((await res.json()) as { content_uri: string }).content_uri;
};

const longCollapsibleText = (turn: number): string =>
  [
    `User detailed log paste for turn #${turn}:`,
    ...Array.from(
      { length: 48 },
      (_, i) =>
        `line ${i + 1}: worker=${turn} trace=0x${((turn * 100 + i) * 2654435761)
          .toString(16)
          .slice(0, 8)} checking thread timeline scroll anchoring and layout heights`
    ),
  ].join('\n');

const longAgentAnswer = (turn: number) => {
  const extraCode = turn % 3 === 0 ? 55 : turn % 2 === 0 ? 28 : 10;
  const codeLines = Array.from(
    { length: extraCode },
    (_, i) =>
      `const step_${turn}_${i} = computeAnchorOffset(rows[${i}], scrollTop + inset - listTop);`
  ).join('\n');
  const tableRows = Array.from(
    { length: 5 },
    (_, i) => `<tr><td>metric_${turn}_${i}</td><td>${120 + i * 37}px</td><td>verified</td></tr>`
  ).join('');
  return {
    msgtype: 'm.text',
    body: `🔧 bash [1]\n\nTurn #${turn} summary.\n\n\`\`\`ts\n${codeLines}\n\`\`\`\n\nDone for turn #${turn}.`,
    format: 'org.matrix.custom.html',
    formatted_body: [
      '<p>🔧 <code>bash</code> [1]</p>',
      `<p>Turn #${turn} summary: investigated layout and scroll measurements with folded steps, code blocks, and images.</p>`,
      `<pre><code class="language-ts">${codeLines}</code></pre>`,
      `<table><thead><tr><th>Metric</th><th>Delta</th><th>Status</th></tr></thead><tbody>${tableRows}</tbody></table>`,
      `<p>Follow-up notes for turn #${turn}.</p>`,
    ].join('\n'),
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.tool_trace': {
      version: 2,
      events: [
        {
          type: 'tool_call_completed',
          tool_name: 'bash',
          args_preview: `rg "scrollTop" src/app/timeline/ # turn ${turn}`,
          result_preview: `Found 14 matches across 6 files for turn ${turn}\n`.repeat(8),
          truncated: false,
        },
      ],
    },
  };
};

export const buildThreadJumpFixtureWorld = async (): Promise<ThreadJumpFixtureWorld> => {
  const tag = randomUUID().slice(0, 8);
  const reader = await registerDisposableUser(`jreader_${tag}`, THREAD_JUMP_PASSWORD);
  const agent = await registerDisposableUser(`mindroom_dev_${tag}`, THREAD_JUMP_PASSWORD);
  const roomId = await createPrivateRoom(DISPOSABLE_HOMESERVER, reader.accessToken, {
    name: `Timeline Jumps ${tag}`,
    topic: 'Realistic agent thread timeline jump regression fixture',
    invite: [agent.userId],
  });
  await joinRoom(DISPOSABLE_HOMESERVER, agent.accessToken, roomId);

  const imgSized = await uploadPng(agent.accessToken, 800, 520, 40);
  const imgUnsized = await uploadPng(agent.accessToken, 680, 560, 160);
  const longThreadRootId = await send(reader, roomId, 'm.room.message', {
    msgtype: 'm.text',
    body: `Realistic agent thread (${tag})`,
  });
  let lastId = longThreadRootId;
  const sendInThread = async (user: DisposableUser, content: Record<string, unknown>) => {
    lastId = await send(user, roomId, 'm.room.message', {
      ...content,
      ...inThread(longThreadRootId, lastId),
    });
  };

  for (let turn = 1; turn <= 56; turn += 1) {
    const body =
      turn % 3 === 0
        ? longCollapsibleText(turn)
        : `Turn #${turn}: check scroll stability across folded turns and older history pages.`;
    // eslint-disable-next-line no-await-in-loop
    await sendInThread(reader, { msgtype: 'm.text', body });
    for (let step = 1; step <= 3; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sendInThread(agent, {
        msgtype: 'm.text',
        body: `Step ${step}/3 for turn #${turn}: inspecting scroll ledger measurements.\n`.repeat(
          4
        ),
        'io.mindroom.stream_status': 'completed',
      });
    }
    if (turn % 4 === 1) {
      const hasDims = turn % 8 === 1;
      // eslint-disable-next-line no-await-in-loop
      await sendInThread(agent, {
        msgtype: 'm.image',
        body: `diagram-turn-${turn}.png`,
        url: hasDims ? imgSized : imgUnsized,
        info: hasDims ? { mimetype: 'image/png', w: 800, h: 520 } : { mimetype: 'image/png' },
      });
    }
    // eslint-disable-next-line no-await-in-loop
    await sendInThread(agent, longAgentAnswer(turn));
  }

  await sendInThread(agent, {
    msgtype: 'm.notice',
    body: 'Realistic agent thread timeline jump regression',
    'io.mindroom.thread_summary': {
      version: 1,
      summary: 'Realistic agent thread timeline jump regression',
      message_count: 295,
      generated_at: new Date().toISOString(),
      model: 'test',
    },
  });
  return { reader, agent, roomId, longThreadRootId };
};

export const routeQuietly = (
  page: Page,
  pattern: string,
  handler: (route: Route) => Promise<void>
) =>
  page.route(pattern, async (route) => {
    try {
      await handler(route);
    } catch {
      // Page closed while a delayed background request was in flight.
    }
  });

export const delayMediaAndRelations = async (page: Page, mediaMs: number, relationsMs: number) => {
  await routeQuietly(page, '**/_matrix/client/v1/media/**', async (route) => {
    await wait(mediaMs);
    await route.fallback();
  });
  await routeQuietly(page, '**/relations/**', async (route) => {
    if (route.request().url().includes('from=')) await wait(relationsMs);
    await route.fallback();
  });
};

export const gotoThreadCard = async (page: Page, fixture: ThreadJumpFixtureWorld) => {
  await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
  const card = page.locator(
    `[data-compact-room-view="true"] [data-thread-root-id="${fixture.longThreadRootId}"]`
  );
  await expect(card).toBeVisible({ timeout: 30_000 });
  return card;
};

export const openThreadCard = async (
  page: Page,
  fixture: ThreadJumpFixtureWorld,
  opts: { mediaMs?: number; relationsMs?: number; clearCache?: boolean } = {}
) => {
  await delayMediaAndRelations(page, opts.mediaMs ?? 350, opts.relationsMs ?? 650);
  const card = await gotoThreadCard(page, fixture);
  if (opts.clearCache) await clearProbeCacheStore(page);
  await page.waitForTimeout(400);
  await card.click();
  await expect(page.locator(THREAD_ROWS_SELECTOR)).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => page.locator('[data-message-item]').count(), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(250);
};

export const openAndRunThreadJump = async (
  setup: ThreadJumpSetup,
  baseURL: string | undefined,
  fixture: ThreadJumpFixtureWorld,
  body: (page: Page) => Promise<void>,
  beforeLogin?: (page: Page) => Promise<void>,
  { enableOwner }: { enableOwner?: boolean } = {}
) => {
  const browser =
    setup.engine === 'webkit'
      ? await launchWebKit()
      : await chromium.launch({
          executablePath: process.env.CHROMIUM_PATH || undefined,
          args: CHROMIUM_WITH_SCROLLBARS.args,
        });
  try {
    const context = await browser.newContext({
      ...THREAD_JUMP_VIEWPORTS[setup.viewport],
      ...(setup.viewport === 'phone' && setup.engine === 'chromium' ? { isMobile: true } : {}),
      baseURL,
    });
    const shouldEnableOwner = enableOwner ?? process.env.MR_THREAD_SCROLL_OWNER === '1';
    if (shouldEnableOwner) {
      await context.addInitScript(
        (key) => window.localStorage.setItem(key, '1'),
        THREAD_SCROLL_OWNER_FLAG_KEY
      );
    }
    const page = await context.newPage();
    await page.addInitScript(installThreadJumpProbe);
    if (beforeLogin) await beforeLogin(page);

    await loginWithPassword(page, {
      homeserver: DISPOSABLE_HOMESERVER,
      username: fixture.reader.username,
      password: THREAD_JUMP_PASSWORD,
    });
    await seedRoomOverviewState({
      page,
      roomId: fixture.roomId,
      userId: fixture.reader.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });
    try {
      await body(page);
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  } finally {
    await browser.close();
  }
};

export const readThreadScrollState = (page: Page) =>
  page.evaluate((sel) => {
    const inner = document.querySelector<HTMLElement>(sel);
    let scroller: HTMLElement | null = inner?.parentElement ?? null;
    while (scroller) {
      const oy = getComputedStyle(scroller).overflowY;
      if (oy === 'auto' || oy === 'scroll') break;
      scroller = scroller.parentElement;
    }
    if (!inner || !scroller) return null;
    const view = scroller.getBoundingClientRect();
    const reserve = inner.querySelector<HTMLElement>('[data-testid="thread-headroom-reserve"]');
    const skeletonRows = Array.from(
      inner.querySelectorAll<HTMLElement>('[data-headroom-skeleton-row="true"]')
    );
    const visibleSkeletonRows = skeletonRows.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.bottom > view.top && r.top < view.bottom;
    }).length;
    const row0 = inner.querySelector<HTMLElement>('[data-index="0"]');
    const row0Rect = row0?.getBoundingClientRect();
    const row0Visible =
      !!row0Rect && row0Rect.height > 0 && row0Rect.bottom > view.top && row0Rect.top < view.bottom;
    const track = scroller.querySelector<HTMLElement>('[role="scrollbar"]');
    const thumb = track?.querySelector<HTMLElement>('[data-scrollbar-thumb="true"]');
    const trackRect = track?.getBoundingClientRect();
    const thumbRect = thumb?.getBoundingClientRect();
    return {
      scrollTop: Math.round(scroller.scrollTop),
      scrollHeight: Math.round(scroller.scrollHeight),
      clientHeight: Math.round(scroller.clientHeight),
      headroomPx: Number(inner.dataset.headroomPx ?? 0),
      threadCount: Number(inner.dataset.threadCount ?? 0),
      hasReserve: !!reserve,
      visibleSkeletonRows,
      row0Visible,
      scrollbarDragging: scroller.dataset.scrollbarDragging === 'true',
      trackBox: trackRect
        ? { x: trackRect.x, y: trackRect.y, width: trackRect.width, height: trackRect.height }
        : null,
      thumbBox: thumbRect
        ? { x: thumbRect.x, y: thumbRect.y, width: thumbRect.width, height: thumbRect.height }
        : null,
    };
  }, THREAD_ROWS_SELECTOR);

export const focusThreadScrollbar = (page: Page, dispatchTouchStart = false) =>
  page.evaluate(
    ({ sel, touch }) => {
      if (touch) window.dispatchEvent(new Event('touchstart', { bubbles: true }));
      const inner = document.querySelector<HTMLElement>(sel);
      let scroller: HTMLElement | null = inner?.parentElement ?? null;
      while (scroller) {
        const oy = getComputedStyle(scroller).overflowY;
        if (oy === 'auto' || oy === 'scroll') break;
        scroller = scroller.parentElement;
      }
      const track = scroller?.querySelector<HTMLElement>('[role="scrollbar"]');
      if (!track) return false;
      track.focus();
      return document.activeElement === track;
    },
    { sel: THREAD_ROWS_SELECTOR, touch: dispatchTouchStart }
  );

export const installUnderReportedCountRoute = async (page: Page) => {
  await routeQuietly(page, '**/_matrix/client/**', async (route) => {
    const url = route.request().url();
    if (
      !url.includes('/sync') &&
      !url.includes('/event/') &&
      !url.includes('/threads') &&
      !url.includes('/relations/')
    ) {
      await route.continue();
      return;
    }
    let fetchUrl = url;
    if (url.includes('/relations/')) {
      const parsed = new URL(url);
      parsed.searchParams.set('limit', '20');
      fetchUrl = parsed.toString();
    }
    const response = await route.fetch({ url: fetchUrl });
    if (!(response.headers()['content-type'] ?? '').includes('application/json')) {
      await route.fulfill({ response });
      return;
    }
    const body = (await response.text())
      .replace(/"m\.thread":\{([^{}]*)"count":\d+/g, '"m.thread":{$1"count":1')
      .replace(/"message_count":\d+/g, '"message_count":1');
    await route.fulfill({ response, body });
  });
};

export const waitForSettledAtRow0 = async (page: Page, timeout = 30_000) => {
  await expect
    .poll(
      async () => {
        const st = await readThreadScrollState(page);
        return st ? st.headroomPx === 0 && st.scrollTop <= 2 && st.row0Visible : false;
      },
      { timeout }
    )
    .toBe(true);
};
