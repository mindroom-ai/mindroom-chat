import { expect, test, type Page } from '@playwright/test';
import { startMockMatrixServer, type MatrixEventJson } from '../helpers/mockMatrixServer';

const ROOM_ID = '!calibration:localhost';
const USER_ID = '@e2e:localhost';
const AGENT_ID = '@mindroom_agent:localhost';
const ROOT_ID = '$cal_root';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  userAgent: IPHONE_UA,
});

const AI_RUN = {
  version: 1,
  status: 'completed',
  model: { config: 'sonnet', id: 'claude-sonnet-4', provider: 'anthropic' },
  usage: { input_tokens: 1800, output_tokens: 420 },
};

const threadRel = (prevId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: ROOT_ID,
    is_falling_back: true,
    'm.in_reply_to': { event_id: prevId },
  },
});

const buildCalibrationEvents = (): {
  events: MatrixEventJson[];
  labelsByEventId: Record<string, string>;
} => {
  const baseTs = new Date(2026, 9, 20, 9, 0, 0).getTime();
  const min = 60_000;
  const day = 24 * 60 * min;

  const events: MatrixEventJson[] = [];
  const labelsByEventId: Record<string, string> = {};
  let prevId = ROOT_ID;
  let tsOffset = 0;

  const add = (
    id: string,
    label: string,
    sender: string,
    stepMs: number,
    content: Record<string, unknown>,
    isRoot = false
  ) => {
    tsOffset += stepMs;
    labelsByEventId[id] = label;
    events.push({
      type: 'm.room.message',
      event_id: id,
      sender,
      origin_server_ts: baseTs + tsOffset,
      room_id: ROOM_ID,
      content: isRoot ? content : { ...content, ...threadRel(prevId) },
    });
    prevId = id;
  };

  // Top rows (0..7) so the middle rich rows sit strictly outside both open-frame-0 and bottom overscans.
  add(
    ROOT_ID,
    'root-short-human',
    USER_ID,
    0,
    { msgtype: 'm.text', body: 'Please review the rollout plan for Service X and Service Y.' },
    true
  );
  for (let i = 1; i <= 4; i += 1) {
    add(`$cal_lead_human_${i}`, `lead-human-${i}`, USER_ID, 2 * min, {
      msgtype: 'm.text',
      body: `Pre-check ${i}: confirm staging environment flags for Item A and Item B before starting.`,
    });
    add(`$cal_lead_agent_${i}`, `lead-agent-${i}`, AGENT_ID, 2 * min, {
      msgtype: 'm.text',
      body: `Pre-check ${i} passed: Service X staging manifest and health probes look clean.`,
      'io.mindroom.ai_run': AI_RUN,
      'io.mindroom.stream_status': 'completed',
    });
  }

  // Diverse middle calibration rows (all unmeasured when thread opens at bottom)
  // Long inline-HTML agent prose (<p>/<strong>/<code>/<br> only, no block markup)
  const proseParagraphs = [
    'Step 1: verify that Service X drains in-flight requests cleanly before draining worker nodes in region alpha.',
    'Step 2: inspect the metrics dashboard for queue depth, retry budgets, and p95 latency across staging shards.',
    'Step 3: confirm configuration flags align with the canary manifest so fallback routing stays active during rollout.',
    'Step 4: audit database migration lock durations and ensure every read replica catches up within the target window.',
    'Step 5: record final health status for Item A, Item B, and Item C before promoting the release to production.',
  ];
  add('$cal_inline_prose', 'long-inline-html-agent-prose', AGENT_ID, 2 * min, {
    msgtype: 'm.text',
    body: proseParagraphs.join('\n\n'),
    format: 'org.matrix.custom.html',
    formatted_body: proseParagraphs
      .map(
        (p, idx) =>
          `<p><strong>Phase ${idx + 1}:</strong> ${p.replace('Service X', '<code>Service X</code>')}</p>`
      )
      .join(''),
    'io.mindroom.ai_run': AI_RUN,
    'io.mindroom.stream_status': 'completed',
  });

  // Short human follow-up
  add('$cal_human_mid', 'short-human-mid', USER_ID, 3 * min, {
    msgtype: 'm.text',
    body: 'Looks good. Can you list the rollout checks and show a sample config snippet?',
  });

  // Long rich list/heading agent report
  const listItems = Array.from(
    { length: 8 },
    (_, i) =>
      `Item ${String.fromCharCode(65 + i)}: confirm Service ${i + 1} passes synthetic probes and keeps error rate below 0.1%.`
  );
  add('$cal_rich_report', 'long-rich-list-heading-report', AGENT_ID, 2 * min, {
    msgtype: 'm.text',
    body: `## Rollout Verification Report\n\n${listItems.map((l) => `- ${l}`).join('\n')}\n\n## Next Steps\n\nProceed with staged canary rollout once alerts stay quiet.`,
    format: 'org.matrix.custom.html',
    formatted_body:
      `<h2>Rollout Verification Report</h2>` +
      `<ul>${listItems.map((l) => `<li>${l}</li>`).join('')}</ul>` +
      `<h2>Next Steps</h2>` +
      `<p>Proceed with staged canary rollout once alerts stay quiet across every shard.</p>`,
    'io.mindroom.ai_run': AI_RUN,
    'io.mindroom.stream_status': 'completed',
  });

  // Wrapped 10-line code block (each line wraps on 390px phone, <= 16 logical lines)
  const tenCodeLines = Array.from(
    { length: 10 },
    (_, i) => `const checkStep${i + 1} = verifyServiceHealth("service-${i + 1}", timeoutMs);`
  ).join('\n');
  add('$cal_code_10', 'wrapped-10-line-code-block', AGENT_ID, 3 * min, {
    msgtype: 'm.text',
    body: `Sample verification helper:\n\n\`\`\`ts\n${tenCodeLines}\n\`\`\``,
    format: 'org.matrix.custom.html',
    formatted_body: `<p>Sample verification helper:</p><pre><code class="language-ts">${tenCodeLines}</code></pre>`,
    'io.mindroom.ai_run': AI_RUN,
    'io.mindroom.stream_status': 'completed',
  });

  // Collapsed 40-line code block (> 16 logical lines -> collapsed at 18em)
  const fortyCodeLines = Array.from(
    { length: 40 },
    (_, i) => `export const step_${i + 1} = runPipelineStage("stage_${i + 1}", config);`
  ).join('\n');
  add('$cal_code_40', 'collapsed-40-line-code-block', AGENT_ID, 2 * min, {
    msgtype: 'm.text',
    body: `Full pipeline template:\n\n\`\`\`ts\n${fortyCodeLines}\n\`\`\``,
    format: 'org.matrix.custom.html',
    formatted_body: `<p>Full pipeline template:</p><pre><code class="language-ts">${fortyCodeLines}</code></pre>`,
    'io.mindroom.ai_run': AI_RUN,
    'io.mindroom.stream_status': 'completed',
  });

  // 6-row comparison table (3 columns with multi-line descriptions -> wrapped cells + narrow controls)
  const tableRows = [
    ['Service A', 'Active', 'Handles primary ingress routing and TLS termination across regional edge nodes.'],
    ['Service B', 'Active', 'Processes background worker queues with exponential backoff and dead-letter archival.'],
    ['Service C', 'Canary', 'Validates schema compatibility for incremental batch exports before cutover.'],
    ['Service D', 'Standby', 'Maintains warm failover replicas and periodic snapshot integrity verification.'],
    ['Service E', 'Active', 'Aggregates structured telemetry metrics and publishes rolling latency percentiles.'],
    ['Service F', 'Queued', 'Schedules nightly cleanup jobs for expired staging artifacts and temporary logs.'],
  ];
  const tableHtml =
    `<p>Service comparison matrix:</p>` +
    `<table><thead><tr><th>Component</th><th>State</th><th>Responsibility</th></tr></thead><tbody>` +
    tableRows.map(([c, s, d]) => `<tr><td>${c}</td><td>${s}</td><td>${d}</td></tr>`).join('') +
    `</tbody></table>`;
  add('$cal_table_6', '6-row-comparison-table', AGENT_ID, 3 * min, {
    msgtype: 'm.text',
    body: 'Service comparison matrix:\n' + tableRows.map((r) => r.join(' | ')).join('\n'),
    format: 'org.matrix.custom.html',
    formatted_body: tableHtml,
    'io.mindroom.ai_run': AI_RUN,
    'io.mindroom.stream_status': 'completed',
  });

  // QuestionCard (next day to also exercise DayDivider)
  const qText = 'Which rollout track should we schedule for the first canary batch?';
  const qBody =
    `${qText}\n\n` +
    `1. 1️⃣ Region Alpha (low traffic)\n` +
    `2. 2️⃣ Region Beta (mixed workload)\n` +
    `3. 3️⃣ Staging mirror first\n\n` +
    `React with an emoji or type the number to respond.`;
  const qHtml =
    `<p>${qText}</p>` +
    `<ol><li>1️⃣ Region Alpha (low traffic)</li><li>2️⃣ Region Beta (mixed workload)</li><li>3️⃣ Staging mirror first</li></ol>` +
    `<p>React with an emoji or type the number to respond.</p>`;
  add('$cal_question', 'question-card-next-day', AGENT_ID, day, {
    msgtype: 'm.text',
    body: qBody,
    format: 'org.matrix.custom.html',
    formatted_body: qHtml,
    'io.mindroom.interactive': {
      version: 1,
      question_text: qText,
      options: {
        '1': 'alpha',
        '1️⃣': 'alpha',
        '2': 'beta',
        '2️⃣': 'beta',
        '3': 'staging',
        '3️⃣': 'staging',
      },
      option_labels: {
        '1': 'Region Alpha (low traffic)',
        '1️⃣': 'Region Alpha (low traffic)',
        '2': 'Region Beta (mixed workload)',
        '2️⃣': 'Region Beta (mixed workload)',
        '3': 'Staging mirror first',
        '3️⃣': 'Staging mirror first',
      },
    },
    'io.mindroom.ai_run': AI_RUN,
    'io.mindroom.stream_status': 'completed',
  });

  // FinishedWorkFold + reasoning reply (long hidden tool work + concise final answer)
  const workHead = Array.from(
    { length: 12 },
    (_, i) =>
      `<p>Intermediate check ${i + 1}: inspecting logs and metrics for Service X shard ${i + 1}.</p>`
  ).join('');
  const workTail =
    '<p>All canary checks for Region Alpha succeeded with zero elevated errors.</p>' +
    '<p>Ready to proceed to the second rollout wave whenever approved.</p>';
  add('$cal_finished_work', 'finished-work-fold-with-reasoning', AGENT_ID, 4 * min, {
    msgtype: 'm.text',
    body:
      Array.from({ length: 12 }, (_, i) => `Intermediate check ${i + 1}: inspecting logs.`).join(
        '\n\n'
      ) +
      '\n\n🔧 `shell` [1]\n\nAll canary checks for Region Alpha succeeded with zero elevated errors.\n\nReady to proceed to the second rollout wave whenever approved.',
    format: 'org.matrix.custom.html',
    formatted_body: `${workHead}<p>🔧 <code>shell</code> [1]</p>${workTail}`,
    'io.mindroom.reasoning': {
      text: 'Evaluating shard readiness and verifying error budgets before summarizing.',
      duration_ms: 4200,
    },
    'io.mindroom.tool_trace': {
      version: 2,
      events: [{ type: 'tool_call_started', tool_name: 'shell', args_preview: 'check-health' }],
    },
    'io.mindroom.ai_run': AI_RUN,
    'io.mindroom.stream_status': 'completed',
  });

  // Edited m.replace reply (original "Thinking..." replaced by full multi-paragraph reply)
  const editedTargetId = '$cal_edited_target';
  add(editedTargetId, 'edited-m-replace-reply', AGENT_ID, 4 * min, {
    msgtype: 'm.text',
    body: 'Thinking...',
    'io.mindroom.stream_status': 'streaming',
  });
  const replacedParagraphs = [
    'Final rollout summary: Region Alpha and Region Beta completed health verification with stable p95 latency.',
    'Item A (edge routing), Item B (worker pool), and Item C (telemetry export) report nominal throughput.',
    'Rollback snapshots remain pinned for 48 hours and alerting thresholds stay tightened through Monday.',
  ];
  const replacedContent = {
    msgtype: 'm.text',
    body: replacedParagraphs.join('\n\n'),
    format: 'org.matrix.custom.html',
    formatted_body: replacedParagraphs.map((p) => `<p>${p}</p>`).join(''),
    'io.mindroom.ai_run': AI_RUN,
    'io.mindroom.stream_status': 'completed',
  };
  events.push({
    type: 'm.room.message',
    event_id: '$cal_edited_replace',
    sender: AGENT_ID,
    origin_server_ts: baseTs + tsOffset + min,
    room_id: ROOM_ID,
    content: {
      msgtype: 'm.text',
      body: `* ${replacedContent.body}`,
      'm.new_content': replacedContent,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: editedTargetId,
      },
      'io.mindroom.ai_run': AI_RUN,
      'io.mindroom.stream_status': 'completed',
    },
  });

  // Bottom exchanges so middle rows start unmeasured on initial open at bottom.
  for (let i = 1; i <= 6; i += 1) {
    add(`$cal_tail_human_${i}`, `tail-human-${i}`, USER_ID, 2 * min, {
      msgtype: 'm.text',
      body: `Status check ${i}: confirm Service X and Service Y metrics stay steady in wave ${i}.`,
    });
    add(`$cal_tail_agent_${i}`, `tail-agent-${i}`, AGENT_ID, 2 * min, {
      msgtype: 'm.text',
      body: `Wave ${i} verified: Service X latency, error rate, and queue depth remain within budget.`,
      'io.mindroom.ai_run': AI_RUN,
      'io.mindroom.stream_status': 'completed',
    });
  }

  return { events, labelsByEventId };
};

const readVirtualizerDiagnostics = async (page: Page) =>
  page.evaluate(() => {
    const inner = document.querySelector<HTMLElement>('[data-thread-count]');
    if (!inner) return null;
    const fiberKey = Object.keys(inner).find((k) => k.startsWith('__reactFiber$'));
    if (!fiberKey) return null;
    let fiber = (inner as unknown as Record<string, any>)[fiberKey];
    let virtualizer: any = null;
    while (fiber) {
      if (fiber.memoizedProps?.list?.virtualizer) {
        virtualizer = fiber.memoizedProps.list.virtualizer;
        break;
      }
      fiber = fiber.return;
    }
    if (!virtualizer) return null;
    const count: number = virtualizer.options.count;
    const estimates: { index: number; key: string; estimated: number; cached: boolean }[] = [];
    const cache: Map<unknown, number> | undefined = virtualizer.itemSizeCache;
    for (let i = 0; i < count; i += 1) {
      const key = virtualizer.options.getItemKey(i);
      estimates.push({
        index: i,
        key: String(key),
        estimated: Number(virtualizer.options.estimateSize(i)),
        cached: Boolean(cache?.has(key)),
      });
    }
    const mountedTiles = Array.from(inner.querySelectorAll<HTMLElement>('[data-index]')).map(
      (el) => ({
        index: Number(el.dataset.index),
        height: Math.round(el.getBoundingClientRect().height * 10) / 10,
      })
    );
    const scroller: HTMLElement | null = virtualizer.scrollElement ?? null;
    return {
      count,
      holdOffset: Number(virtualizer._holdOffset ?? 0),
      canWriteScroll: Boolean(virtualizer._canWriteScroll?.()),
      scrollTop: scroller?.scrollTop ?? 0,
      scrollHeight: scroller?.scrollHeight ?? 0,
      clientWidth: scroller?.clientWidth ?? 0,
      estimates,
      mountedTiles,
    };
  });

const dispatchScrollerAction = (
  page: Page,
  action: 'touchstart' | 'touchend' | 'stepUp',
  stepPx = 320
) =>
  page.evaluate(
    ({ op, delta }: { op: 'touchstart' | 'touchend' | 'stepUp'; delta: number }) => {
      const inner = document.querySelector<HTMLElement>('[data-thread-count]');
      if (!inner) return { ok: false, done: true };
      const fiberKey = Object.keys(inner).find((k) => k.startsWith('__reactFiber$'));
      if (!fiberKey) return { ok: false, done: true };
      let fiber = (inner as unknown as Record<string, any>)[fiberKey];
      let scroller: HTMLElement | null = null;
      while (fiber) {
        const el = fiber.memoizedProps?.list?.virtualizer?.scrollElement;
        if (el) {
          scroller = el as HTMLElement;
          break;
        }
        fiber = fiber.return;
      }
      if (!scroller) return { ok: false, done: true };
      if (op === 'touchstart' || op === 'touchend') {
        scroller.dispatchEvent(new Event(op, { bubbles: true }));
        return { ok: true, done: false };
      }
      if (scroller.scrollTop <= 0) return { ok: true, done: true };
      scroller.scrollTop = Math.max(0, scroller.scrollTop - delta);
      scroller.dispatchEvent(new Event('scroll'));
      return { ok: true, done: false };
    },
    { op: action, delta: stepPx }
  );

test('phone thread row height estimates calibrate closely against real DOM tiles and bound upward scroll holdOffset', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const { events, labelsByEventId } = buildCalibrationEvents();
  const mock = await startMockMatrixServer(events, {
    roomId: ROOM_ID,
    roomName: 'Calibration Room',
    userId: USER_ID,
    otherUserId: AGENT_ID,
    otherDisplayName: 'Agent',
  });

  try {
    const setup = page.getByRole('dialog').filter({ hasText: 'Set up your recovery password' });
    await page.addLocatorHandler(setup, () => setup.getByRole('button', { name: 'Not now' }).click());
    const tourDismiss = page.locator('[data-tour-offer-action="dismiss"]');
    await page.addLocatorHandler(tourDismiss, () => tourDismiss.click());

    await page.goto(baseURL ?? '/');
    await page.evaluate(
      ({ serverUrl, userId }: { serverUrl: string; userId: string }) => {
        const sessionId = `${serverUrl}|${userId}`;
        localStorage.setItem(
          'mindroom_multi_account_store',
          JSON.stringify({
            version: 1,
            activeSessionId: sessionId,
            sessions: [
              {
                sessionId,
                baseUrl: serverUrl,
                userId,
                deviceId: 'E2EDEVICE',
                accessToken: 'fake-token',
                lastUsedAt: Date.now(),
              },
            ],
          })
        );
      },
      { serverUrl: mock.baseUrl, userId: USER_ID }
    );

    await page.goto(
      `/home/${encodeURIComponent(ROOM_ID)}?threadId=${encodeURIComponent(ROOT_ID)}`
    );

    await expect(
      page
        .getByText('Wave 6 verified: Service X latency, error rate, and queue depth remain within budget.')
        .first()
    ).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(400);

    const initial = await readVirtualizerDiagnostics(page);
    expect(initial).not.toBeNull();

    const unmeasuredBeforeDrag = initial!.estimates.filter((e) => e.estimated > 0 && !e.cached);
    expect(unmeasuredBeforeDrag.length).toBeGreaterThanOrEqual(6);

    const measuredByIndex = new Map<number, number>();
    const recordMounted = (diag: NonNullable<typeof initial>) => {
      for (const tile of diag.mountedTiles) {
        if (tile.height > 0) measuredByIndex.set(tile.index, tile.height);
      }
    };
    recordMounted(initial!);

    // Simulate an active iOS touch drag upward from bottom to top, observing real _holdOffset.
    const started = await dispatchScrollerAction(page, 'touchstart');
    expect(started.ok).toBe(true);

    let maxAbsHoldOffset = Math.abs(initial!.holdOffset);
    let maxPositiveHoldOffset = Math.max(0, initial!.holdOffset);
    let sawHeldGesture = false;
    for (let step = 0; step < 45; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { done } = await dispatchScrollerAction(page, 'stepUp', 280);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(80);
      // eslint-disable-next-line no-await-in-loop
      const snap = await readVirtualizerDiagnostics(page);
      if (snap) {
        recordMounted(snap);
        if (!snap.canWriteScroll) sawHeldGesture = true;
        maxAbsHoldOffset = Math.max(maxAbsHoldOffset, Math.abs(snap.holdOffset));
        maxPositiveHoldOffset = Math.max(maxPositiveHoldOffset, snap.holdOffset);
      }
      if (done) break;
    }
    expect(sawHeldGesture).toBe(true);

    await dispatchScrollerAction(page, 'touchend');
    // Wait for iOS touch tail (150ms) to flush _holdOffset back to 0.
    await page.waitForTimeout(350);
    const settled = await readVirtualizerDiagnostics(page);
    expect(settled?.holdOffset).toBe(0);

    const rows = initial!.estimates
      .filter((e) => e.estimated > 0 || (measuredByIndex.get(e.index) ?? 0) > 0)
      .map((e) => {
        const measured = measuredByIndex.get(e.index) ?? 0;
        const diff = measured - e.estimated;
        const pct = measured > 0 ? Math.round((diff / measured) * 100) : 0;
        return {
          index: e.index,
          key: e.key,
          label: labelsByEventId[e.key] ?? e.key,
          estimated: e.estimated,
          measured,
          diff,
          pct,
          initiallyCached: e.cached,
        };
      });

    const totalEstimated = rows.reduce((s, r) => s + r.estimated, 0);
    const totalMeasured = rows.reduce((s, r) => s + r.measured, 0);
    const cumulativeRelErr = Math.abs(totalEstimated - totalMeasured) / totalMeasured;

    console.log(
      'CALIBRATION TABLE:\n' +
        rows
          .map(
            (r) =>
              `  [${String(r.index).padStart(2)}] ${r.label.padEnd(36)} est=${String(r.estimated).padStart(4)} meas=${String(r.measured).padStart(5)} diff=${String(r.diff).padStart(5)} (${r.pct}%) ${r.initiallyCached ? 'cached' : 'PRE-MOUNT'}`
          )
          .join('\n') +
        `\nTOTAL: est=${totalEstimated} meas=${totalMeasured} relErr=${(cumulativeRelErr * 100).toFixed(1)}% maxHold=${maxAbsHoldOffset} maxPosHold=${maxPositiveHoldOffset} unmeasured=${unmeasuredBeforeDrag.length} clientWidth=${initial!.clientWidth}`
    );

    expect(rows.length).toBeGreaterThanOrEqual(26);
    for (const r of rows) {
      expect(r.measured, `row ${r.label} was measured`).toBeGreaterThan(0);
    }
    // Cumulative estimate accuracy within ±15% of real measured DOM height.
    expect(cumulativeRelErr).toBeLessThanOrEqual(0.15);
    // Real iOS _holdOffset stays tightly bounded during upward touch flick (no brick wall).
    expect(maxAbsHoldOffset).toBeLessThan(350);
    expect(maxPositiveHoldOffset).toBeLessThan(350);
  } finally {
    await mock.close();
  }
});
