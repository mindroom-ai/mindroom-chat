import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, expect, test, type Locator, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { COMPACT_VIEW, expectCompactCardCount } from '../helpers/compactCards';
import {
  allowActiveRunsState, createDefaultThreadFilterState, createPrivateRoom, joinRoom,
  loginToMatrix, matrixFetch, publishActiveRuns, registerAgentAccount, seedRoomOverviewState,
  sendRoomMessage, type MatrixSession,
} from '../helpers/matrix';
import { installProbe, startProbe } from '../helpers/perfProbe';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

/**
 * Opt-in phone (390x844) performance/energy benchmark (PERF_PHONE_HEAT=1).
 * Knobs: PERF_ENGINES (chromium,webkit), PERF_SCENARIOS, PERF_PROFILE=1, PERF_TRACE=1, PERF_SHOTS=1.
 */
const ALL_SCENARIOS = ['thread-typing-scroll', 'thread-streaming-idle', 'thread-thinking-idle', 'compact-streaming-scroll'] as const;
type Scenario = (typeof ALL_SCENARIOS)[number];
type Engine = 'chromium' | 'webkit';
type PsRow = { pid: number; ppid: number; cpuMs: number; comm: string };
type CpuSample = Map<number, { bucket: string; cpuMs: number }>;

const listEnv = (k: string, d: string) =>
  (process.env[k] ?? d).split(',').map((s) => s.trim()).filter(Boolean);
const OUT_DIR = 'test-results/perf/phone-heat';
const ENGINES = listEnv('PERF_ENGINES', 'chromium,webkit').filter((e): e is Engine => e === 'chromium' || e === 'webkit');
const SCENARIOS = ALL_SCENARIOS.filter((s) => listEnv('PERF_SCENARIOS', ALL_SCENARIOS.join(',')).includes(s));
const PROFILE = process.env.PERF_PROFILE === '1';
const TRACE = process.env.PERF_TRACE === '1';
const SHOTS = process.env.PERF_SHOTS === '1';

const readPsRows = (): PsRow[] | null => {
  if (process.platform !== 'darwin') return null;
  try {
    return execFileSync('ps', ['-axo', 'pid=,ppid=,time=,comm='], { encoding: 'utf8', timeout: 5_000 }).split('\n').flatMap((line) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s+(.+?)\s*$/.exec(line);
      if (!m?.[1] || !m[2] || !m[5] || !m[6] || !m[7]) return [];
      const secs = ((Number(m[3] ?? 0) * 24 + Number(m[4] ?? 0)) * 60 + Number(m[5])) * 60 + Number(m[6]);
      return Number.isFinite(secs) ? [{ pid: Number(m[1]), ppid: Number(m[2]), cpuMs: Math.round(secs * 1000), comm: m[7] }] : [];
    });
  } catch { return null; }
};

const sampleBrowserCpu = (engine: Engine, baseline: Set<number>): CpuSample | null => {
  const rows = readPsRows();
  if (!rows) return null;
  const kids = new Map<number, number[]>();
  for (const r of rows) kids.set(r.ppid, [...(kids.get(r.ppid) ?? []), r.pid]);
  const desc = new Set<number>();
  for (const q = [process.pid]; q.length > 0; ) {
    const pid = q.shift();
    for (const c of pid === undefined ? [] : (kids.get(pid) ?? [])) {
      if (!desc.has(c)) { desc.add(c); q.push(c); }
    }
  }
  const bucket = (c: string) =>
    /WebContent/i.test(c) ? 'webContent' : /GPU/i.test(c) ? 'gpu' : /Networking/i.test(c) ? 'networking'
      : /Renderer/i.test(c) ? 'renderer' : /Helper/i.test(c) ? 'helper' : 'browser';
  const pick = (keep: (r: PsRow) => boolean): CpuSample =>
    new Map(rows.filter(keep).map((r) => [r.pid, { bucket: bucket(r.comm), cpuMs: r.cpuMs }]));
  let sample = engine === 'webkit'
    ? pick((r) => (desc.has(r.pid) && /webkit|playwright/i.test(r.comm)) ||
        (!baseline.has(r.pid) && /WebKit[.\w-]*(WebContent|GPU|Networking)/i.test(r.comm)))
    : pick((r) => desc.has(r.pid) && /chrom/i.test(r.comm));
  if (engine === 'chromium' && sample.size === 0) sample = pick((r) => !baseline.has(r.pid) && /chrom/i.test(r.comm));
  return sample.size > 0 ? sample : null;
};

const diffBrowserCpu = (before: CpuSample | null, after: CpuSample | null) => {
  if (!before || !after) return null;
  const byProcess: Record<string, number> = {};
  let totalMs = 0;
  for (const [pid, cur] of after) {
    const delta = Math.max(0, cur.cpuMs - (before.get(pid)?.cpuMs ?? 0));
    byProcess[cur.bucket] = (byProcess[cur.bucket] ?? 0) + delta;
    totalMs += delta;
  }
  return { totalMs, byProcess };
};

const inThread = (rootId: string, replyTo = rootId) => ({
  'm.relates_to': { rel_type: 'm.thread', event_id: rootId, is_falling_back: true, 'm.in_reply_to': { event_id: replyTo } },
});

const richContent = (
  step: number, label: string, withTools: boolean, status?: 'streaming' | 'completed'
): Record<string, unknown> => {
  const bullets = Array.from({ length: Math.min(step, 6) }, (_, i) => `<li>${label} item ${i + 1}: ${(16.6 + i * 0.4).toFixed(1)} ms</li>`).join('');
  const mark = status === 'streaming' ? ' ⏳' : '';
  const chunk = 'tokens '.repeat(Math.min(step, 8)).trim();
  const toolText = withTools ? `🔧 \`read_file\` [1]\n\n🔧 \`bash\` [2]${mark}\n\n` : '';
  const toolHtml = withTools ? `<p>🔧 <code>read_file</code> [1]</p><p>🔧 <code>bash</code> [2]${mark}</p>` : '';
  return {
    msgtype: 'm.text',
    body: `${toolText}${label} update ${step}: ${chunk}.`,
    format: 'org.matrix.custom.html',
    formatted_body: `${toolHtml}<p>${label} update ${step}: <code>${chunk}</code>.</p><ul>${bullets}</ul>` +
      `<pre><code class="language-ts">const s${step} = { step: ${step}, status: '${status ?? 'done'}' };\n</code></pre>`,
    ...(status && { 'io.mindroom.stream_status': status }),
    ...(withTools && {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'read_file', result_preview: '240 lines' },
          { type: status === 'streaming' ? 'tool_call_started' : 'tool_call_completed', tool_name: 'bash', args_preview: 'rg -n keyframes src/' },
        ],
      },
    }),
  };
};

const withInterval = async (ms: number, tick: (step: number) => Promise<void>, work: () => Promise<void>) => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  let loopErr: unknown;
  const done = (async () => {
    for (let step = 1; !stopped; step += 1) {
      const t0 = Date.now();
      await tick(step);
      const wait = Math.max(0, ms - (Date.now() - t0));
      if (!stopped && wait > 0) await new Promise<void>((r) => { wake = r; timer = setTimeout(r, wait); });
    }
  })().catch((e: unknown) => { loopErr = e; });
  try { await work(); } finally {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    wake?.();
    await done;
  }
  if (loopErr !== undefined) throw loopErr;
};

const scrollAction = (page: Page, mode: 'thread' | 'compact', kind: 'range' | 'bottom' | 'step', dir: 1 | -1 = 1) =>
  page.evaluate(({ targetMode, action, currentDir }) => {
    const active = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel)).find((e) => !e.closest('[inert]'));
    let el: HTMLElement | null = targetMode === 'compact' ? (active('[data-compact-room-view]') ?? null) : null;
    if (targetMode === 'thread') {
      for (let p = active('[data-timeline-rows]')?.parentElement ?? null; p; p = p.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(p).overflowY)) { el = p; break; }
      }
    }
    if (!el) return { range: 0, dir: currentDir };
    const range = el.scrollHeight - el.clientHeight;
    if (action === 'bottom') el.scrollTop = el.scrollHeight;
    let nextDir = currentDir;
    if (action === 'step' && range > 0) {
      nextDir = el.scrollTop <= 40 ? 1 : el.scrollTop >= range - 40 ? -1 : currentDir;
      el.scrollBy({ top: nextDir * 280, behavior: 'smooth' });
    }
    return { range, dir: nextDir };
  }, { targetMode: mode, action: kind, currentDir: dir });

const smoothScroll = async (page: Page, mode: 'thread' | 'compact', ms: number, initial: 1 | -1) => {
  let dir = initial;
  for (const end = Date.now() + ms; Date.now() < end; ) {
    ({ dir } = await scrollAction(page, mode, 'step', dir));
    await page.waitForTimeout(200);
  }
};

const waitVisible = (loc: Locator, timeout = 30_000) => expect(loc).toBeVisible({ timeout });

test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test.skip(process.env.PERF_PHONE_HEAT !== '1', 'Set PERF_PHONE_HEAT=1 to run');

test('measure phone CPU and GPU hotspots across scenarios', async ({ baseURL }) => {
  test.setTimeout(15 * 60_000);
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, username, password);
  const agent = await registerAgentAccount(homeserver, 'heat');
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `Phone Heat Bench ${Date.now().toString(36)}`,
    invite: [agent.userId],
  });
  await joinRoom(homeserver, agent.accessToken, roomId);
  await allowActiveRunsState(homeserver, session.accessToken, roomId);

  const send = (who: MatrixSession, content: Record<string, unknown>, txn: string) =>
    sendRoomMessage(homeserver, who.accessToken, roomId, content, txn);
  const edit = (targetId: string, content: Record<string, unknown>, txn: string) =>
    send(agent, { ...content, body: `* ${String(content.body ?? '')}`, 'm.new_content': content, 'm.relates_to': { rel_type: 'm.replace', event_id: targetId } }, txn);
  const typing = (on: boolean) =>
    matrixFetch<Record<string, unknown>>(homeserver, `/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(agent.userId)}`, {
      method: 'PUT', accessToken: agent.accessToken, body: JSON.stringify(on ? { typing: true, timeout: 30_000 } : { typing: false }),
    });

  // Seed once: 80 compact threads (2 replies each), 1 main thread (40 formatted replies),
  // and 1 idle thread showing ThinkingPlaceholder + running ToolCallsFold + running CompactionSeam.
  const compactRoots: string[] = new Array<string>(80);
  for (let s = 0; s < 80; s += 8) {
    await Promise.all(Array.from({ length: Math.min(8, 80 - s) }, async (_, o) => {
      const i = s + o;
      const root = await send(session, { msgtype: 'm.text', body: `Compact ${i + 1}` }, `cr-${i}`);
      const r1 = await send(agent, { msgtype: 'm.text', body: `Reply 1 #${i + 1}`, ...inThread(root) }, `c1-${i}`);
      await send(session, { msgtype: 'm.text', body: `Reply 2 #${i + 1}`, ...inThread(root, r1) }, `c2-${i}`);
      compactRoots[i] = root;
    }));
  }
  const mainRootId = await send(session, { msgtype: 'm.text', body: 'Main 40-reply thread' }, 'mroot');
  for (let i = 1, prev = mainRootId; i <= 40; i += 1) {
    prev = await send(i % 2 === 0 ? agent : session, { ...richContent(3, `Formatted reply ${i}`, false), ...inThread(mainRootId, prev) }, `m-${i}`);
  }
  const thinkingRootId = await send(session, { msgtype: 'm.text', body: 'Thinking idle thread' }, 'troot');
  const activeRunId = await send(agent, {
    msgtype: 'm.text', body: 'Checking profiler frames.\n\n🔧 `bash` [1] ⏳', format: 'org.matrix.custom.html',
    formatted_body: '<p>Checking profiler frames.</p><p>🔧 <code>bash</code> [1] ⏳</p>',
    'io.mindroom.stream_status': 'streaming',
    'io.mindroom.tool_trace': { version: 2, events: [{ type: 'tool_call_started', tool_name: 'bash', args_preview: 'rg -n keyframes src/' }] },
    'io.mindroom.compactions': [{
      id: 'idle-mid', phase: 'mid_turn', after_tool: 1, status: 'running', started_at: Date.now() - 8_000,
      summary_model: 'haiku', before_tokens: 366_804, history_budget_tokens: 351_792, runs_before: 24, compacted_run_count: 9,
    }],
    ...inThread(thinkingRootId),
  }, 'trun');
  await send(agent, { msgtype: 'm.text', body: 'Thinking...', 'io.mindroom.stream_status': 'pending', ...inThread(thinkingRootId, activeRunId) }, 'tpending');

  mkdirSync(OUT_DIR, { recursive: true });
  const threadUrl = (id: string) => `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(id)}`;
  const withStreams = async (
    roots: string[], activeRoots: string[], label: string, ms: number, tag: string, withTyping: boolean,
    work: (loop: (body: () => Promise<void>) => Promise<void>) => Promise<void>
  ) => {
    const ids = await Promise.all(roots.map((r, i) => send(agent, { ...richContent(1, `${label} ${i + 1}`, false, 'streaming'), ...inThread(r) }, `${tag}-0-${i}`)));
    const emit = (step: number, status: 'streaming' | 'completed', k: string) =>
      Promise.all(ids.map((id, i) => edit(id, richContent(step, `${label} ${i + 1}`, false, status), `${tag}-${k}-${i}`)));
    let last = 1;
    await publishActiveRuns(homeserver, agent, roomId, activeRoots);
    if (withTyping) await typing(true);
    try { await work((body) => withInterval(ms, async (step) => { last = step + 1; await emit(last, 'streaming', String(step)); }, body)); } finally {
      await emit(last + 1, 'completed', 'end');
      if (withTyping) await typing(false);
      await publishActiveRuns(homeserver, agent, roomId, []);
    }
  };

  for (const engine of ENGINES) {
    if (engine === 'webkit' && !WEBKIT_EXECUTABLE) continue;
    const baselinePids = new Set((readPsRows() ?? []).map((r) => r.pid));
    const browser = engine === 'webkit'
      ? await launchWebKit()
      : await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined, args: ['--disable-features=IsolateSandboxedIframes'] });
    try {
      const context = await browser.newContext({
        baseURL, locale: 'en-US', viewport: { width: 390, height: 844 }, hasTouch: true,
        ...(engine === 'webkit' ? { deviceScaleFactor: 3 } : { isMobile: true }),
      });
      const page = await context.newPage();
      await installProbe(page);
      await loginWithPassword(page, { homeserver, username, password, showToolCalls: false });
      await seedRoomOverviewState({ page, roomId, userId: session.userId, viewMode: 'compact', filterState: createDefaultThreadFilterState() });

      const openMain = async () => {
        if (page.url().includes(encodeURIComponent(mainRootId))) return;
        await page.goto(threadUrl(mainRootId));
        await waitVisible(page.locator('[data-thread-context-banner]'));
        await waitVisible(page.locator('[data-message-item]').first());
        await expect.poll(async () => (await scrollAction(page, 'thread', 'range')).range, { timeout: 15_000 }).toBeGreaterThan(400);
      };
      const runWindow = async (scenario: Scenario, work: () => Promise<void>) => {
        const label = `${scenario}-${engine}`;
        const cpuBefore = sampleBrowserCpu(engine, baselinePids);
        const probe = await startProbe(page, { label, outDir: OUT_DIR, profile: PROFILE, trace: TRACE });
        let failed = false;
        try { await work(); } catch (err) { failed = true; throw err; } finally {
          const osCpu = diffBrowserCpu(cpuBefore, sampleBrowserCpu(engine, baselinePids));
          const result = await probe.stop({ engine, scenario, osCpu });
          if (!failed) {
            if (SHOTS) await page.screenshot({ path: `${OUT_DIR}/${label}.png` });
            console.log(`PERF-PHONE-HEAT ${JSON.stringify({ ...result, engine, scenario, osCpu })}`);
          }
        }
      };

      if (SCENARIOS.includes('thread-typing-scroll')) {
        await openMain();
        await withStreams([mainRootId], [mainRootId], 'Typing scroll', 400, `ts-${engine}`, true, async (loop) => {
          await waitVisible(page.getByText('Typing scroll 1 update 1:').first(), 20_000);
          await runWindow('thread-typing-scroll', () => loop(() => smoothScroll(page, 'thread', 10_000, -1)));
        });
      }

      if (SCENARIOS.includes('thread-streaming-idle')) {
        await openMain();
        await scrollAction(page, 'thread', 'bottom');
        const bgRoots = compactRoots.slice(0, 4);
        await withStreams(bgRoots, [mainRootId, ...bgRoots], 'Bg', 500, `bg-${engine}`, true, async (loopBg) => {
          let mainReplyId = '';
          try {
            await runWindow('thread-streaming-idle', () => loopBg(async () => {
              const started = Date.now();
              mainReplyId = await send(agent, { msgtype: 'm.text', body: 'Thinking...', 'io.mindroom.stream_status': 'pending', ...inThread(mainRootId) }, `si0-${engine}`);
              await page.waitForTimeout(2_500);
              for (let step = 1; step <= 20; step += 1) {
                await edit(mainReplyId, richContent(step, 'Stream idle', true, 'streaming'), `si-${engine}-${step}`);
                if (step < 20) await page.waitForTimeout(450);
              }
              const remaining = started + 12_000 - Date.now();
              if (remaining > 0) await page.waitForTimeout(remaining);
            }));
          } finally {
            if (mainReplyId) await edit(mainReplyId, richContent(20, 'Stream idle', true, 'completed'), `si-e-${engine}`);
          }
        });
      }

      if (SCENARIOS.includes('thread-thinking-idle')) {
        await page.goto(threadUrl(thinkingRootId));
        await waitVisible(page.getByRole('status', { name: 'AI is responding' }).filter({ has: page.locator('img') }));
        await waitVisible(page.locator('[data-tool-calls-fold][data-state="running"]'));
        await waitVisible(page.locator('[data-compaction-seam][data-state="running"]'));
        await page.waitForTimeout(500);
        await runWindow('thread-thinking-idle', () => page.waitForTimeout(10_000));
      }

      if (SCENARIOS.includes('compact-streaming-scroll')) {
        const banner = page.locator('[data-thread-context-banner]');
        if (await banner.isVisible()) await banner.getByRole('button', { name: 'Back', exact: true }).click();
        else await page.goto(`/home/${encodeURIComponent(roomId)}`);
        await expectCompactCardCount(page.locator(COMPACT_VIEW), 80, { atLeast: true });
        const streamRoots = compactRoots.slice(0, 8);
        await withStreams(streamRoots, streamRoots, 'Compact', 400, `cs-${engine}`, false, async (loop) => {
          await page.waitForTimeout(500);
          await runWindow('compact-streaming-scroll', () => loop(async () => {
            await smoothScroll(page, 'compact', 2_500, 1);
            await smoothScroll(page, 'compact', 2_500, -1);
            await page.waitForTimeout(5_000);
          }));
        });
      }
      await context.close();
    } finally { await browser.close(); }
  }
});
