import { expect, test, type Page } from '@playwright/test';
import { startMockMatrixServer, type MatrixEventJson } from '../helpers/mockMatrixServer';

const ROOM = '!calibration:localhost';
const USER = '@e2e:localhost';
const AGENT = '@mindroom_agent:localhost';
const ROOT = '$cal_root';
const PREMOUNT_IDS = ['$cal_prose', '$cal_report', '$cal_code40', '$cal_table', '$cal_question'];

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});

const DONE = {
  'io.mindroom.ai_run': {
    version: 1,
    status: 'completed',
    model: { config: 'sonnet', id: 'claude-sonnet-4', provider: 'anthropic' },
  },
  'io.mindroom.stream_status': 'completed',
};
const seq = (n: number, fn: (i: number) => string, sep = '') =>
  Array.from({ length: n }, (_, i) => fn(i)).join(sep);
const html = (formatted: string, body = 'rich', extra?: Record<string, unknown>) => ({
  msgtype: 'm.text',
  body,
  format: 'org.matrix.custom.html',
  formatted_body: formatted,
  ...DONE,
  ...extra,
});

const buildCalibrationEvents = (): MatrixEventJson[] => {
  const events: MatrixEventJson[] = [];
  let prev = ROOT;
  let ts = new Date(2026, 9, 20, 9, 0, 0).getTime();
  const push = (id: string, stepMin: number, content: Record<string, unknown>, sender = AGENT) => {
    ts += stepMin * 60_000;
    const rel = {
      rel_type: 'm.thread',
      event_id: ROOT,
      is_falling_back: true,
      'm.in_reply_to': { event_id: prev },
    };
    const merged =
      id === ROOT || content['m.relates_to'] ? content : { ...content, 'm.relates_to': rel };
    events.push({
      type: 'm.room.message',
      event_id: id,
      sender,
      origin_server_ts: ts,
      room_id: ROOM,
      content: merged,
    });
    if (!content['m.relates_to']) prev = id;
  };
  const addPairs = (tag: string, n: number) => {
    for (let i = 1; i <= n; i += 1) {
      push(
        `$cal_${tag}_h_${i}`,
        2,
        { msgtype: 'm.text', body: `Check ${i}: confirm Service X.` },
        USER
      );
      push(`$cal_${tag}_a_${i}`, 2, {
        msgtype: 'm.text',
        body: `Wave ${i} verified: Service X ok.`,
        ...DONE,
      });
    }
  };

  push(ROOT, 0, { msgtype: 'm.text', body: 'Review rollout plan for Service X.' }, USER);
  addPairs('lead', 4);

  const pLine = (i: number) => `Step ${i + 1}: verify Service X drains staging shards cleanly.`;
  const pHtml = seq(5, (i) => `<p><strong>Phase ${i + 1}:</strong> ${pLine(i)}</p>`);
  push('$cal_prose', 2, html(pHtml, seq(5, pLine, '\n\n')));
  push('$cal_mid_h', 3, { msgtype: 'm.text', body: 'List rollout checks and a snippet.' }, USER);

  const lis = seq(8, (i) => `<li>Item ${i + 1}: confirm Service ${i + 1} passes probes.</li>`);
  push('$cal_report', 2, html(`<h2>Rollout</h2><ul>${lis}</ul><p>Proceed.</p>`));

  const c10 = seq(10, (i) => `const step${i + 1} = verifyHealth("svc-${i + 1}", timeout);`, '\n');
  push('$cal_code10', 3, html(`<p>Helper:</p><pre><code>${c10}</code></pre>`, c10));

  const c40 = seq(40, (i) => `export const step_${i + 1} = runStage("stage_${i + 1}", cfg);`, '\n');
  push('$cal_code40', 2, html(`<p>Template:</p><pre><code>${c40}</code></pre>`, c40));

  const tr = (i: number) =>
    `<tr><td>Svc ${i + 1}</td><td>Active</td><td>Handles routing and retries for shard ${i + 1}.</td></tr>`;
  const tableHtml = `<p>Matrix:</p><table><thead><tr><th>Svc</th><th>State</th><th>Role</th></tr></thead><tbody>${seq(6, tr)}</tbody></table>`;
  push('$cal_table', 3, html(tableHtml));

  const qText = 'Which rollout track should we schedule for the first canary batch?';
  const qInstr = 'React with an emoji or type the number to respond.';
  const qHtml = `<p>${qText}</p><ol><li>1️⃣ Alpha</li><li>2️⃣ Beta</li><li>3️⃣ Staging</li></ol><p>${qInstr}</p>`;
  const qMeta = {
    'io.mindroom.interactive': {
      version: 1,
      question_text: qText,
      options: { '1️⃣': 'alpha', '2️⃣': 'beta', '3️⃣': 'staging' },
      option_labels: { '1️⃣': 'Alpha', '2️⃣': 'Beta', '3️⃣': 'Staging' },
    },
  };
  push('$cal_question', 24 * 60, html(qHtml, `${qText}\n${qInstr}`, qMeta));

  const head = seq(12, (i) => `<p>Check ${i + 1}: inspecting Service X shard ${i + 1}.</p>`);
  const workHtml = `${head}<p>🔧 <code>shell</code> [1]</p><p>All passed.</p>`;
  const workMeta = {
    'io.mindroom.reasoning': { text: 'Evaluating readiness.', duration_ms: 4200 },
    'io.mindroom.tool_trace': {
      version: 2,
      events: [{ type: 'tool_call_started', tool_name: 'shell' }],
    },
  };
  push('$cal_work', 4, html(workHtml, 'Checks.\n\n🔧 `shell` [1]\n\nAll passed.', workMeta));

  push('$cal_edited', 4, {
    msgtype: 'm.text',
    body: 'Thinking...',
    'io.mindroom.stream_status': 'streaming',
  });
  const rLine = (i: number) => `Summary ${i + 1}: Region Alpha and Beta completed verification.`;
  const nc = html(
    seq(3, (i) => `<p>${rLine(i)}</p>`),
    seq(3, rLine, '\n\n')
  );
  push('$cal_edited_replace', 1, {
    msgtype: 'm.text',
    body: `* ${nc.body}`,
    'm.new_content': nc,
    'm.relates_to': { rel_type: 'm.replace', event_id: '$cal_edited' },
    ...DONE,
  });

  addPairs('tail', 10);
  return events;
};

const runVirtualizer = (page: Page, mode: 'read' | 'dragUp') =>
  page.evaluate(async (op: 'read' | 'dragUp') => {
    const inner = document.querySelector<HTMLElement>('[data-thread-count]');
    const fKey = inner && Object.keys(inner).find((k) => k.startsWith('__reactFiber$'));
    let f = fKey ? (inner as unknown as Record<string, any>)[fKey] : null;
    while (f && !f.memoizedProps?.list?.virtualizer) f = f.return;
    const v = f?.memoizedProps?.list?.virtualizer;
    const scroller: HTMLElement | null = v?.scrollElement ?? null;
    if (!inner || !v || !scroller) return null;

    const measured: Record<number, number> = {};
    const seenIds: Record<string, true> = {};
    const sample = () => {
      inner.querySelectorAll<HTMLElement>('[data-index]').forEach((el) => {
        const h = el.getBoundingClientRect().height;
        if (h > 0) measured[Number(el.dataset.index)] = h;
      });
      inner.querySelectorAll<HTMLElement>('[data-message-id]').forEach((el) => {
        if (el.dataset.messageId) seenIds[el.dataset.messageId] = true;
      });
    };

    sample();
    const cache: Map<unknown, number> | undefined = v.itemSizeCache;
    const estimates = Array.from({ length: Number(v.options.count) }, (_, i) => {
      const k = v.options.getItemKey(i);
      return [i, String(k), Number(v.options.estimateSize(i)), Boolean(cache?.has(k))] as const;
    });
    if (op === 'read') return { estimates, measured, seenIds };

    let maxAbsHold = Math.abs(Number(v._holdOffset ?? 0));
    let maxPosHold = Math.max(0, Number(v._holdOffset ?? 0));
    let sawHeld = false;
    scroller.dispatchEvent(new Event('touchstart', { bubbles: true }));
    for (let step = 0; step < 55 && scroller.scrollTop > 0; step += 1) {
      scroller.scrollTop = Math.max(0, scroller.scrollTop - 280);
      scroller.dispatchEvent(new Event('scroll'));
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 80));
      sample();
      const hold = Number(v._holdOffset ?? 0);
      if (!v._canWriteScroll?.()) sawHeld = true;
      maxAbsHold = Math.max(maxAbsHold, Math.abs(hold));
      maxPosHold = Math.max(maxPosHold, hold);
    }
    scroller.dispatchEvent(new Event('touchend', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    sample();
    return {
      estimates,
      measured,
      seenIds,
      sawHeld,
      maxAbsHold,
      maxPosHold,
      settledHold: Number(v._holdOffset ?? 0),
    };
  }, mode);

test('phone thread row estimates calibrate against DOM tiles and bound upward holdOffset', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const mock = await startMockMatrixServer(buildCalibrationEvents(), {
    roomId: ROOM,
    roomName: 'Calibration Room',
    userId: USER,
    otherUserId: AGENT,
    otherDisplayName: 'Agent',
  });

  try {
    const setup = page.getByRole('dialog').filter({ hasText: 'Set up your recovery password' });
    await page.addLocatorHandler(setup, () =>
      setup.getByRole('button', { name: 'Not now' }).click()
    );
    await page.addLocatorHandler(page.locator('[data-tour-offer-action="dismiss"]'), (l) =>
      l.click()
    );
    const sid = `${mock.baseUrl}|${USER}`;
    const session = {
      sessionId: sid,
      baseUrl: mock.baseUrl,
      userId: USER,
      deviceId: 'E2EDEVICE',
      accessToken: 'fake-token',
      lastUsedAt: Date.now(),
    };
    await page.addInitScript(
      (j: string) => localStorage.setItem('mindroom_multi_account_store', j),
      JSON.stringify({ version: 1, activeSessionId: sid, sessions: [session] })
    );

    await page.goto(`/home/${encodeURIComponent(ROOM)}?threadId=${encodeURIComponent(ROOT)}`);
    await expect(page.getByText('Wave 10 verified: Service X ok.').first()).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(400);

    const initial = await runVirtualizer(page, 'read');
    expect(initial).not.toBeNull();
    expect(
      initial!.estimates.filter(([, , est, c]) => est > 0 && !c).length
    ).toBeGreaterThanOrEqual(6);
    await Promise.all(
      PREMOUNT_IDS.map((id) => expect(page.locator(`[data-message-id="${id}"]`)).toHaveCount(0))
    );

    const drag = await runVirtualizer(page, 'dragUp');
    expect(drag?.sawHeld).toBe(true);
    expect(drag?.settledHold).toBe(0);
    PREMOUNT_IDS.forEach((id) => expect(drag?.seenIds[id], `${id} mounted on scroll`).toBe(true));

    const measured = { ...initial!.measured, ...drag!.measured };
    const rows = initial!.estimates.filter(([i, , est]) => est > 0 || (measured[i] ?? 0) > 0);
    expect(rows.length).toBeGreaterThanOrEqual(26);
    rows.forEach(([i, key]) => expect(measured[i] ?? 0, `${key} measured`).toBeGreaterThan(0));

    const estSum = rows.reduce((s, [, , est]) => s + est, 0);
    const measSum = rows.reduce((s, [i]) => s + (measured[i] ?? 0), 0);
    expect(Math.abs(estSum - measSum) / measSum).toBeLessThanOrEqual(0.15);
    expect(drag!.maxAbsHold).toBeLessThan(350);
    expect(drag!.maxPosHold).toBeLessThan(350);
  } finally {
    await mock.close();
  }
});
