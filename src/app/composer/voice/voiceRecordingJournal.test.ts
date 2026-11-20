import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Journal = typeof import('./voiceRecordingJournal');

const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const journalKeys = async () => {
  const db = await openDB('mindroom-voice-journal');
  const keys = [await db.getAllKeys('recordings'), await db.getAllKeys('chunks')];
  db.close();
  return keys;
};

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

  it('writes a chunk whose write failed again with the next one, in its place', async () => {
    const tab = await openTab();
    const capture = tab.journal.voiceCaptureJournal(() => ALICE);
    await capture.begin({ recordingId: 'rec-1', startedAt: 1_000, mimeType: 'audio/webm' });
    const chunk = (data: Blob, seq: number) =>
      capture.append('rec-1', seq, { data, elapsedMs: (seq + 1) * 1_000, samples: [] });
    expect(await chunk(blob('one '), 0)).toBe(true);
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('The disk is full.', 'QuotaExceededError');
    });
    // Not on disk: the recording is not protected for now.
    expect(await chunk(blob('two '), 1)).toBe(false);
    expect((await journalKeys())[1]).toEqual([['rec-1', 0]]);
    // The next write takes it along: the disk holds all of it again.
    expect(await chunk(blob('three'), 2)).toBe(true);

    tab.close();
    const [orphan] = await (await openTab()).journal.adoptVoiceOrphans(ALICE);
    expect(await text(orphan!.file)).toBe('one two three');
    expect(orphan!.duration).toBe(3_000);
  });

  it('keeps what came before a chunk that cannot be written at all, and says so from then on', async () => {
    const tab = await openTab();
    const capture = tab.journal.voiceCaptureJournal(() => ALICE);
    await capture.begin({ recordingId: 'rec-1', startedAt: 1_000, mimeType: 'audio/webm' });
    const broken = blob('lost');
    broken.arrayBuffer = () => Promise.reject(new Error('unreadable'));
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

  it('offers a recording to a later call once its tab is gone, or once it can be read', async () => {
    const live = await openTab();
    await record(live.journal, 'rec-live', ['live']);
    const crashed = await openTab();
    await record(crashed.journal, 'rec-unread', ['unread']);
    crashed.close();

    const page = await openTab();
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementationOnce(() => {
      throw new DOMException('The read failed.', 'UnknownError');
    });
    // One is held by its tab and one cannot be read: neither is this page's, and neither is lost.
    expect(await page.journal.adoptVoiceOrphans(ALICE)).toEqual([]);
    await vi.waitFor(() => expect(browser.held()).toEqual(['mindroom-voice-recording:rec-live']));

    const readable = await page.journal.adoptVoiceOrphans(ALICE);
    expect(readable.map((orphan) => orphan.record.recordingId)).toEqual(['rec-unread']);
    live.close();
    const freed = await page.journal.adoptVoiceOrphans(ALICE);
    expect(freed.map((orphan) => orphan.record.recordingId)).toEqual(['rec-live']);
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

  it('without Web Locks keeps nothing on disk and takes nothing over', async () => {
    const crashed = await openTab();
    await record(crashed.journal, 'rec-orphan', ['orphan']);
    crashed.close();

    const lockless = await openTab(false);
    // Nothing says whose a recording is: it lives in memory, and says it is not protected.
    expect(await record(lockless.journal, 'rec-1', ['audio'])).toEqual([false, false]);
    expect(await lockless.journal.updateVoiceRecording('rec-1', { txnId: 'txn' })).toBe(false);
    // What another browser version left stays where it is, for a page that can own it.
    expect(await lockless.journal.adoptVoiceOrphans(ALICE)).toEqual([]);
    expect(await journalKeys()).toEqual([['rec-orphan'], [['rec-orphan', 0]]]);
  });

  it('says whether a later change reached the disk, and returns it with the orphan', async () => {
    const tab = await openTab();
    await record(tab.journal, 'rec-1', ['audio']);
    const destination = {
      roomId: '!room:example.org',
      threadId: '$root',
      replyEventId: '$reply',
      threadingEnabled: true,
    };
    expect(await tab.journal.updateVoiceRecording('rec-1', { destination, txnId: 'txn-1' })).toBe(
      true
    );
    // No such recording on disk: nothing was kept.
    expect(await tab.journal.updateVoiceRecording('rec-gone', { txnId: 'txn-2' })).toBe(false);
    // Another tab's recording is not this one's to change.
    const other = await openTab();
    expect(await other.journal.updateVoiceRecording('rec-1', { txnId: 'txn-3' })).toBe(false);
    // A write the disk refused.
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('The disk is full.', 'QuotaExceededError');
    });
    expect(await tab.journal.updateVoiceRecording('rec-1', { txnId: 'txn-4' })).toBe(false);

    tab.close();
    const [orphan] = await (await openTab()).journal.adoptVoiceOrphans(ALICE);
    expect(orphan!.record).toMatchObject({ destination, txnId: 'txn-1' });
  });

  it('deletes a discard that stood, returns one with time left, and expires only what the disk says', async () => {
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
    const orphans = await next.journal.adoptVoiceOrphans(ALICE, 6_000);
    expect(
      orphans.map(({ record: { recordingId, discardUntil } }) => [recordingId, discardUntil])
    ).toEqual([
      ['rec-pending', 9_000],
      ['rec-undone', undefined],
    ]);
    expect((await journalKeys())[0]).toEqual(['rec-pending', 'rec-undone']);

    // Its time is not up yet, and the other is not discarded at all.
    await next.journal.deleteVoiceRecording('rec-pending', 8_999);
    await next.journal.deleteVoiceRecording('rec-undone', 10_000);
    expect((await journalKeys())[0]).toEqual(['rec-pending', 'rec-undone']);
    await next.journal.deleteVoiceRecording('rec-pending', 9_000);
    expect(await journalKeys()).toEqual([['rec-undone'], [['rec-undone', 0]]]);
  });

  it('deletes a recording that stopped without audio', async () => {
    const tab = await openTab();
    await record(tab.journal, 'rec-empty', []);
    await record(tab.journal, 'rec-full', ['audio']);
    tab.journal.voiceCaptureJournal(() => ALICE).abandon('rec-empty');
    await tab.journal.updateVoiceRecording('rec-full', {});
    expect((await journalKeys())[0]).toEqual(['rec-full']);
    expect(browser.held()).toEqual(['mindroom-voice-recording:rec-full']);
  });

  it("gives a recovered recording its first chunk's own type", async () => {
    const tab = await openTab();
    const capture = tab.journal.voiceCaptureJournal(() => ALICE);
    // What the recorder said before it had recorded anything.
    await capture.begin({ recordingId: 'rec-1', startedAt: 1_000, mimeType: 'audio/ogg' });
    await capture.append('rec-1', 0, {
      data: new Blob(['mp4 bytes'], { type: 'audio/mp4' }),
      elapsedMs: 1_000,
      samples: [],
    });
    tab.close();
    const [orphan] = await (await openTab()).journal.adoptVoiceOrphans(ALICE);
    expect(orphan!.file.type).toBe('audio/mp4');
    expect(orphan!.file.name).toMatch(/\.m4a$/);
  });

  describe('the copy an older version kept', () => {
    const legacyDraft = async (audio: string) => ({
      userId: ALICE,
      audio: await blob(audio).arrayBuffer(),
      fileName: 'voice.ogg',
      fileType: 'audio/ogg',
      duration: 4_200,
      waveform: [1, 4, 2],
      errorMessage: 'M_UNKNOWN: injected',
      roomId: '!room:example.org',
      threadId: '$thread',
      replyDraft: {
        userId: BOB,
        eventId: '$reply',
        body: 'the quoted secret',
        formattedBody: '<b>the quoted secret</b>',
        previewText: 'the quoted secret',
        relation: { rel_type: 'm.thread', event_id: '$thread' },
      },
      threadingEnabled: true,
      signalBridgedRoom: false,
      threadView: true,
    });
    const openLegacy = () =>
      openDB('mindroom-voice-drafts', 1, {
        upgrade(db) {
          db.createObjectStore('drafts', { keyPath: 'userId' });
        },
      });
    const putLegacy = async (audio: string) => {
      const legacy = await openLegacy();
      await legacy.put('drafts', await legacyDraft(audio));
      legacy.close();
    };
    const legacyKeys = async () => {
      const legacy = await openLegacy();
      const keys = await legacy.getAllKeys('drafts');
      legacy.close();
      return keys;
    };

    it('is copied once, with the IDs of what it relates to and none of the text', async () => {
      await putLegacy('old voice bytes');
      const tab = await openTab();
      const [orphan, ...rest] = await tab.journal.adoptVoiceOrphans(ALICE);
      expect(rest).toEqual([]);
      expect(await text(orphan!.file)).toBe('old voice bytes');
      expect(orphan!.file.type).toBe('audio/ogg');
      expect(orphan!.duration).toBe(4_200);
      expect(orphan!.record.userId).toBe(ALICE);
      expect(orphan!.record.destination).toEqual({
        roomId: '!room:example.org',
        threadId: '$thread',
        replyEventId: '$reply',
        replyThreadId: '$thread',
        threadingEnabled: true,
        threadView: true,
      });
      const db = await openDB('mindroom-voice-journal');
      expect(JSON.stringify(await db.getAll('recordings'))).not.toContain('secret');
      db.close();
      // The old database stays for a tab of the older version; its entry is gone.
      expect(await legacyKeys()).toEqual([]);

      // The next page finds it in the journal only, once.
      tab.close();
      const again = await (await openTab()).journal.adoptVoiceOrphans(ALICE);
      expect(again.map((entry) => entry.record.recordingId)).toEqual([orphan!.record.recordingId]);
    });

    it('is not copied twice, and a newer one an old tab wrote since is copied too', async () => {
      await putLegacy('old voice bytes');
      const tab = await openTab();
      const [first] = await tab.journal.adoptVoiceOrphans(ALICE);
      await tab.journal.updateVoiceRecording(first!.record.recordingId, { txnId: 'txn-kept' });
      // As if its delete had failed: the same entry is there again.
      await putLegacy('old voice bytes');
      expect(await tab.journal.adoptVoiceOrphans(ALICE)).toEqual([]);
      expect(await legacyKeys()).toEqual([]);
      const db = await openDB('mindroom-voice-journal');
      expect(await db.getAll('recordings')).toMatchObject([{ txnId: 'txn-kept' }]);
      db.close();

      await putLegacy('newer voice bytes');
      const [second, ...rest] = await tab.journal.adoptVoiceOrphans(ALICE);
      expect(rest).toEqual([]);
      expect(await text(second!.file)).toBe('newer voice bytes');
    });

    it('keeps an entry that changed while it was copied', async () => {
      await putLegacy('old voice bytes');
      const tab = await openTab();
      // An old tab saves another failed send right after this page read the old database.
      const getAll = IDBObjectStore.prototype.getAll;
      vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementationOnce(function read(
        this: IDBObjectStore,
        ...args
      ) {
        const request = getAll.apply(this, args);
        request.addEventListener('success', () => void putLegacy('written meanwhile'));
        return request;
      });
      const [orphan] = await tab.journal.adoptVoiceOrphans(ALICE);
      expect(await text(orphan!.file)).toBe('old voice bytes');
      expect(await legacyKeys()).toEqual([ALICE]);
      const [later] = await tab.journal.adoptVoiceOrphans(ALICE);
      expect(await text(later!.file)).toBe('written meanwhile');
      expect(await legacyKeys()).toEqual([]);
    });

    it('is tried again by the next call when it could not be read', async () => {
      await putLegacy('old voice bytes');
      const tab = await openTab();
      vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementationOnce(() => {
        throw new DOMException('The read failed.', 'UnknownError');
      });
      expect(await tab.journal.adoptVoiceOrphans(ALICE)).toEqual([]);
      const [orphan] = await tab.journal.adoptVoiceOrphans(ALICE);
      expect(await text(orphan!.file)).toBe('old voice bytes');
    });
  });

  it("forgets an account's recordings on sign-out", async () => {
    const tab = await openTab();
    await record(tab.journal, 'rec-alice', ['a']);
    await record(tab.journal, 'rec-bob', ['b'], BOB);
    await tab.journal.clearVoiceRecordings(ALICE);
    expect(await journalKeys()).toEqual([['rec-bob'], [['rec-bob', 0]]]);
    expect(browser.held()).toEqual(['mindroom-voice-recording:rec-bob']);
  });
});
