// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdModalSheet } from '../lib/portalOverlay';
import { logTimelineDebug } from './timelineDebug';
import { registerMemoryGauge, sampleMemory } from './memorySampler';
import { SCHEDULER_WAKEUP_REPLACED_EVENT } from './schedulerWakeup';
import { THREAD_TRACE_PHASES } from './threadTraceSchema';
import {
  classifyDeepTraceNetworkRequest,
  classifyDeepTraceRoute,
  clearDeepTrace,
  DEEP_TRACE_DB_NAME,
  DEEP_TRACE_ENABLED_KEY,
  DEEP_TRACE_MAX_EVENTS,
  DEEP_TRACE_MAX_PENDING_EVENTS,
  getDeepTraceEnabled,
  initializeDeepTraceRecorder,
  isDeepTraceRecording,
  measureDeepTracePhase,
  readDeepTraceSnapshot,
  recordDeepTraceEvent,
  recordSavedReplayFailure,
  recordSyncStoreFailure,
  setDeepTraceEnabled,
  traceDeepDiagnosticFetch,
} from './deepTrace';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe('opt-in deep diagnostic trace', () => {
  let storage: MemoryStorage;
  let dispose: (() => void) | undefined;

  beforeEach(async () => {
    // The recorder's one-second loop timer records a navigation event on its first tick and a
    // stall event on a late one. A test that runs past a second on a busy machine found them
    // after its own events, so the timer only ticks when a test advances it.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    storage = new MemoryStorage();
    dispose = initializeDeepTraceRecorder(storage);
    await clearDeepTrace();
  });

  afterEach(async () => {
    await setDeepTraceEnabled(false, storage);
    dispose?.();
    dispose = undefined;
    await clearDeepTrace();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('records nothing until the device-local preference is enabled', async () => {
    recordDeepTraceEvent('test.before_enable', { count: 1 });

    expect(getDeepTraceEnabled(storage)).toBe(false);
    expect((await readDeepTraceSnapshot()).events).toEqual([]);

    expect(await setDeepTraceEnabled(true, storage)).toBe(true);
    recordDeepTraceEvent('test.after_enable', { count: 2, ready: true });

    const snapshot = await readDeepTraceSnapshot();
    expect(storage.getItem(DEEP_TRACE_ENABLED_KEY)).toBe('1');
    expect(snapshot.status).toBe('recording');
    expect(snapshot.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'trace.session.start' }),
        expect.objectContaining({
          name: 'test.after_enable',
          data: { count: 2, ready: true },
        }),
      ])
    );
    expect(snapshot.events).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'test.before_enable' })])
    );
  });

  it('stops capture immediately while retaining the bounded trace for export', async () => {
    await setDeepTraceEnabled(true, storage);
    recordDeepTraceEvent('test.before_disable');
    await setDeepTraceEnabled(false, storage);
    recordDeepTraceEvent('test.after_disable');

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.status).toBe('disabled');
    expect(snapshot.events.map((event) => event.name)).toContain('test.before_disable');
    expect(snapshot.events.map((event) => event.name)).toContain('trace.session.stop');
    expect(snapshot.events.map((event) => event.name)).not.toContain('test.after_disable');
  });

  it('persists a clean stop marker when the recorder is disposed', async () => {
    await setDeepTraceEnabled(true, storage);

    dispose?.();
    dispose = undefined;

    expect((await readDeepTraceSnapshot()).events.map((event) => event.name)).toContain(
      'trace.session.stop'
    );
  });

  it('keeps dynamic metadata numeric and rejects unsafe event names', async () => {
    await setDeepTraceEnabled(true, storage);
    recordDeepTraceEvent('test.safe', {
      count: 3,
      finite: Number.POSITIVE_INFINITY,
      // Runtime validation protects the export even if an unchecked caller bypasses TypeScript.
      private_text: 'secret message' as never,
    });
    recordDeepTraceEvent('secret room/id');
    recordDeepTraceEvent('interaction.open.private-room');

    const json = JSON.stringify(await readDeepTraceSnapshot());
    expect(json).not.toContain('secret message');
    expect(json).not.toContain('secret room');
    expect(json).not.toContain('private-room');
    expect(json).not.toContain('finite');
    expect(json).toContain('"count":3');
  });

  it('retains every metric declared by the thread trace schema', async () => {
    await setDeepTraceEnabled(true, storage);
    for (const [phase, [, fields]] of Object.entries(THREAD_TRACE_PHASES)) {
      const payload = Object.fromEntries(fields.map((field, index) => [field, index + 100]));
      logTimelineDebug('thread-open#7#synthetic', phase, payload);
    }
    const snapshot = await readDeepTraceSnapshot();
    for (const [name, fields] of Object.values(THREAD_TRACE_PHASES)) {
      const event = snapshot.events.find((entry) => entry.name === name);
      expect(event?.data?.trace_id).toBe(7);
      expect(Object.values(event?.data ?? {}).sort((a, b) => Number(a) - Number(b))).toEqual([
        7,
        ...fields.map((_, index) => index + 100),
      ]);
    }
  });

  it('exports attempted and committed thread state without identifiers or message text', async () => {
    await setDeepTraceEnabled(true, storage);
    logTimelineDebug('thread-open#7#private-room#private-thread', 'thread-render-snapshot', {
      eventCount: 0,
      modelEventCount: 3,
      modelReplyCount: 2,
      loadedReplyCount: 0,
      renderableReplyCount: 0,
      mountedReplyCount: 0,
      expectedReplyCount: 2,
      rootMounted: false,
      virtualItemCount: 0,
      cacheHydrated: false,
      sdkReady: false,
      loading: false,
      loadError: false,
      renderAttemptCount: 3,
      commitCount: 1,
      attemptedEventCount: 3,
      attemptedSdkReady: true,
      attemptedCacheHydrated: true,
      body: 'private message',
    });
    const snapshot = await readDeepTraceSnapshot();
    const event = snapshot.events.find((entry) => entry.name === 'thread.render');
    expect(event?.data).toMatchObject({
      trace_id: 7,
      event_count: 0,
      render_attempt_count: 3,
      commit_count: 1,
      attempted_event_count: 3,
      attempted_sdk_ready: true,
      attempted_cache_hydrated: true,
    });
    expect(JSON.stringify(event)).not.toContain('private');
    logTimelineDebug('thread-open#7#private-room', 'thread-render-scheduler', {
      source: 3,
      delayMs: 50,
      visible: true,
    });
    expect((await readDeepTraceSnapshot()).events).toContainEqual(
      expect.objectContaining({
        name: 'thread.scheduler',
        data: { trace_id: 7, source: 3, delay_ms: 50, visible: true },
      })
    );
  });

  it('records React Scheduler wakeup replacements with only their delay', async () => {
    await setDeepTraceEnabled(true, storage);

    window.dispatchEvent(
      new CustomEvent(SCHEDULER_WAKEUP_REPLACED_EVENT, { detail: { elapsedMs: 251.37 } })
    );
    window.dispatchEvent(
      new CustomEvent(SCHEDULER_WAKEUP_REPLACED_EVENT, { detail: { elapsedMs: 'private' } })
    );

    const snapshot = await readDeepTraceSnapshot();
    const replacements = snapshot.events.filter(
      (event) => event.name === 'performance.scheduler_wakeup_replaced'
    );
    expect(replacements.map((event) => event.data)).toEqual([{ elapsed_ms: 251.4 }, undefined]);
    expect(JSON.stringify(snapshot)).not.toContain('private');
  });

  it('records an IndexedDB loss recovery reload with its age', async () => {
    await setDeepTraceEnabled(true, storage);

    recordDeepTraceEvent('storage.indexeddb_loss_reload', { reload_ms_ago: 1_500 });

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({
        name: 'storage.indexeddb_loss_reload',
        data: { reload_ms_ago: 1_500 },
      })
    );
  });

  it('records a sync store failure with the code of its error', async () => {
    await setDeepTraceEnabled(true, storage);

    recordSyncStoreFailure('failed', new DOMException('private detail', 'UnknownError'));
    recordSyncStoreFailure('stopped', new TypeError('private detail'));
    recordSyncStoreFailure('degraded', new DOMException('private detail', 'QuotaExceededError'));

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({ name: 'storage.sync_store.failed', data: { error_code: 13 } })
    );
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({ name: 'storage.sync_store.stopped', data: { error_code: 7 } })
    );
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({ name: 'storage.sync_store.degraded', data: { error_code: 12 } })
    );
    expect(JSON.stringify(snapshot)).not.toContain('private');
  });

  it('records a failed replay of the saved sync with the code of its error', async () => {
    await setDeepTraceEnabled(true, storage);

    recordSavedReplayFailure(new TypeError('private detail'));

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({ name: 'sync.saved_replay.failed', data: { error_code: 7 } })
    );
    expect(JSON.stringify(snapshot)).not.toContain('private');
  });

  it('records call ring trace events with numeric and boolean fields only', async () => {
    await setDeepTraceEnabled(true, storage);

    recordDeepTraceEvent('calls.ring.join.ring', {
      encrypted: true,
      people_in_call: 0,
      direct: false,
      joined_members: 3,
      room_id: '!secret:example.org',
    });
    recordDeepTraceEvent('calls.ring.membership_echo', {
      has_event_id: true,
      old_member_count: 0,
      member_count: 1,
    });
    recordDeepTraceEvent('calls.ring.local_echo.not_sent', {
      encrypted: false,
      http_status: 500,
      has_error: true,
    });
    recordDeepTraceEvent('calls.ring.sent.ring', { has_event_id: true });
    recordDeepTraceEvent('calls.ring.missing_echo', {
      has_membership_event_id: false,
      member_count: 1,
      timeout_ms: 3000,
    });

    const snapshot = await readDeepTraceSnapshot();
    const names = snapshot.events.map((event) => event.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'calls.ring.join.ring',
        'calls.ring.membership_echo',
        'calls.ring.local_echo.not_sent',
        'calls.ring.sent.ring',
        'calls.ring.missing_echo',
      ])
    );
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({
        name: 'calls.ring.join.ring',
        data: { encrypted: true, people_in_call: 0, direct: false, joined_members: 3 },
      })
    );
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });

  it('keeps memory samples with their reason flag and numeric gauges', async () => {
    await setDeepTraceEnabled(true, storage);
    const unregister = registerMemoryGauge('room_live_events', () => 1_234);

    sampleMemory('interval');
    unregister();

    const snapshot = await readDeepTraceSnapshot();
    const sample = snapshot.events.find((event) => event.name === 'memory.sample');
    expect(sample?.data).toMatchObject({
      reason_interval: true,
      dom_nodes: expect.any(Number) as number,
      shadow_roots: expect.any(Number) as number,
      shadow_dom_nodes: expect.any(Number) as number,
      uptime_s: expect.any(Number) as number,
      room_live_events: 1_234,
    });
  });

  it('keeps every media counter beside the sample, within the field limit', async () => {
    await setDeepTraceEnabled(true, storage);

    sampleMemory('interval');

    const snapshot = await readDeepTraceSnapshot();
    const media = snapshot.events.find((event) => event.name === 'memory.media');
    expect(Object.keys(media?.data ?? {}).sort()).toEqual([
      'canvas_mb',
      'canvases',
      'image_decoded_mb',
      'images',
      'media_elements',
      'object_url_mb',
      'object_urls',
      'reason_interval',
    ]);
  });

  it('samples memory as a thread opens', async () => {
    await setDeepTraceEnabled(true, storage);

    logTimelineDebug('thread-open#7#room', 'thread-open-start', {
      shouldScrollToLatestOnOpen: true,
    });

    const snapshot = await readDeepTraceSnapshot();
    const names = snapshot.events.map((event) => event.name);
    expect(names).toContain('thread.open.start');
    expect(names.indexOf('memory.sample')).toBeGreaterThan(names.indexOf('thread.open.start'));
    expect(snapshot.events.find((event) => event.name === 'memory.sample')?.data).toMatchObject({
      reason_thread_open: true,
    });
  });

  it('records cache database stalls', async () => {
    expect(isDeepTraceRecording()).toBe(false);
    await setDeepTraceEnabled(true, storage);
    expect(isDeepTraceRecording()).toBe(true);
    const names = [
      'storage.cache.close',
      'storage.cache.eviction',
      'storage.cache.open_settled',
      'storage.cache.open_stalled',
      'storage.cache.transaction_settled',
      'storage.cache.transaction_stalled',
    ];
    names.forEach((name) => recordDeepTraceEvent(name, { readwrite: true, events: true }));

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.events.filter((event) => names.includes(event.name))).toHaveLength(6);
  });

  it('captures JavaScriptCore stack locations without retaining stack text', async () => {
    await setDeepTraceEnabled(true, storage);
    const reason = new TypeError('private rejection message');
    reason.stack =
      'loadThreads@https://cdn.private.test/app.js:42:7\n' +
      `global code@${window.location.origin}/index.js:8:3`;
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: reason });

    window.dispatchEvent(rejection);

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'error.unhandled_rejection',
          data: expect.objectContaining({
            error_code: 7,
            source_code: 2,
            line: 42,
            column: 7,
          }),
        }),
      ])
    );
    expect(JSON.stringify(snapshot)).not.toContain('private rejection message');
    expect(JSON.stringify(snapshot)).not.toContain('cdn.private.test');
  });

  it('ignores coordinate-like error text and classifies a bare async V8 frame', async () => {
    await setDeepTraceEnabled(true, storage);
    const reason = new TypeError(
      'contact user@private.test:77:2 (https://private.test/fake.js:99:4)'
    );
    reason.stack = `${reason.name}: ${reason.message}\n    at async https://cdn.private.test/app.js:12:5`;
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: reason });

    window.dispatchEvent(rejection);

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'error.unhandled_rejection',
          data: expect.objectContaining({
            source_code: 2,
            line: 12,
            column: 5,
          }),
        }),
      ])
    );
    expect(JSON.stringify(snapshot)).not.toContain('private.test');
    expect(JSON.stringify(snapshot)).not.toContain('fake.js');
  });

  it('records whether a surface tap hit the live slide shield during a slide', async () => {
    await setDeepTraceEnabled(true, storage);
    const stage = document.createElement('div');
    stage.setAttribute('data-swipe-thread-stage', '');
    const shield = document.createElement('div');
    shield.setAttribute('data-swipe-hold-shield', '');
    const child = stage.appendChild(document.createElement('div'));
    stage.append(shield);
    document.body.append(stage);
    try {
      shield.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      child.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      shield.remove();
      child.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      const { events } = await readDeepTraceSnapshot();
      expect(
        events
          .filter(({ name }) => name === 'interaction.pointer.surface.app')
          .map(({ data }) => data?.phone_slide_shield_hit)
      ).toEqual([true, false, undefined]);
    } finally {
      stage.remove();
    }
  });

  it('records only allowlisted surface hit strings and reports blockers', async () => {
    await setDeepTraceEnabled(true, storage);
    const panel = document.createElement('section');
    panel.dataset.testid = 'resizable-plugin-panel';
    panel.setAttribute('data-plugin-panel-open', '');
    const wrapper = document.createElement('div');
    wrapper.append(panel);
    const conversation = document.createElement('div');
    conversation.dataset.conversationBehindPanel = 'true';
    conversation.setAttribute('inert', '');
    const hit = panel.appendChild(document.createElement('span'));
    hit.textContent = 'invented private message';
    const release = holdModalSheet();
    document.body.append(wrapper, conversation);
    try {
      hit.dataset.testid = 'unknown-private-id';
      hit.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      wrapper.setAttribute('inert', '');
      // The browser cannot target the now-inert panel. Tap outside it to sample its state.
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      wrapper.removeAttribute('inert');
      const button = panel.appendChild(document.createElement('button'));
      button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      const { events } = await readDeepTraceSnapshot();
      const surfaces = events.filter(({ name }) => name === 'interaction.pointer.surface.app');
      expect(surfaces[0]?.data).toMatchObject({
        hit_tag: 'span',
        hit_test_id: 'resizable-plugin-panel',
        plugin_panel_inert: false,
        conversation_inert: true,
        conversation_behind_panel: true,
        blocking_portal: true,
        plugin_panel_open: true,
      });
      expect(surfaces[1]?.data).toMatchObject({ hit_test_id: null, plugin_panel_inert: true });
      expect(
        events.find(({ name }) => name === 'interaction.pointer.button.app')?.data
      ).not.toHaveProperty('hit_tag');
      expect(JSON.stringify(events)).not.toMatch(/invented private message|unknown-private-id/);
    } finally {
      release();
      wrapper.remove();
      conversation.remove();
    }
  });

  it('distinguishes a body-portaled menu backdrop from an app surface', async () => {
    await setDeepTraceEnabled(true, storage);
    const root = document.createElement('div');
    root.id = 'root';
    const layer = document.createElement('div');
    const backdrop = layer.appendChild(document.createElement('div'));
    const menu = layer.appendChild(document.createElement('div'));
    menu.setAttribute('role', 'menu');
    document.body.append(root, layer);
    try {
      backdrop.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      layer.remove();
      root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      const { events } = await readDeepTraceSnapshot();
      expect(events.filter(({ name }) => name === 'interaction.pointer.surface.app')).toMatchObject(
        [
          { data: { blocking_portal: false, open_overlay: true, hit_outside_app_root: true } },
          {
            data: {
              blocking_portal: false,
              open_overlay: false,
              hit_outside_app_root: false,
              conversation_behind_panel: null,
            },
          },
        ]
      );
    } finally {
      layer.remove();
      root.remove();
    }
  });

  it('captures range-control interactions through the categorical allowlist', async () => {
    await setDeepTraceEnabled(true, storage);
    const range = document.createElement('input');
    range.type = 'range';
    document.body.append(range);

    range.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect((await readDeepTraceSnapshot()).events.map((event) => event.name)).toContain(
      'interaction.pointer.range.app'
    );
    range.remove();
  });

  it('classifies network requests without retaining homeserver, room, or event identifiers', () => {
    const secret = '!private-room:secret.test';
    const cases = [
      [`https://matrix.secret.test/_matrix/client/v3/sync?since=${secret}`, 'matrix.sync'],
      [
        `https://matrix.secret.test/_matrix/client/v1/rooms/${secret}/relations/$event`,
        'matrix.relations',
      ],
      [`https://matrix.secret.test/_matrix/client/v3/rooms/${secret}/messages`, 'matrix.messages'],
      [`https://matrix.secret.test/_matrix/media/v3/download/secret/id`, 'matrix.media'],
      [`https://matrix.secret.test/_matrix/client/v3/rooms/${secret}/send`, 'matrix.client'],
      [`${window.location.origin}/config.json`, 'app'],
      ['https://third-party.secret.test/path', 'external'],
    ] as const;

    const results = cases.map(([url, expected]) => {
      const classification = classifyDeepTraceNetworkRequest(url);
      expect(classification).toBe(expected);
      return classification;
    });
    expect(JSON.stringify(results)).not.toContain('secret');
  });

  it('traces through a captured Matrix fetch delegate only while enabled', async () => {
    const baseFetch = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-length': '2' } }));
    const capturedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
      traceDeepDiagnosticFetch(baseFetch, input, init);
    const syncUrl = 'https://matrix.example.test/_matrix/client/v3/sync?since=private';

    await capturedFetch(syncUrl);
    await setDeepTraceEnabled(true, storage);
    await capturedFetch(syncUrl);
    await setDeepTraceEnabled(false, storage);
    await capturedFetch(syncUrl);

    expect(baseFetch).toHaveBeenCalledTimes(3);
    const events = (await readDeepTraceSnapshot()).events;
    expect(events.filter((event) => event.name === 'network.matrix.sync.get.start')).toHaveLength(
      1
    );
    expect(
      events.filter((event) => event.name === 'network.matrix.sync.get.complete')
    ).toHaveLength(1);
  });

  it('persists a Matrix request start before the request settles', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const baseFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const readStoredNames = () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open(DEEP_TRACE_DB_NAME);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const all = database.transaction('events', 'readonly').objectStore('events').getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            database.close();
            resolve(all.result.map((event) => String(event.name)));
          };
        };
      });
    await setDeepTraceEnabled(true, storage);

    const pending = traceDeepDiagnosticFetch(
      baseFetch,
      'https://matrix.example.test/_matrix/client/v3/sync'
    );

    await vi.waitFor(async () => {
      expect(await readStoredNames()).toContain('network.matrix.sync.get.start');
    });
    expect(baseFetch).toHaveBeenCalledOnce();

    resolveFetch?.(new Response('{}', { status: 200 }));
    await pending;
  });

  it('distinguishes an unknown response size from a zero-byte response', async () => {
    const baseFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await setDeepTraceEnabled(true, storage);

    await traceDeepDiagnosticFetch(baseFetch, `${window.location.origin}/config.json`);

    const completion = (await readDeepTraceSnapshot()).events.find(
      (event) => event.name === 'network.app.get.complete'
    );
    expect(completion?.data?.content_bytes).toBeNull();
  });

  // Writes 5,005 events through fake-indexeddb: about a second alone, more than the default
  // 5 s on a busy machine, and a timed-out run kept writing into the next tests.
  it('caps the persisted ring by event count and keeps the newest evidence', async () => {
    await setDeepTraceEnabled(true, storage);
    for (let start = 0; start < DEEP_TRACE_MAX_EVENTS + 5; start += 200) {
      const end = Math.min(start + 200, DEEP_TRACE_MAX_EVENTS + 5);
      for (let index = start; index < end; index += 1) {
        recordDeepTraceEvent('test.ring', { index });
      }
      await readDeepTraceSnapshot();
    }

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.events).toHaveLength(DEEP_TRACE_MAX_EVENTS);
    expect(snapshot.stats.eventCount).toBe(DEEP_TRACE_MAX_EVENTS);
    expect(snapshot.events.at(-1)).toMatchObject({
      name: 'test.ring',
      data: { index: DEEP_TRACE_MAX_EVENTS + 4 },
    });
    expect(snapshot.events.find((event) => event.data?.index === 0)).toBeUndefined();
  }, 30_000);

  it('clears retained events without changing the opt-in preference', async () => {
    await setDeepTraceEnabled(true, storage);
    recordDeepTraceEvent('test.to_clear');
    await readDeepTraceSnapshot();

    await clearDeepTrace();

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.events).toEqual([]);
    expect(snapshot.stats.eventCount).toBe(0);
    expect(getDeepTraceEnabled(storage)).toBe(true);
  });

  it('bounds a burst while storage is busy and reports dropped pending evidence', async () => {
    await setDeepTraceEnabled(true, storage);
    for (let index = 0; index < DEEP_TRACE_MAX_PENDING_EVENTS * 4; index += 1) {
      recordDeepTraceEvent('test.burst', { index });
    }

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.stats.droppedEventCount).toBeGreaterThan(0);
    expect(snapshot.events.at(-1)).toMatchObject({
      name: 'test.burst',
      data: { index: DEEP_TRACE_MAX_PENDING_EVENTS * 4 - 1 },
    });
  });

  it('stops capture even when the disabled preference cannot be removed', async () => {
    await setDeepTraceEnabled(true, storage);
    const removeItem = storage.removeItem.bind(storage);
    vi.spyOn(storage, 'removeItem').mockImplementation((key) => {
      if (key === DEEP_TRACE_ENABLED_KEY) throw new Error('localStorage blocked');
      removeItem(key);
    });

    expect(await setDeepTraceEnabled(false, storage)).toBe(false);
    recordDeepTraceEvent('test.after_failed_disable');

    const snapshot = await readDeepTraceSnapshot();
    expect(snapshot.status).toBe('disabled');
    expect(snapshot.events.map((event) => event.name)).not.toContain('test.after_failed_disable');
    expect(storage.getItem(DEEP_TRACE_ENABLED_KEY)).toBe('1');
  });

  it('honors a new enable after an in-flight activation is disabled', async () => {
    const firstEnable = setDeepTraceEnabled(true, storage);
    const disable = setDeepTraceEnabled(false, storage);
    const secondEnable = setDeepTraceEnabled(true, storage);

    expect(await firstEnable).toBe(false);
    expect(await disable).toBe(true);
    expect(await secondEnable).toBe(true);
    expect((await readDeepTraceSnapshot()).status).toBe('recording');
    expect(storage.getItem(DEEP_TRACE_ENABLED_KEY)).toBe('1');
  });

  it('observes long-animation-frame entries only while recording and sanitizes script attribution', async () => {
    let observerCallback: ((list: { getEntries: () => unknown[] }) => void) | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class FakePerformanceObserver {
      static supportedEntryTypes = ['long-animation-frame'];
      constructor(cb: (list: { getEntries: () => unknown[] }) => void) {
        observerCallback = cb;
      }
      observe = observe;
      disconnect = disconnect;
    }
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver);
    try {
      expect(observe).not.toHaveBeenCalled();

      await setDeepTraceEnabled(true, storage);
      expect(observe).toHaveBeenCalledWith({ type: 'long-animation-frame', buffered: false });

      observerCallback?.({
        getEntries: () => [
          // Below threshold and non-blocking: ignored.
          { startTime: 10, duration: 49.9, blockingDuration: 0, scripts: [] },
          // Long frame with multiple scripts: keeps longest script and strips origin/path/query/hash.
          {
            startTime: 1000,
            duration: 120.46,
            blockingDuration: 70.44,
            renderStart: 1085.2,
            styleAndLayoutStart: 1100.1,
            scripts: [
              { duration: 12, invokerType: 'user-callback', sourceURL: 'https://chat.test/a.js' },
              {
                duration: 64.26,
                invokerType: 'event-listener',
                sourceURL:
                  'https://secret.example.test/assets/index-AbCd1234.js?token=syt_secret#room',
                sourceFunctionName: 'collectSpaceThreadEntries',
                sourceCharPosition: 4210,
              },
            ],
          },
          // Blocking frame with unsafe script metadata & zero render/style timestamps.
          {
            startTime: 2000,
            duration: 42,
            blockingDuration: 5.2,
            renderStart: 0,
            styleAndLayoutStart: 0,
            scripts: [
              {
                duration: 30,
                invokerType: 'custom-secret',
                sourceURL: 'blob:https://secret.example.test/550e8400-e29b-41d4-a716-446655440000',
                sourceFunctionName: 'private room !abc:secret.test',
                sourceCharPosition: -1,
              },
            ],
          },
          // Long frame with no scripts.
          { startTime: 3000, duration: 80, blockingDuration: 30, scripts: [] },
        ],
      });

      // Defense in depth: direct recordDeepTraceEvent still strips non-allowlisted strings.
      recordDeepTraceEvent('performance.long_animation_frame', {
        duration_ms: 90,
        top_script_file: 'https://secret.example.test/bad.js',
        top_script_fn: 'bad fn name',
        top_script_invoker_type: 'secret-type',
      });

      await setDeepTraceEnabled(false, storage);
      expect(disconnect).toHaveBeenCalledOnce();
      observerCallback?.({
        getEntries: () => [{ startTime: 4000, duration: 99, blockingDuration: 49, scripts: [] }],
      });

      const snapshot = await readDeepTraceSnapshot();
      const loafs = snapshot.events.filter((e) => e.name === 'performance.long_animation_frame');
      expect(loafs).toHaveLength(4);
      expect(loafs[0]?.data).toEqual({
        duration_ms: 120.5,
        blocking_ms: 70.4,
        render_delay_ms: 85.2,
        style_layout_ms: 20.4,
        script_count: 2,
        top_script_ms: 64.3,
        top_script_invoker_type: 'event-listener',
        top_script_file: 'index-AbCd1234.js',
        top_script_fn: 'collectSpaceThreadEntries',
        top_script_pos: 4210,
      });
      expect(loafs[1]?.data).toEqual({
        duration_ms: 42,
        blocking_ms: 5.2,
        script_count: 1,
        top_script_ms: 30,
        top_script_invoker_type: 'other',
        top_script_file: null,
        top_script_fn: null,
        top_script_pos: null,
      });
      expect(loafs[2]?.data).toEqual({ duration_ms: 80, blocking_ms: 30, script_count: 0 });
      expect(loafs[3]?.data).toEqual({ duration_ms: 90 });
      expect(JSON.stringify(snapshot)).not.toMatch(/secret|550e8400|!abc/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('skips LoAF capture cleanly when PerformanceObserver does not support long-animation-frame', async () => {
    const observe = vi.fn();
    class UnsupportedObserver {
      static supportedEntryTypes = ['mark', 'measure'];
      observe = observe;
      disconnect = vi.fn();
    }
    vi.stubGlobal('PerformanceObserver', UnsupportedObserver);
    try {
      await setDeepTraceEnabled(true, storage);
      expect(observe).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('splits Space overview routes into threads, room, overview, and thread without leaking IDs', async () => {
    expect(classifyDeepTraceRoute('https://chat.test/%21space%3Atest/threads/')).toBe(
      'space.threads'
    );
    expect(classifyDeepTraceRoute('https://chat.test/%21space%3Atest/%21room%3Atest/')).toBe(
      'space.room'
    );
    expect(classifyDeepTraceRoute('https://chat.test/%21space%3Atest/')).toBe('space.overview');
    expect(classifyDeepTraceRoute('https://chat.test/%21space%3Atest/lobby/')).toBe(
      'space.overview'
    );
    expect(classifyDeepTraceRoute('https://chat.test/%21space%3Atest/search/')).toBe(
      'space.overview'
    );
    expect(
      classifyDeepTraceRoute('https://chat.test/%21space%3Atest/%21room%3Atest/?threadId=%24t1')
    ).toBe('space.thread');
    expect(classifyDeepTraceRoute('https://chat.test/home/')).toBe('home.overview');

    const originalUrl = window.location.href;
    await setDeepTraceEnabled(true, storage);
    try {
      for (const nextPath of [
        '/%21secret-space%3Atest/threads/',
        '/%21secret-space%3Atest/%21secret-room%3Atest/',
        '/%21secret-space%3Atest/lobby/',
        '/%21secret-space%3Atest/%21secret-room%3Atest/?threadId=%24secret-thread',
      ]) {
        window.history.replaceState(null, '', nextPath);
        vi.advanceTimersByTime(1_000);
      }
      const snapshot = await readDeepTraceSnapshot();
      expect(
        snapshot.events.filter((e) => e.name.startsWith('navigation.')).map((e) => e.name)
      ).toEqual([
        'navigation.space.threads',
        'navigation.space.room',
        'navigation.space.overview',
        'navigation.space.thread',
      ]);
      expect(JSON.stringify(snapshot)).not.toContain('secret');
    } finally {
      window.history.replaceState(null, '', originalUrl);
    }
  });

  it('measures slow overview phases only while recording and skips passes under 16 ms', async () => {
    const nowSpy = vi.spyOn(performance, 'now');

    expect(measureDeepTracePhase('spaceThreads.collect', () => 'off-result')).toBe('off-result');
    expect(nowSpy).not.toHaveBeenCalled();

    await setDeepTraceEnabled(true, storage);
    nowSpy.mockClear();

    nowSpy.mockReturnValueOnce(100).mockReturnValueOnce(115.9);
    expect(measureDeepTracePhase('spaceThreads.collect', () => 42)).toBe(42);

    nowSpy.mockReturnValueOnce(200).mockReturnValueOnce(218.46);
    expect(measureDeepTracePhase('spaceThreads.filterSort', () => 'sorted')).toBe('sorted');

    nowSpy.mockReturnValueOnce(300).mockReturnValueOnce(325.1);
    expect(() =>
      measureDeepTracePhase('compactBlocks.layout', () => {
        throw new Error('layout boom');
      })
    ).toThrow('layout boom');

    const snapshot = await readDeepTraceSnapshot();
    const phases = snapshot.events.filter((e) => e.name.startsWith('performance.phase.'));
    expect(phases).toEqual([
      expect.objectContaining({
        name: 'performance.phase.space_threads_filter_sort',
        data: { duration_ms: 18.5 },
      }),
      expect.objectContaining({
        name: 'performance.phase.compact_blocks_layout',
        data: { duration_ms: 25.1 },
      }),
    ]);
  });
});
