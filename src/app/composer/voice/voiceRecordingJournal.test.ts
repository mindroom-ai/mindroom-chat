import 'fake-indexeddb/auto';
import { IDBDatabase, IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VoiceJournalRecord } from './voiceRecordingJournal';

type Journal = typeof import('./voiceRecordingJournal');

const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';

type LockCallback = (lock: Lock | null) => unknown;

/** The Web Locks of one browser: a tab's locks go when it is closed, and a request waits its turn. */
const createBrowserLocks = () => {
  const owners = new Map<string, symbol>();
  const releases = new Map<symbol, (() => void)[]>();
  const waiting = new Map<string, (() => void)[]>();
  return {
    forTab: (tab: symbol) => ({
      request: async (name: string, ...rest: [LockOptions, LockCallback] | [LockCallback]) => {
        const callback = rest.at(-1) as LockCallback;
        const ifAvailable = rest.length === 2 && rest[0].ifAvailable;
        while (owners.has(name)) {
          if (ifAvailable) return callback(null);
          // eslint-disable-next-line no-await-in-loop
          await new Promise<void>((resolve) => {
            waiting.set(name, [...(waiting.get(name) ?? []), resolve]);
          });
        }
        owners.set(name, tab);
        const closed = new Promise<void>((resolve) => {
          releases.set(tab, [...(releases.get(tab) ?? []), resolve]);
        });
        try {
          return await Promise.race([callback({ name, mode: 'exclusive' }), closed]);
        } finally {
          owners.delete(name);
          waiting
            .get(name)
            ?.splice(0)
            .forEach((next) => next());
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
      capture.append(recordingId, seq, { data: blob(text), elapsedMs: (seq + 1) * 1_000 })
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

const gone = () => undefined;

const journalKeys = async () => {
  const db = await openDB('mindroom-voice-journal');
  const keys = [await db.getAllKeys('recordings'), await db.getAllKeys('chunks')];
  db.close();
  return keys;
};

describe('voice recording journal', () => {
  it('appends chunks in seq order, whatever time reading one takes', async () => {
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
    const first = capture.append('rec-1', 0, { data: slow, elapsedMs: 1_000 });
    const second = capture.append('rec-1', 1, { data: blob('second'), elapsedMs: 2_000 });
    await vi.waitFor(() => expect(finishSlow).toBeDefined());
    finishSlow();
    expect(await Promise.all([begun, first, second])).toEqual([true, true, true]);

    tab.close();
    const next = await openTab();
    const [orphan, ...rest] = await next.journal.adoptVoiceOrphans(ALICE);
    expect(rest).toEqual([]);
    expect(await text(orphan!.file)).toBe('first second');
    expect(orphan!.file.type).toBe('audio/webm');
    expect(orphan!.duration).toBe(2_000);
    expect(orphan!.record).toMatchObject({ userId: ALICE, recordingId: 'rec-1', startedAt: 1_000 });
  });

  it('writes a chunk whose write failed again with the next one, in its place', async () => {
    const tab = await openTab();
    const capture = tab.journal.voiceCaptureJournal(() => ALICE);
    await capture.begin({ recordingId: 'rec-1', startedAt: 1_000, mimeType: 'audio/webm' });
    const chunk = (data: Blob, seq: number) =>
      capture.append('rec-1', seq, { data, elapsedMs: (seq + 1) * 1_000 });
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

  it('writes the audio it still owes with any later change, without a chunk to come', async () => {
    const tab = await openTab();
    const capture = tab.journal.voiceCaptureJournal(() => ALICE);
    await capture.begin({ recordingId: 'rec-1', startedAt: 1_000, mimeType: 'audio/webm' });
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('The disk is full.', 'QuotaExceededError');
    });
    expect(await capture.append('rec-1', 0, { data: blob('last'), elapsedMs: 1_000 })).toBe(false);
    expect(await tab.journal.transitionVoiceRecording('rec-1')).toBe('committed');

    tab.close();
    const [orphan] = await (await openTab()).journal.adoptVoiceOrphans(ALICE);
    expect(await text(orphan!.file)).toBe('last');
  });

  it('reads a chunk again that could not be read, and writes it in its place', async () => {
    const tab = await openTab();
    const capture = tab.journal.voiceCaptureJournal(() => ALICE);
    await capture.begin({ recordingId: 'rec-1', startedAt: 1_000, mimeType: 'audio/webm' });
    const flaky = blob('two ');
    const read = vi.spyOn(flaky, 'arrayBuffer').mockRejectedValueOnce(new Error('unreadable'));
    const chunk = (data: Blob, seq: number) =>
      capture.append('rec-1', seq, { data, elapsedMs: (seq + 1) * 1_000 });
    expect(await chunk(blob('one '), 0)).toBe(true);
    expect(await chunk(flaky, 1)).toBe(false);
    // The read that failed is made again: the disk holds everything once it works.
    expect(await chunk(blob('three'), 2)).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);

    tab.close();
    const [orphan] = await (await openTab()).journal.adoptVoiceOrphans(ALICE);
    expect(await text(orphan!.file)).toBe('one two three');
  });

  it('keeps what came before a chunk that cannot be read at all, and says so from then on', async () => {
    const tab = await openTab();
    const capture = tab.journal.voiceCaptureJournal(() => ALICE);
    await capture.begin({ recordingId: 'rec-1', startedAt: 1_000, mimeType: 'audio/webm' });
    const broken = blob('lost');
    broken.arrayBuffer = () => Promise.reject(new Error('unreadable'));
    const chunk = (data: Blob, seq: number) =>
      capture.append('rec-1', seq, { data, elapsedMs: (seq + 1) * 1_000 });
    expect(await chunk(blob('kept'), 0)).toBe(true);
    expect(await chunk(broken, 1)).toBe(false);
    expect(await chunk(blob('late'), 2)).toBe(false);
    // A change to a recording the disk holds does not count as made.
    expect(await tab.journal.transitionVoiceRecording('rec-1')).toBe('failed');

    tab.close();
    const [orphan] = await (await openTab()).journal.adoptVoiceOrphans(ALICE);
    expect(await text(orphan!.file)).toBe('kept');
    expect(orphan!.duration).toBe(1_000);
  });

  it('says a recording is absent that storage never took, and lets go of it once it ends', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const tab = await openTab();
    expect(await record(tab.journal, 'rec-1', ['a'])).toEqual([false, false]);
    // Nothing on disk to protect or to send twice: it goes on from memory.
    const txn = (entry: VoiceJournalRecord) => ({ ...entry, txnId: 'txn-1' });
    expect(await tab.journal.transitionVoiceRecording('rec-1', txn)).toBe('absent');
    expect(browser.held()).toEqual(['mindroom-voice-recording:rec-1']);
    expect(await tab.journal.transitionVoiceRecording('rec-1', gone)).toBe('absent');
    expect(browser.held()).toEqual([]);
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
    // Deleted by the tab that holds it, its lock is free again.
    const outcomes = await Promise.all([
      second.journal.transitionVoiceRecording('rec-orphan', gone),
      third.journal.transitionVoiceRecording('rec-orphan', gone),
    ]);
    expect(outcomes.sort()).toEqual(['absent', 'committed']);
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
        capture.append(recordingId, 0, { data: blob(recordingId), elapsedMs: 900 }),
      ]);
    };
    await start('rec-newer', 2_000);
    await start('rec-older', 1_000);
    crashed.close();
    const orphans = await (await openTab()).journal.adoptVoiceOrphans(ALICE);
    expect(orphans.map((orphan) => orphan.record.recordingId)).toEqual(['rec-older', 'rec-newer']);
  });

  it('without Web Locks keeps nothing, on disk or as a second copy in memory, and takes nothing over', async () => {
    const crashed = await openTab();
    await record(crashed.journal, 'rec-orphan', ['orphan']);
    crashed.close();

    const lockless = await openTab(false);
    // Nothing says whose a recording is: it lives in memory, and says it is not protected.
    const audio = blob('audio');
    const read = vi.spyOn(audio, 'arrayBuffer');
    const capture = lockless.journal.voiceCaptureJournal(() => ALICE);
    expect(
      await capture.begin({ recordingId: 'rec-1', startedAt: 1_000, mimeType: 'audio/webm' })
    ).toBe(false);
    expect(await capture.append('rec-1', 0, { data: audio, elapsedMs: 1_000 })).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(await lockless.journal.transitionVoiceRecording('rec-1')).toBe('absent');
    // What another browser version left stays where it is, for a page that can own it.
    expect(await lockless.journal.adoptVoiceOrphans(ALICE)).toEqual([]);
    expect(await journalKeys()).toEqual([['rec-orphan'], [['rec-orphan', 0]]]);
  });

  it('says what a change came to, and leaves the state before a change that failed', async () => {
    const tab = await openTab();
    await record(tab.journal, 'rec-1', ['audio']);
    const destination = {
      roomId: '!room:example.org',
      threadId: '$root',
      replyEventId: '$reply',
      threadingEnabled: true,
    };
    const txn = (txnId: string) => (entry: VoiceJournalRecord) => ({ ...entry, txnId });
    expect(
      await tab.journal.transitionVoiceRecording('rec-1', (entry) => ({
        ...entry,
        destination,
        txnId: 'txn-1',
      }))
    ).toBe('committed');
    // No such recording on disk.
    expect(await tab.journal.transitionVoiceRecording('rec-gone', txn('txn-2'))).toBe('absent');
    // Another tab's recording is not this one's to change.
    const other = await openTab();
    expect(await other.journal.transitionVoiceRecording('rec-1', txn('txn-3'))).toBe('absent');
    // A write the disk refused: none of it is made, the chunk that came with it neither.
    const put = IDBObjectStore.prototype.put;
    let puts = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function refuse(
      this: IDBObjectStore,
      ...args
    ) {
      puts += 1;
      if (puts === 2) throw new DOMException('The disk is full.', 'QuotaExceededError');
      return put.apply(this, args);
    });
    const capture = tab.journal.voiceCaptureJournal(() => ALICE);
    expect(await capture.append('rec-1', 1, { data: blob(' more'), elapsedMs: 2_000 })).toBe(false);
    // Nor is the change to its record, when the audio that goes with it is refused.
    puts = 0;
    expect(await tab.journal.transitionVoiceRecording('rec-1', txn('txn-4'))).toBe('failed');
    expect((await journalKeys())[1]).toEqual([['rec-1', 0]]);

    tab.close();
    const [orphan] = await (await openTab()).journal.adoptVoiceOrphans(ALICE);
    expect(orphan!.record).toMatchObject({ destination, txnId: 'txn-1' });
  });

  it('asks for every write to be on the disk before it counts', async () => {
    const tab = await openTab();
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');
    await record(tab.journal, 'rec-1', ['a']);
    await tab.journal.transitionVoiceRecording('rec-1', (entry) => ({ ...entry, txnId: 'txn-1' }));
    await tab.journal.transitionVoiceRecording('rec-1', gone);
    const writes = transaction.mock.calls.filter(([, mode]) => mode === 'readwrite');
    expect(writes.length).toBeGreaterThanOrEqual(3);
    writes.forEach(([, , options]) => expect(options).toEqual({ durability: 'strict' }));
  });

  it('opens the database again after the browser closed it', async () => {
    const terminate: (() => void)[] = [];
    const listen = IDBDatabase.prototype.addEventListener;
    vi.spyOn(IDBDatabase.prototype, 'addEventListener').mockImplementation(function spy(
      this: IDBDatabase,
      ...args
    ) {
      const [type, heard] = args;
      if (type === 'close') {
        terminate.push(() => {
          this.close();
          (heard as () => void)();
        });
      }
      return listen.apply(this, args);
    });
    const tab = await openTab();
    await record(tab.journal, 'rec-1', ['a']);
    expect(terminate).toHaveLength(1);
    terminate[0]!();
    // Not the closed connection again, on which every write would fail from here on.
    const next = tab.journal
      .voiceCaptureJournal(() => ALICE)
      .append('rec-1', 1, { data: blob('b'), elapsedMs: 2_000 });
    expect(await next).toBe(true);
    expect((await journalKeys())[1]).toEqual([
      ['rec-1', 0],
      ['rec-1', 1],
    ]);
  });

  it('deletes a recording that stopped without audio', async () => {
    const tab = await openTab();
    await record(tab.journal, 'rec-empty', []);
    await record(tab.journal, 'rec-full', ['audio']);
    tab.journal.voiceCaptureJournal(() => ALICE).abandon('rec-empty');
    await tab.journal.transitionVoiceRecording('rec-full');
    await vi.waitFor(async () => expect((await journalKeys())[0]).toEqual(['rec-full']));
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
    });
    tab.close();
    const [orphan] = await (await openTab()).journal.adoptVoiceOrphans(ALICE);
    expect(orphan!.file.type).toBe('audio/mp4');
    expect(orphan!.file.name).toMatch(/\.m4a$/);
  });

  describe('the copy an older version kept', () => {
    const legacyDraft = async (audio: string, userId: string) => ({
      userId,
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
    const putLegacy = async (audio: string, userId = ALICE) => {
      const legacy = await openLegacy();
      await legacy.put('drafts', await legacyDraft(audio, userId));
      legacy.close();
    };

    const legacyRows = async () => {
      const legacy = await openLegacy();
      const rows = await legacy.getAll('drafts');
      legacy.close();
      return rows;
    };
    /** Holds the next hash until the returned function is called, once it was asked for. */
    const holdNextDigest = async (work: () => void) => {
      let go: (() => void) | undefined;
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
        await new Promise<void>((resolve) => {
          go = resolve;
        });
        return digest(...args);
      });
      work();
      await vi.waitFor(() => expect(go).toBeDefined());
      return go!;
    };

    it('is moved once: copied under its account and audio, IDs only, and its old row deleted', async () => {
      await putLegacy('old voice bytes');
      const tab = await openTab();
      const [orphan, ...rest] = await tab.journal.adoptVoiceOrphans(ALICE);
      expect(rest).toEqual([]);
      const { recordingId } = orphan!.record;
      expect(recordingId).toMatch(/^legacy-@alice:example\.org-[0-9a-f]{64}$/);
      expect(await text(orphan!.file)).toBe('old voice bytes');
      expect(orphan!.file.type).toBe('audio/ogg');
      expect(orphan!.duration).toBe(4_200);
      expect(orphan!.record.userId).toBe(ALICE);
      expect(orphan!.record.txnId).toBeUndefined();
      expect(orphan!.record.destination).toEqual({
        roomId: '!room:example.org',
        threadId: '$thread',
        replyEventId: '$reply',
        replyThreadId: '$thread',
        threadingEnabled: true,
        threadView: true,
        encrypted: undefined,
      });
      // The quote of an encrypted room is on neither disk from here on.
      const db = await openDB('mindroom-voice-journal');
      expect(JSON.stringify(await db.getAll('recordings'))).not.toContain('secret');
      db.close();
      expect(await legacyRows()).toEqual([]);
      expect(await tab.journal.adoptVoiceOrphans(ALICE)).toEqual([]);
      expect((await journalKeys())[0]).toEqual([recordingId]);

      // Sent, or discarded: nothing brings it back.
      expect(await tab.journal.transitionVoiceRecording(recordingId, gone)).toBe('committed');
      expect(await tab.journal.adoptVoiceOrphans(ALICE)).toEqual([]);
      expect(await journalKeys()).toEqual([[], []]);
    });

    it('leaves the row an older version’s tab wrote meanwhile, and moves that one next', async () => {
      await putLegacy('AAA');
      const tab = await openTab();
      let adopting!: ReturnType<typeof tab.journal.adoptVoiceOrphans>;
      // This page has read the old row, and is hashing it.
      const go = await holdNextDigest(() => {
        adopting = tab.journal.adoptVoiceOrphans(ALICE);
      });
      // A tab of the older version saves another failed send over it: other audio, as long.
      await putLegacy('BBB');
      go();
      const [first, ...rest] = await adopting;
      expect(rest).toEqual([]);
      expect(await text(first!.file)).toBe('AAA');
      // Not deleted for the copy of the first: it is the only copy of the second.
      expect(await legacyRows()).toHaveLength(1);

      const [second, ...others] = await tab.journal.adoptVoiceOrphans(ALICE);
      expect(others).toEqual([]);
      expect(await text(second!.file)).toBe('BBB');
      expect(await legacyRows()).toEqual([]);
      expect((await journalKeys())[0]).toHaveLength(2);
    });

    it('keeps the copies of two accounts apart, also of the same audio', async () => {
      await putLegacy('same voice bytes');
      await putLegacy('same voice bytes', BOB);
      const tab = await openTab();
      const [hers] = await tab.journal.adoptVoiceOrphans(ALICE);
      const [his] = await tab.journal.adoptVoiceOrphans(BOB);
      expect(hers!.record.recordingId).not.toBe(his!.record.recordingId);
      expect([hers!.record.userId, his!.record.userId]).toEqual([ALICE, BOB]);
      // Hers is sent: his stays, his own.
      await tab.journal.transitionVoiceRecording(hers!.record.recordingId, (entry) => ({
        ...entry,
        txnId: 'txn-hers',
      }));
      await tab.journal.transitionVoiceRecording(hers!.record.recordingId, gone);
      const db = await openDB('mindroom-voice-journal');
      expect(await db.getAll('recordings')).toMatchObject([{ userId: BOB, txnId: undefined }]);
      db.close();
    });

    it('is copied once by two pages that read it at the same time', async () => {
      await putLegacy('old voice bytes');
      const slow = await openTab();
      let slowAdopts!: ReturnType<typeof slow.journal.adoptVoiceOrphans>;
      const go = await holdNextDigest(() => {
        slowAdopts = slow.journal.adoptVoiceOrphans(ALICE);
      });
      // Another page copies it, and the person sets it on its way there.
      const quick = await openTab();
      const [orphan] = await quick.journal.adoptVoiceOrphans(ALICE);
      await quick.journal.transitionVoiceRecording(orphan!.record.recordingId, (entry) => ({
        ...entry,
        txnId: 'txn-quick',
      }));
      go();
      // The first page finds the copy there: it neither takes it nor writes over it.
      expect(await slowAdopts).toEqual([]);
      const db = await openDB('mindroom-voice-journal');
      expect(await db.getAll('recordings')).toMatchObject([{ txnId: 'txn-quick' }]);
      db.close();
      expect(await legacyRows()).toEqual([]);
    });

    it('takes the transaction ID of the unsent message that is the same send, and has it forgotten once the copy is on disk', async () => {
      await putLegacy('old voice bytes');
      const tab = await openTab();
      const forget = vi.fn();
      const unsentCopy = vi.fn(() => ({ txnId: 'txn-old-retry', forget }));

      // The copy cannot be written: the unsent message stays, it is the one with the ID.
      const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
        throw new DOMException('The write failed.', 'UnknownError');
      });
      expect(await tab.journal.adoptVoiceOrphans(ALICE, unsentCopy)).toEqual([]);
      expect(forget).not.toHaveBeenCalled();
      expect(await legacyRows()).toHaveLength(1);
      put.mockRestore();

      const [orphan] = await tab.journal.adoptVoiceOrphans(ALICE, unsentCopy);
      expect(unsentCopy).toHaveBeenLastCalledWith('!room:example.org', 'old voice bytes'.length);
      // Sent again, it is the event that retry may have posted: not encrypted, as only such a
      // message was kept among the unsent ones.
      expect(orphan!.record).toMatchObject({
        txnId: 'txn-old-retry',
        destination: { roomId: '!room:example.org', encrypted: false },
      });
      expect(forget).toHaveBeenCalledTimes(1);
    });

    it('keeps one copy while its old row cannot be deleted, and deletes the row the next time', async () => {
      await putLegacy('old voice bytes');
      const tab = await openTab();
      const remove = IDBObjectStore.prototype.delete;
      vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementationOnce(function old(
        this: IDBObjectStore,
        ...args
      ) {
        if (this.name !== 'drafts') return remove.apply(this, args);
        throw new DOMException('The delete failed.', 'UnknownError');
      });
      const [orphan] = await tab.journal.adoptVoiceOrphans(ALICE);
      expect(await text(orphan!.file)).toBe('old voice bytes');
      expect(await legacyRows()).toHaveLength(1);

      expect(await tab.journal.adoptVoiceOrphans(ALICE)).toEqual([]);
      expect(await legacyRows()).toEqual([]);
      expect((await journalKeys())[0]).toEqual([orphan!.record.recordingId]);
    });

    it('is tried again by the next call when it could not be read', async () => {
      await putLegacy('old voice bytes');
      const tab = await openTab();
      vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(() => {
        throw new DOMException('The read failed.', 'UnknownError');
      });
      expect(await tab.journal.adoptVoiceOrphans(ALICE)).toEqual([]);
      const [orphan] = await tab.journal.adoptVoiceOrphans(ALICE);
      expect(await text(orphan!.file)).toBe('old voice bytes');
    });
  });

  it("forgets an account's recordings on sign-out, the one an older version kept too", async () => {
    const legacy = await openDB('mindroom-voice-drafts', 1, {
      upgrade: (db) => void db.createObjectStore('drafts', { keyPath: 'userId' }),
    });
    await legacy.put('drafts', { userId: ALICE, audio: new ArrayBuffer(3) });
    const tab = await openTab();
    await record(tab.journal, 'rec-alice', ['a']);
    await record(tab.journal, 'rec-bob', ['b'], BOB);
    await tab.journal.clearVoiceRecordings(ALICE);
    expect(await journalKeys()).toEqual([['rec-bob'], [['rec-bob', 0]]]);
    expect(browser.held()).toEqual(['mindroom-voice-recording:rec-bob']);
    expect(await legacy.getAllKeys('drafts')).toEqual([]);
    legacy.close();
  });
});
