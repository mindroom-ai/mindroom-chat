import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Journal = typeof import('./voiceRecordingJournal');

const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';
const MINUTE = 60_000;

/** The Web Locks of one browser: a tab's locks go when it is closed. */
const createBrowserLocks = () => {
  const owners = new Map<string, symbol>();
  const releases = new Map<symbol, (() => void)[]>();
  return {
    forTab: (tab: symbol) => ({
      request: async (
        name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => unknown
      ) => {
        if (owners.has(name)) return callback(null);
        owners.set(name, tab);
        const closed = new Promise<void>((resolve) => {
          releases.set(tab, [...(releases.get(tab) ?? []), resolve]);
        });
        try {
          return await Promise.race([callback({ name, mode: 'exclusive' }), closed]);
        } finally {
          owners.delete(name);
        }
      },
    }),
    close: (tab: symbol) => releases.get(tab)?.forEach((release) => release()),
    held: () => [...owners.keys()],
  };
};

let browser: ReturnType<typeof createBrowserLocks>;

/** A page of the app: its own copy of the journal module, as after a load. */
const openTab = async (withLocks = true) => {
  const tab = Symbol('tab');
  vi.resetModules();
  vi.stubGlobal('navigator', withLocks ? { locks: browser.forTab(tab) } : {});
  const journal: Journal = await import('./voiceRecordingJournal');
  return { journal, close: () => browser.close(tab) };
};

const blob = (text: string) => new Blob([text], { type: 'audio/webm' });

/** Records `texts` as one chunk each, a second apart. */
const record = async (journal: Journal, recordingId: string, texts: string[], userId = ALICE) => {
  const capture = journal.voiceCaptureJournal(() => userId);
  const writes = [
    capture.begin({ recordingId, startedAt: 1_000, mimeType: 'audio/webm' }),
    ...texts.map((text, seq) =>
      capture.append(recordingId, seq, {
        data: blob(text),
        elapsedMs: (seq + 1) * 1_000,
        samples: [seq + 1],
      })
    ),
  ];
  return Promise.all(writes);
};

const text = (file: File) => file.text();

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  browser = createBrowserLocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('voice recording journal', () => {
  it('appends chunks in seq order when arrayBuffer() resolves out of order', async () => {
    const tab = await openTab();
    const capture = tab.journal.voiceCaptureJournal(() => ALICE);
    const slow = blob('first ');
    let finishSlow!: () => void;
    const read = slow.arrayBuffer.bind(slow);
    slow.arrayBuffer = () =>
      new Promise((resolve) => {
        finishSlow = () => resolve(read());
      });
    const begun = capture.begin({ recordingId: 'rec-1', startedAt: 1_000, mimeType: 'audio/webm' });
    const first = capture.append('rec-1', 0, { data: slow, elapsedMs: 1_000, samples: [10] });
    const second = capture.append('rec-1', 1, {
      data: blob('second'),
      elapsedMs: 2_000,
      samples: [20, 30],
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    finishSlow();
    expect(await Promise.all([begun, first, second])).toEqual([true, true, true]);

    tab.close();
    const next = await openTab();
    const [orphan, ...rest] = await next.journal.adoptVoiceOrphans(ALICE);
    expect(rest).toEqual([]);
    expect(await text(orphan!.file)).toBe('first second');
    expect(orphan!.file.type).toBe('audio/webm');
    expect(orphan!.duration).toBe(2_000);
    expect(orphan!.waveform).toHaveLength(48);
    expect(orphan!.record).toMatchObject({ userId: ALICE, recordingId: 'rec-1', startedAt: 1_000 });
  });

  it('keeps a clean prefix and reports false once a write failed', async () => {
    const tab = await openTab();
    const capture = tab.journal.voiceCaptureJournal(() => ALICE);
    await capture.begin({ recordingId: 'rec-1', startedAt: 1_000, mimeType: 'audio/webm' });
    const broken = blob('lost');
    broken.arrayBuffer = () => Promise.reject(new Error('quota'));
    const chunk = (data: Blob, seq: number) =>
      capture.append('rec-1', seq, { data, elapsedMs: (seq + 1) * 1_000, samples: [] });
    expect(await chunk(blob('kept'), 0)).toBe(true);
    expect(await chunk(broken, 1)).toBe(false);
    expect(await chunk(blob('late'), 2)).toBe(false);

    tab.close();
    const [orphan] = await (await openTab()).journal.adoptVoiceOrphans(ALICE);
    expect(await text(orphan!.file)).toBe('kept');
    expect(orphan!.duration).toBe(1_000);
  });

  it('reports false when storage is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const tab = await openTab();
    expect(await record(tab.journal, 'rec-1', ['a'])).toEqual([false, false]);
    expect(await tab.journal.adoptVoiceOrphans(ALICE)).toEqual([]);
  });

  it('adopts only records no tab holds, and two tabs adopt one record once', async () => {
    const recorder = await openTab();
    await record(recorder.journal, 'rec-live', ['live']);
    const crashed = await openTab();
    await record(crashed.journal, 'rec-orphan', ['orphan']);
    await record(crashed.journal, 'rec-bob', ['bob'], BOB);
    crashed.close();

    const second = await openTab();
    const third = await openTab();
    const [a, b] = await Promise.all([
      second.journal.adoptVoiceOrphans(ALICE),
      third.journal.adoptVoiceOrphans(ALICE),
    ]);
    expect([...a, ...b].map((orphan) => orphan.record.recordingId)).toEqual(['rec-orphan']);
    // The tab that adopted it holds it: nobody adopts it again, also not that tab.
    expect(await second.journal.adoptVoiceOrphans(ALICE)).toEqual([]);
    expect(await third.journal.adoptVoiceOrphans(ALICE)).toEqual([]);
    // Deleted, its lock is free again.
    await Promise.all([
      second.journal.deleteVoiceRecording('rec-orphan'),
      third.journal.deleteVoiceRecording('rec-orphan'),
    ]);
    expect(browser.held()).toEqual(['mindroom-voice-recording:rec-live']);
  });

  it('lists orphans oldest first', async () => {
    const crashed = await openTab();
    const start = (recordingId: string, startedAt: number) => {
      const capture = crashed.journal.voiceCaptureJournal(() => ALICE);
      return Promise.all([
        capture.begin({ recordingId, startedAt, mimeType: 'audio/webm' }),
        capture.append(recordingId, 0, { data: blob(recordingId), elapsedMs: 900, samples: [] }),
      ]);
    };
    await start('rec-newer', 2_000);
    await start('rec-older', 1_000);
    crashed.close();
    const orphans = await (await openTab()).journal.adoptVoiceOrphans(ALICE);
    expect(orphans.map((orphan) => orphan.record.recordingId)).toEqual(['rec-older', 'rec-newer']);
  });

  it('without Web Locks adopts only a record that went quiet before the page loaded', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(100 * MINUTE);
    const suspended = await openTab(false);
    await record(suspended.journal, 'rec-1', ['still here']);

    const adopt = async (now: number, loadedAt: number) =>
      (await openTab(false)).journal.adoptVoiceOrphans(ALICE, { now, loadedAt });
    // Quiet for nine minutes: its tab may only be suspended.
    expect(await adopt(109 * MINUTE, 109 * MINUTE)).toEqual([]);
    // Quiet for long enough, but this page was already open when it was written.
    expect(await adopt(111 * MINUTE, 99 * MINUTE)).toEqual([]);
    const adopted = await openTab(false);
    const orphans = await adopted.journal.adoptVoiceOrphans(ALICE, {
      now: 111 * MINUTE,
      loadedAt: 111 * MINUTE,
    });
    expect(orphans.map((orphan) => orphan.record.recordingId)).toEqual(['rec-1']);
    // Its new owner does not adopt it twice.
    expect(
      await adopted.journal.adoptVoiceOrphans(ALICE, { now: 130 * MINUTE, loadedAt: 111 * MINUTE })
    ).toEqual([]);
  });

  it('keeps later changes on the record and returns them with the orphan', async () => {
    const tab = await openTab();
    await record(tab.journal, 'rec-1', ['audio']);
    const destination = {
      roomId: '!room:example.org',
      threadId: '$root',
      threadingEnabled: true,
      signalBridgedRoom: false,
    };
    await tab.journal.updateVoiceRecording('rec-1', { destination, txnId: 'txn-1' });
    await tab.journal.updateVoiceRecording('rec-1', { errorMessage: 'M_UNKNOWN: injected' });
    tab.close();
    const [orphan] = await (await openTab()).journal.adoptVoiceOrphans(ALICE);
    expect(orphan!.record).toMatchObject({
      destination,
      txnId: 'txn-1',
      errorMessage: 'M_UNKNOWN: injected',
    });
  });

  it('deletes a record whose discardUntil has passed, now or later', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const tab = await openTab();
    await record(tab.journal, 'rec-expired', ['a']);
    await record(tab.journal, 'rec-pending', ['b']);
    await record(tab.journal, 'rec-undone', ['c']);
    await tab.journal.updateVoiceRecording('rec-expired', { discardUntil: 5_000 });
    await tab.journal.updateVoiceRecording('rec-pending', { discardUntil: 9_000 });
    await tab.journal.updateVoiceRecording('rec-undone', { discardUntil: 5_000 });
    await tab.journal.updateVoiceRecording('rec-undone', { discardUntil: undefined });
    tab.close();

    const next = await openTab();
    const orphans = await next.journal.adoptVoiceOrphans(ALICE, { now: 6_000 });
    expect(orphans.map((orphan) => orphan.record.recordingId)).toEqual(['rec-undone']);
    const db = await openDB('mindroom-voice-journal');
    expect(await db.getAllKeys('recordings')).toEqual(['rec-pending', 'rec-undone']);
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.waitFor(async () => expect(await db.getAllKeys('recordings')).toEqual(['rec-undone']));
    expect(await db.getAllKeys('chunks')).toEqual([['rec-undone', 0]]);
    db.close();
  });

  it('deletes a recording that stopped without audio and keeps one that has some', async () => {
    const tab = await openTab();
    await record(tab.journal, 'rec-empty', []);
    await record(tab.journal, 'rec-full', ['audio']);
    const capture = tab.journal.voiceCaptureJournal(() => ALICE);
    capture.stop('rec-empty', false);
    capture.stop('rec-full', true);
    await tab.journal.updateVoiceRecording('rec-full', {});
    const db = await openDB('mindroom-voice-journal');
    const records = await db.getAll('recordings');
    expect(records.map((entry) => entry.recordingId)).toEqual(['rec-full']);
    expect(records[0].stoppedAt).toEqual(expect.any(Number));
    db.close();
    expect(browser.held()).toEqual(['mindroom-voice-recording:rec-full']);
  });

  it('imports the old mindroom-voice-drafts copy once', async () => {
    const legacy = await openDB('mindroom-voice-drafts', 1, {
      upgrade(db) {
        db.createObjectStore('drafts', { keyPath: 'userId' });
      },
    });
    await legacy.put('drafts', {
      userId: ALICE,
      audio: await blob('old voice bytes').arrayBuffer(),
      fileName: 'voice.ogg',
      fileType: 'audio/ogg',
      duration: 4_200,
      waveform: [1, 4, 2],
      errorMessage: 'M_UNKNOWN: injected',
      roomId: '!room:example.org',
      threadId: '$thread',
      threadingEnabled: true,
      signalBridgedRoom: false,
      threadView: true,
    });
    legacy.close();

    const tab = await openTab();
    const [orphan, ...rest] = await tab.journal.adoptVoiceOrphans(ALICE);
    expect(rest).toEqual([]);
    expect(await text(orphan!.file)).toBe('old voice bytes');
    expect(orphan!.file.type).toBe('audio/ogg');
    expect(orphan!.duration).toBe(4_200);
    expect(orphan!.record).toMatchObject({
      userId: ALICE,
      errorMessage: 'M_UNKNOWN: injected',
      destination: {
        roomId: '!room:example.org',
        threadId: '$thread',
        threadingEnabled: true,
        signalBridgedRoom: false,
        threadView: true,
      },
    });
    expect((await indexedDB.databases()).map((db) => db.name)).toEqual(['mindroom-voice-journal']);

    // The next page finds it in the journal only, once.
    tab.close();
    const again = await (await openTab()).journal.adoptVoiceOrphans(ALICE);
    expect(again.map((entry) => entry.record.recordingId)).toEqual([orphan!.record.recordingId]);
  });

  it("forgets an account's recordings on sign-out", async () => {
    const tab = await openTab();
    await record(tab.journal, 'rec-alice', ['a']);
    await record(tab.journal, 'rec-bob', ['b'], BOB);
    await tab.journal.clearVoiceRecordings(ALICE);
    const db = await openDB('mindroom-voice-journal');
    expect(await db.getAllKeys('recordings')).toEqual(['rec-bob']);
    expect(await db.getAllKeys('chunks')).toEqual([['rec-bob', 0]]);
    db.close();
    expect(browser.held()).toEqual(['mindroom-voice-recording:rec-bob']);
  });
});
