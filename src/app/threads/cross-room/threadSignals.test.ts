import {
  ClientEvent,
  createClient,
  MatrixEvent,
  ReceiptType,
  RelationType,
  Room,
} from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isEventStreaming } from '../../event-store/threads/useThreadStreamingState';
import { keepSyncedEdits } from '../../matrix/client/syncedEdits';
import { isAiRunStreaming } from '../../matrix/protocol/aiRun';
import { getEditedEvent, getLatestMessageContent } from '../../matrix/room';
import type { RegisteredPlugin } from '../../plugins/registry';
import {
  FINISHED_AFTER_MS,
  QUESTION_WAITS_MS,
  readThreadSignals,
  threadRootPluginEvent,
} from './threadSignals';
import type { CrossRoomThreadIndexEntry } from './crossRoomThreadIndex';

// A build with a plugin whose renderer previews messages; a case may take it out.
const plugins = vi.hoisted(() => [] as RegisteredPlugin[]);
const previewPlugin = {
  id: 'cards',
  tag: 'cards@1.0.0',
  defaultEnabled: true,
  messageRenderers: [{ match: () => true, Component: () => null, preview: () => 'Card' }],
} as unknown as RegisteredPlugin;
plugins.push(previewPlugin);
vi.mock('../../plugins/registry', () => ({ registeredPlugins: plugins }));

const ROOM_ID = '!signals:example.org';
const ME = '@alice:example.org';
const BOB = '@bob:example.org';
const AGENT = '@mindroom_code:example.org';
const ROOT = '$root';
const NOW = 10_000_000;

type EventSpec = {
  id: string;
  ts: number;
  sender?: string;
  type?: string;
  content?: Record<string, unknown>;
};

const event = ({ id, ts, sender = BOB, type = 'm.room.message', content }: EventSpec) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender,
    type,
    origin_server_ts: ts,
    content: {
      ...(type === 'm.room.message' ? { msgtype: 'm.text', body: id } : {}),
      ...content,
      ...(id === ROOT ? {} : { 'm.relates_to': { rel_type: RelationType.Thread, event_id: ROOT } }),
    },
  });

const approval = (id: string, ts: number, approver: string | null, status = 'pending') =>
  event({
    id,
    ts,
    sender: AGENT,
    type: 'io.mindroom.tool_approval',
    content: {
      tool_name: 'run_shell_command',
      arguments: { command: 'npm run deploy:staging' },
      agent_name: 'code',
      requester_id: ME,
      approver_user_id: approver,
      approvable: true,
      status,
      approval_id: `approval-${id}`,
      requested_at: '2026-11-09T10:00:00Z',
      expires_at: '2099-01-01T00:00:00Z',
      thread_id: ROOT,
    },
  });

const question = (id: string, ts: number) =>
  event({
    id,
    ts,
    sender: AGENT,
    content: {
      body: 'Which deck should I polish?',
      'io.mindroom.interactive': {
        creator_agent: 'code',
        question_text: 'Which deck should I polish?',
        options: { '✅': 'v3', '📄': 'v4', '1': 'v3', '2': 'v4' },
        option_labels: { '✅': 'v3 final', '📄': 'v4 draft', '1': 'v3 final', '2': 'v4 draft' },
        source_event_id: '$source',
      },
    },
  });

const readUpTo = (room: Room, eventId: string, ts: number) =>
  room.addReceipt(
    new MatrixEvent({
      type: 'm.receipt',
      room_id: ROOM_ID,
      content: { [eventId]: { [ReceiptType.Read]: { [ME]: { thread_id: ROOT, ts } } } },
    })
  );

const setup = async (
  rootSender: string,
  replies: MatrixEvent[],
  { opened = false, rootContent = {} } = {}
) => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: ME });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  vi.spyOn(mx.http, 'authedRequest').mockResolvedValue({ chunk: [] });
  const room = new Room(ROOM_ID, mx, ME);
  mx.store.storeRoom(room);
  const root = event({ id: ROOT, ts: 1000, sender: rootSender, content: rootContent });
  room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false });
  const thread = room.createThread(ROOT, root, [], false);
  // An opened thread has run its first page load; its live timeline then holds edits too.
  if (opened) await thread.initialize();
  thread.addEvents(replies, false);
  await vi.waitFor(() => expect(thread.events.length).toBeGreaterThanOrEqual(replies.length));
  return { mx, room, thread };
};

describe('readThreadSignals', () => {
  let previousThreadSupport: FeatureSupport;

  beforeEach(() => {
    previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
  });

  afterEach(() => {
    Thread.hasServerSideSupport = previousThreadSupport;
    vi.restoreAllMocks();
  });

  it('counts replies from others after the read receipt and previews the newest', async () => {
    const { room } = await setup(ME, [
      event({ id: '$old', ts: 2000 }),
      event({ id: '$new', ts: 3000, content: { body: 'Leave at  7:45\nAM' } }),
    ]);
    readUpTo(room, '$old', 2000);

    const signals = readThreadSignals(room, ROOT, ME, NOW);

    expect(signals.newCount).toBe(1);
    expect(signals.newSenderIds).toEqual([BOB]);
    expect(signals.lastReply).toMatchObject({
      eventId: '$new',
      senderId: BOB,
      preview: { kind: 'text', text: 'Leave at 7:45 AM' },
    });
  });

  it('never counts title notices, agent notices, undecryptable or redacted events', async () => {
    const redacted = event({ id: '$gone', ts: 3500 });
    redacted.setUnsigned({ redacted_because: { type: 'm.room.redaction' } as never });
    const { room } = await setup(ME, [
      event({ id: '$reply', ts: 2000 }),
      event({
        id: '$title',
        ts: 3000,
        sender: AGENT,
        content: {
          msgtype: 'm.notice',
          'io.mindroom.thread_summary': { version: 1, summary: '🛫 Plan', generated_at: 'x' },
        },
      }),
      event({
        id: '$skill',
        ts: 3100,
        sender: AGENT,
        content: { msgtype: 'm.notice', body: '💾 Skill review: updated `x`' },
      }),
      event({ id: '$secret', ts: 3200, type: 'm.room.encrypted', content: { algorithm: 'x' } }),
      redacted,
    ]);
    readUpTo(room, '$reply', 2000);

    const signals = readThreadSignals(room, ROOT, ME, NOW);

    expect(signals.newCount).toBe(0);
    expect(signals.lastReply?.eventId).toBe('$reply');
    // A title or notice after the last reply is no news either.
    expect(signals.newsTs).toBe(2000);
  });

  it("keeps other people's newest message apart from agents' and the reader's own", async () => {
    const { room } = await setup(ME, [
      event({ id: '$person', ts: 1000, sender: '@other:example.org', content: { body: 'hi' } }),
      event({ id: '$agent', ts: 2000, sender: AGENT, content: { body: 'Snoozed it.' } }),
    ]);
    expect(readThreadSignals(room, ROOT, ME, NOW)).toMatchObject({
      newsTs: 2000,
      personNewsTs: 1000,
    });
    // The reader's own message is not news from people: a note to self keeps a snooze.
    const { room: own } = await setup(ME, [
      event({ id: '$mine', ts: 3000, sender: ME, content: { body: 'note to self' } }),
    ]);
    expect(readThreadSignals(own, ROOT, ME, NOW).personNewsTs).toBeUndefined();
  });

  it("keeps lastOtherReply and otherNewsTs apart from the reader's own replies", async () => {
    const { room } = await setup(ME, [
      event({ id: '$bob', ts: 2000, sender: BOB, content: { body: 'bob reply' } }),
      event({ id: '$mine', ts: 3000, sender: ME, content: { body: 'my reply' } }),
    ]);
    const signals = readThreadSignals(room, ROOT, ME, NOW);
    expect(signals.lastReply).toMatchObject({
      eventId: '$mine',
      senderId: ME,
      ts: 3000,
      preview: { kind: 'text', text: 'my reply' },
    });
    expect(signals.lastOtherReply).toMatchObject({
      eventId: '$bob',
      senderId: BOB,
      ts: 2000,
      preview: { kind: 'text', text: 'bob reply' },
    });
    expect(signals.newsTs).toBe(3000);
    expect(signals.otherNewsTs).toBe(2000);

    const { room: onlyMe } = await setup(ME, [
      event({ id: '$mine', ts: 3000, sender: ME, content: { body: 'only mine' } }),
    ]);
    const ownSignals = readThreadSignals(onlyMe, ROOT, ME, NOW);
    expect(ownSignals.lastReply).toMatchObject({ eventId: '$mine', senderId: ME, ts: 3000 });
    expect(ownSignals.lastOtherReply).toBeUndefined();
    expect(ownSignals.newsTs).toBe(3000);
    expect(ownSignals.otherNewsTs).toBeUndefined();

    const { room: withApproval } = await setup(ME, [
      event({ id: '$mine', ts: 3000, sender: ME, content: { body: 'run it' } }),
      approval('$ask', 4000, null),
    ]);
    const approvalSignals = readThreadSignals(withApproval, ROOT, ME, NOW);
    expect(approvalSignals.lastReply?.eventId).toBe('$mine');
    expect(approvalSignals.lastOtherReply).toBeUndefined();
    expect(approvalSignals.otherNewsTs).toBe(4000);
    expect(approvalSignals.newsTs).toBe(4000);
  });

  it('previews an agent reply by its words, its tool calls counted, not written out', async () => {
    const body = '🔧 `job` [1]\n🔧 `read_file` [2]\nHere is the **reply** to the licensor.';
    const { room } = await setup(ME, [
      event({ id: '$r', ts: 2000, sender: AGENT, content: { body } }),
    ]);

    expect(readThreadSignals(room, ROOT, ME, NOW).lastReply?.preview).toEqual({
      kind: 'text',
      text: expect.stringContaining('Here is the reply to the licensor.'),
      localization: { kind: 'tools', count: 2, prose: 'Here is the reply to the licensor.' },
    });
  });

  it('previews voice, image and file messages by their kind', async () => {
    const { room } = await setup(ME, [
      event({
        id: '$voice',
        ts: 2000,
        content: {
          msgtype: 'm.audio',
          body: 'voice-message-2026.m4a',
          'org.matrix.msc3245.voice': {},
        },
      }),
    ]);
    expect(readThreadSignals(room, ROOT, ME, NOW).lastReply?.preview).toEqual({ kind: 'voice' });

    const { room: other } = await setup(ME, [
      event({ id: '$pic', ts: 2000, content: { msgtype: 'm.image', body: 'IMG_1.png' } }),
      event({ id: '$doc', ts: 2100, content: { msgtype: 'm.file', body: 'deck.pdf' } }),
    ]);
    expect(readThreadSignals(other, ROOT, ME, NOW).lastReply?.preview).toEqual({ kind: 'file' });
  });

  it('finds a pending approval the user may answer, not one for someone else', async () => {
    const { room } = await setup(ME, [approval('$ask', 2000, null)]);
    expect(readThreadSignals(room, ROOT, ME, NOW)).toMatchObject({
      pendingApproval: { eventId: '$ask' },
      waitsUntil: Date.parse('2099-01-01T00:00:00Z'),
      newsTs: 2000,
    });

    const { room: theirs } = await setup(ME, [approval('$ask', 2000, '@other:example.org')]);
    expect(readThreadSignals(theirs, ROOT, ME, NOW).pendingApproval).toBeUndefined();

    const { room: done } = await setup(ME, [approval('$ask', 2000, null, 'approved')]);
    expect(readThreadSignals(done, ROOT, ME, NOW).pendingApproval).toBeUndefined();
  });

  it('finds an unanswered agent question with its emoji options', async () => {
    const { room } = await setup(ME, [question('$q', 2000)]);

    expect(readThreadSignals(room, ROOT, ME, NOW).pendingQuestion).toEqual({
      eventId: '$q',
      senderId: AGENT,
      text: 'Which deck should I polish?',
      options: [
        { key: '✅', label: 'v3 final' },
        { key: '📄', label: 'v4 draft' },
      ],
    });
  });

  it('stops waiting on a question nobody answered once it is a week old', async () => {
    const { room } = await setup(ME, [question('$q', 2000)]);
    expect(readThreadSignals(room, ROOT, ME, NOW)).toMatchObject({
      pendingQuestion: { eventId: '$q' },
      waitsUntil: 2000 + QUESTION_WAITS_MS,
    });
    expect(
      readThreadSignals(room, ROOT, ME, 2000 + QUESTION_WAITS_MS - 1).pendingQuestion
    ).toMatchObject({ eventId: '$q' });
    // It lapses at waitsUntil itself, when a view's timer reads it again, as an approval does.
    expect(
      readThreadSignals(room, ROOT, ME, 2000 + QUESTION_WAITS_MS).pendingQuestion
    ).toBeUndefined();
  });

  it('leaves a question the agent put to someone else', async () => {
    const { 'io.mindroom.interactive': prompt } = question('$q', 2000).getContent();
    const asks = (id: string, source: string) =>
      event({
        id,
        ts: 2000,
        sender: AGENT,
        content: {
          body: 'Which deck should I polish?',
          'io.mindroom.interactive': { ...(prompt as object), source_event_id: source },
        },
      });
    const { room: bobs } = await setup(ME, [event({ id: '$bob', ts: 1500 }), asks('$q', '$bob')]);
    expect(readThreadSignals(bobs, ROOT, ME, NOW).pendingQuestion).toBeUndefined();

    // The first turn of Bob's thread answers its root, which the thread's events need not hold.
    const { room: bobsRoot } = await setup(BOB, [asks('$q', ROOT)]);
    expect(readThreadSignals(bobsRoot, ROOT, ME, NOW).pendingQuestion).toBeUndefined();

    // The router relays the user's message; the agent answers the relay.
    const relay = event({
      id: '$relay',
      ts: 1500,
      sender: '@mindroom_router:example.org',
      content: { 'com.mindroom.original_sender': ME },
    });
    const { room: mine } = await setup(ME, [relay, asks('$q', '$relay')]);
    expect(readThreadSignals(mine, ROOT, ME, NOW).pendingQuestion?.eventId).toBe('$q');
  });

  it("drops a question someone else answered, and keeps one with only the agent's own options", async () => {
    const react = (sender: string, key: string) =>
      new MatrixEvent({
        event_id: `$react-${sender}`,
        room_id: ROOM_ID,
        sender,
        type: 'm.reaction',
        origin_server_ts: 2500,
        content: { 'm.relates_to': { rel_type: RelationType.Annotation, event_id: '$q', key } },
      });
    const { room } = await setup(ME, [question('$q', 2000)]);
    room.getUnfilteredTimelineSet().relations.aggregateChildEvent(react(AGENT, '✅'));
    expect(readThreadSignals(room, ROOT, ME, NOW).pendingQuestion?.eventId).toBe('$q');
    room.getUnfilteredTimelineSet().relations.aggregateChildEvent(react(BOB, '✅'));
    expect(readThreadSignals(room, ROOT, ME, NOW).pendingQuestion).toBeUndefined();
  });

  it('drops a question the user answered by reaction or by writing', async () => {
    const { room } = await setup(ME, [question('$q', 2000)]);
    room.getUnfilteredTimelineSet().relations.aggregateChildEvent(
      new MatrixEvent({
        event_id: '$react',
        room_id: ROOM_ID,
        sender: ME,
        type: 'm.reaction',
        origin_server_ts: 2500,
        content: {
          'm.relates_to': { rel_type: RelationType.Annotation, event_id: '$q', key: '✅' },
        },
      })
    );
    expect(readThreadSignals(room, ROOT, ME, NOW).pendingQuestion).toBeUndefined();

    const { room: written } = await setup(ME, [
      question('$q', 2000),
      event({ id: '$mine', ts: 2600, sender: ME }),
    ]);
    expect(readThreadSignals(written, ROOT, ME, NOW).pendingQuestion).toBeUndefined();
  });

  it('drops a question when someone else writes a newer message', async () => {
    const { room } = await setup(ME, [
      question('$q', 2000),
      event({ id: '$bob', ts: 2600, sender: BOB }),
    ]);
    expect(readThreadSignals(room, ROOT, ME, NOW).pendingQuestion).toBeUndefined();
  });

  it('keeps an agent question pending after notices and a router relay', async () => {
    const { room } = await setup(ME, [
      question('$q', 2000),
      event({
        id: '$skill',
        ts: 2500,
        sender: AGENT,
        content: { msgtype: 'm.notice', body: 'Skill review: updated an example skill' },
      }),
      event({
        id: '$relay',
        ts: 2600,
        sender: '@mindroom_router:example.org',
        content: { body: 'Review the sample deck', 'com.mindroom.original_sender': ME },
      }),
      event({
        id: '$summary',
        ts: 2700,
        sender: AGENT,
        content: {
          msgtype: 'm.notice',
          body: 'Deck notes',
          'io.mindroom.thread_summary': { version: 1, summary: 'Deck notes', generated_at: 'x' },
        },
      }),
    ]);
    expect(readThreadSignals(room, ROOT, ME, NOW).pendingQuestion?.eventId).toBe('$q');
  });

  it('notices an unread reply that mentions the user', async () => {
    const { room } = await setup(BOB, [
      event({ id: '$hi', ts: 2000, content: { 'm.mentions': { user_ids: [ME] } } }),
    ]);
    expect(readThreadSignals(room, ROOT, ME, NOW)).toMatchObject({
      mentionedMe: true,
      mentionedBy: BOB,
    });
    readUpTo(room, '$hi', 2000);
    expect(readThreadSignals(room, ROOT, ME, NOW).mentionedMe).toBe(false);
  });

  it('takes a root that names the user for read once the main timeline was read past it', async () => {
    const mentionsMe = { 'm.mentions': { user_ids: [ME] } };
    const { room } = await setup(BOB, [event({ id: '$r', ts: 2000 })], {
      rootContent: mentionsMe,
    });
    expect(readThreadSignals(room, ROOT, ME, NOW).mentionedMe).toBe(true);

    // Read in the main timeline: the root is read, the reply after it is not.
    room.addReceipt(
      new MatrixEvent({
        type: 'm.receipt',
        room_id: ROOM_ID,
        content: { [ROOT]: { [ReceiptType.Read]: { [ME]: { thread_id: 'main', ts: 1500 } } } },
      })
    );
    const signals = readThreadSignals(room, ROOT, ME, NOW);
    expect(signals.mentionedMe).toBe(false);
    expect(signals.newCount).toBe(1);
  });

  it('reports a stopped run, and a run that finished after a long time', async () => {
    const stopped = event({
      id: '$stop',
      ts: 2000,
      sender: AGENT,
      content: { 'io.mindroom.ai_run': { version: 1, status: 'cancelled' } },
    });
    const { room } = await setup(ME, [stopped]);
    expect(readThreadSignals(room, ROOT, ME, NOW).outcome?.kind).toBe('stopped');

    const long = event({ id: '$long', ts: 2000, sender: AGENT });
    long.makeReplaced(
      event({
        id: '$long-edit',
        ts: 2000 + FINISHED_AFTER_MS + 30_000,
        sender: AGENT,
        content: {
          'm.new_content': {
            msgtype: 'm.text',
            body: 'Done',
            'io.mindroom.ai_run': { version: 1, status: 'completed', tools: { count: 3 } },
          },
        },
      })
    );
    const { room: finished } = await setup(ME, [long]);
    expect(readThreadSignals(finished, ROOT, ME, NOW).outcome).toMatchObject({
      kind: 'finished',
      durationMs: FINISHED_AFTER_MS + 30_000,
      toolCount: 3,
    });

    const quick = event({ id: '$quick', ts: 2000, sender: AGENT });
    quick.makeReplaced(
      event({
        id: '$quick-edit',
        ts: 12_000,
        sender: AGENT,
        content: {
          'm.new_content': {
            msgtype: 'm.text',
            body: 'Done',
            'io.mindroom.ai_run': { version: 1, status: 'completed' },
          },
        },
      })
    );
    const { room: fast } = await setup(ME, [quick]);
    expect(readThreadSignals(fast, ROOT, ME, NOW).outcome).toBeUndefined();
  });

  it('reads terminal stream_status outcomes even when early or non-terminal ai_run is present', async () => {
    const earlyRun = {
      version: 1,
      model: {
        config: 'gemini4_neon',
        display_name: 'Gemini 4 Neon',
        id: 'google/gemini-4-neon',
        provider: 'openrouter',
      },
    };

    const stoppedStatusless = event({
      id: '$stop-statusless',
      ts: 2000,
      sender: AGENT,
      content: {
        'io.mindroom.ai_run': earlyRun,
        'io.mindroom.stream_status': 'cancelled',
      },
    });
    const { room: r1 } = await setup(ME, [stoppedStatusless]);
    expect(readThreadSignals(r1, ROOT, ME, NOW).outcome?.kind).toBe('stopped');

    const stoppedWithStreamingRun = event({
      id: '$stop-streaming-run',
      ts: 2000,
      sender: AGENT,
      content: {
        'io.mindroom.ai_run': { ...earlyRun, status: 'streaming' },
        'io.mindroom.stream_status': 'error',
      },
    });
    const { room: r2 } = await setup(ME, [stoppedWithStreamingRun]);
    expect(readThreadSignals(r2, ROOT, ME, NOW).outcome?.kind).toBe('stopped');

    const finishedWithPendingRun = event({ id: '$finish-pending-run', ts: 2000, sender: AGENT });
    finishedWithPendingRun.makeReplaced(
      event({
        id: '$finish-pending-run-edit',
        ts: 2000 + FINISHED_AFTER_MS + 10_000,
        sender: AGENT,
        content: {
          'm.new_content': {
            msgtype: 'm.text',
            body: 'Done',
            'io.mindroom.ai_run': { ...earlyRun, status: 'pending' },
            'io.mindroom.stream_status': 'completed',
          },
        },
      })
    );
    const { room: r3 } = await setup(ME, [finishedWithPendingRun]);
    expect(readThreadSignals(r3, ROOT, ME, NOW).outcome).toMatchObject({
      kind: 'finished',
      durationMs: FINISHED_AFTER_MS + 10_000,
    });

    const stoppedRecordStatus = event({
      id: '$stop-record-status',
      ts: 2000,
      sender: AGENT,
      content: {
        'io.mindroom.ai_run': { ...earlyRun, status: 'streaming' },
        'io.mindroom.stream_status': { status: 'cancelled' },
      },
    });
    const { room: r4 } = await setup(ME, [stoppedRecordStatus]);
    expect(readThreadSignals(r4, ROOT, ME, NOW).outcome?.kind).toBe('stopped');
  });

  // A correction of the text long after a run shows the finished status of an older edit, and
  // remembers when that edit was sent (`STREAM_STATUS_TS_KEY`): the run ended then.
  describe('a finished reply whose text is corrected later', () => {
    /** The outcome of a reply sent at 2000, finished at `finishTs` and corrected at `correctionTs`. */
    const outcomeOf = async (finishTs: number, correctionTs: number) => {
      const reply = event({ id: '$corrected-reply', ts: 2000, sender: AGENT });
      const makeReplace = (id: string, ts: number, newContent: Record<string, unknown>) =>
        new MatrixEvent({
          event_id: id,
          room_id: ROOM_ID,
          sender: AGENT,
          type: 'm.room.message',
          origin_server_ts: ts,
          content: {
            msgtype: 'm.text',
            body: `* ${id}`,
            'm.new_content': { msgtype: 'm.text', body: id, ...newContent },
            'm.relates_to': { rel_type: RelationType.Replace, event_id: '$corrected-reply' },
          },
        });
      // The run states no status of its own, so the borrowed stream status gives the outcome.
      const progressEdit = makeReplace('$progress', 4000, {
        'io.mindroom.stream_status': 'streaming',
        'io.mindroom.ai_run': { version: 1, model: { display_name: 'Model' } },
      });
      const completedEdit = makeReplace('$completed', finishTs, {
        'io.mindroom.stream_status': 'completed',
      });
      const textOnlyEdit = makeReplace('$typo-fix', correctionTs, { body: 'Fixed a typo.' });

      const { room, thread } = await setup(ME, [reply], { opened: true });
      [progressEdit, completedEdit, textOnlyEdit].forEach((edit) => {
        thread.timelineSet.addLiveEvent(edit, { addToState: false });
      });
      reply.makeReplaced(textOnlyEdit);
      return readThreadSignals(room, ROOT, ME, NOW).outcome;
    };

    it('uses the borrowed stream finish timestamp so a later text-only edit does not inflate a short run', async () => {
      expect(await outcomeOf(12_000, 2000 + 2 * FINISHED_AFTER_MS)).toBeUndefined();
    });

    it('finished a long run when its finishing edit was sent, not when its text was corrected', async () => {
      const finishTs = 2000 + FINISHED_AFTER_MS + 10_000;
      expect(await outcomeOf(finishTs, finishTs + 10 * FINISHED_AFTER_MS)).toEqual({
        kind: 'finished',
        senderId: AGENT,
        ts: finishTs,
        durationMs: FINISHED_AFTER_MS + 10_000,
      });
    });
  });

  // The shown edit of a reply borrows the stream status it lacks from an older edit. What reads
  // the reply must agree on what the borrowed status means: the thread's spinner
  // (`isEventStreaming`), the reply's own indicator (`isAiRunStreaming`) and the card's outcome.
  describe('a reply whose shown edit borrows from its older edits', () => {
    const earlyRun = { 'io.mindroom.ai_run': { version: 1, model: { config: 'gemini4_neon' } } };
    const streamingRun = { 'io.mindroom.ai_run': { version: 1, status: 'streaming' } };
    const streamStatus = (status: string) => ({ 'io.mindroom.stream_status': status });

    /** How a reply reads whose opened thread holds edits of these new contents, a minute apart. */
    const read = async (...newContents: Record<string, unknown>[]) => {
      const reply = event({ id: '$reply', ts: 2000, sender: AGENT });
      const { room, thread } = await setup(ME, [reply], { opened: true });
      const edits = newContents.map(
        (newContent, index) =>
          new MatrixEvent({
            event_id: `$edit-${index}`,
            room_id: ROOM_ID,
            sender: AGENT,
            type: 'm.room.message',
            origin_server_ts: 2000 + (index + 1) * FINISHED_AFTER_MS,
            content: {
              msgtype: 'm.text',
              body: `* edit ${index}`,
              'm.new_content': { msgtype: 'm.text', body: `edit ${index}`, ...newContent },
              'm.relates_to': { rel_type: RelationType.Replace, event_id: '$reply' },
            },
          })
      );
      edits.forEach((edit) => thread.timelineSet.addLiveEvent(edit, { addToState: false }));
      reply.makeReplaced(edits.at(-1));
      const shown = getEditedEvent('$reply', reply, thread.timelineSet);
      return {
        spinner: isEventStreaming(reply, undefined, thread.timelineSet),
        indicator: isAiRunStreaming(getLatestMessageContent(reply, shown)),
        outcome: readThreadSignals(room, ROOT, ME, NOW).outcome?.kind,
      };
    };
    const streams = { spinner: true, indicator: true, outcome: undefined };
    const rests = (outcome?: 'finished' | 'stopped') => ({
      spinner: false,
      indicator: false,
      outcome,
    });

    it.each(['cancelled', 'completed', 'approval_pending'])(
      'streams by the run status of a retry after a %s edit',
      async (status) => {
        expect(await read(streamStatus(status), streamingRun)).toEqual(streams);
      }
    );

    it('is stopped by a stop note that borrows the streaming run of the edit before it', async () => {
      expect(await read(streamingRun, streamStatus('cancelled'))).toEqual(rests('stopped'));
    });

    it.each([
      ['approval_pending', undefined],
      ['cancelled', 'stopped'],
      ['completed', 'finished'],
    ] as const)(
      'reads %s beside an early run the same in the edit itself and borrowed by a correction',
      async (status, outcome) => {
        const own = { ...earlyRun, ...streamStatus(status) };
        expect(await read(own)).toEqual(rests(outcome));
        expect(await read(own, { body: 'Corrected text' })).toEqual(rests(outcome));
      }
    );
  });

  it('calls an agent thread nobody wrote in an automation', async () => {
    const { room } = await setup(AGENT, [event({ id: '$digest', ts: 2000, sender: AGENT })]);
    expect(readThreadSignals(room, ROOT, ME, NOW).automation).toBe(true);

    const { room: joined } = await setup(AGENT, [event({ id: '$me', ts: 2000, sender: ME })]);
    expect(readThreadSignals(joined, ROOT, ME, NOW).automation).toBe(false);
  });
});

describe('readThreadSignals in a loaded thread with edits', () => {
  let previousThreadSupport: FeatureSupport;

  beforeEach(() => {
    previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
  });

  afterEach(() => {
    Thread.hasServerSideSupport = previousThreadSupport;
    vi.restoreAllMocks();
  });

  /** A MindRoom edit: the whole new content at the top level and in m.new_content. */
  const edit = (
    id: string,
    targetId: string,
    ts: number,
    content: Record<string, unknown>,
    sender = AGENT
  ) =>
    new MatrixEvent({
      event_id: id,
      room_id: ROOM_ID,
      sender,
      type: 'm.room.message',
      origin_server_ts: ts,
      content: {
        msgtype: 'm.text',
        body: `* ${String(content.body ?? '')}`,
        ...content,
        'm.new_content': { msgtype: 'm.text', ...content },
        'm.relates_to': { rel_type: RelationType.Replace, event_id: targetId },
      },
    });

  it('counts a streamed reply once, by its last edit, and sees how its run ended', async () => {
    const reply = event({ id: '$r', ts: 2000, sender: AGENT, content: { body: 'Thinking...' } });
    const { room } = await setup(
      ME,
      [
        reply,
        edit('$r1', '$r', 2500, { body: 'Half', 'io.mindroom.stream_status': 'streaming' }),
        edit('$r2', '$r', 2000 + FINISHED_AFTER_MS + 60_000, {
          body: 'Leave at 7:45 AM.',
          'io.mindroom.ai_run': { version: 1, status: 'completed' },
        }),
      ],
      { opened: true }
    );

    const signals = readThreadSignals(room, ROOT, ME, NOW);

    expect(signals.newCount).toBe(1);
    expect(signals.lastReply).toMatchObject({
      eventId: '$r',
      preview: { kind: 'text', text: 'Leave at 7:45 AM.' },
    });
    expect(signals.outcome).toMatchObject({
      kind: 'finished',
      durationMs: FINISHED_AFTER_MS + 60_000,
    });
    expect(signals.newsTs).toBe(2000 + FINISHED_AFTER_MS + 60_000);
    expect(signals.otherNewsTs).toBe(2000 + FINISHED_AFTER_MS + 60_000);
  });

  it('keeps otherNewsTs at send time while a reply is streaming, then moves to the finishing edit', async () => {
    const reply = event({ id: '$r', ts: 2000, sender: AGENT, content: { body: 'Thinking...' } });
    const { room, thread } = await setup(
      ME,
      [reply, edit('$r1', '$r', 5000, { body: 'Half', 'io.mindroom.stream_status': 'streaming' })],
      { opened: true }
    );

    expect(readThreadSignals(room, ROOT, ME, NOW).otherNewsTs).toBe(2000);

    thread.addEvents(
      [
        edit('$r2', '$r', 8000, {
          body: 'Done.',
          'io.mindroom.stream_status': 'completed',
        }),
      ],
      false
    );
    await vi.waitFor(() => expect(readThreadSignals(room, ROOT, ME, NOW).otherNewsTs).toBe(8000));
  });

  it('does not bump otherNewsTs when the reader edits their own reply', async () => {
    const { room } = await setup(
      ME,
      [
        event({ id: '$bob', ts: 2000, sender: BOB, content: { body: 'bob reply' } }),
        event({ id: '$mine', ts: 3000, sender: ME, content: { body: 'my reply' } }),
        edit('$mine-edit', '$mine', 4000, { body: 'my edited reply' }, ME),
      ],
      { opened: true }
    );

    const signals = readThreadSignals(room, ROOT, ME, NOW);

    expect(signals.lastReply).toMatchObject({
      eventId: '$mine',
      senderId: ME,
      ts: 3000,
      preview: { kind: 'text', text: 'my edited reply' },
    });
    expect(signals.lastOtherReply).toMatchObject({
      eventId: '$bob',
      senderId: BOB,
      ts: 2000,
      preview: { kind: 'text', text: 'bob reply' },
    });
    expect(signals.newsTs).toBe(4000);
    expect(signals.otherNewsTs).toBe(2000);
  });

  it('previews long-text m.file replies as text while keeping regular files as file', async () => {
    const longTextMeta = { version: 2, encoding: 'matrix_event_content_json' };
    const { room: direct } = await setup(ME, [
      event({
        id: '$long',
        ts: 2000,
        sender: AGENT,
        content: {
          msgtype: 'm.file',
          body: '🔧 `read_file` [1]\nDetailed **summary** ready.',
          url: 'mxc://example.org/sidecar-1',
          'io.mindroom.long_text': longTextMeta,
        },
      }),
    ]);
    expect(readThreadSignals(direct, ROOT, ME, NOW).lastReply?.preview).toEqual({
      kind: 'text',
      text: expect.stringContaining('Detailed summary ready.'),
      localization: { kind: 'tools', count: 1, prose: 'Detailed summary ready.' },
    });

    const { room: edited } = await setup(
      ME,
      [
        event({ id: '$stream', ts: 2000, sender: AGENT, content: { body: 'Thinking...' } }),
        edit('$stream-final', '$stream', 3000, {
          msgtype: 'm.file',
          body: 'Final edited long reply.',
          url: 'mxc://example.org/sidecar-2',
          'io.mindroom.long_text': longTextMeta,
        }),
      ],
      { opened: true }
    );
    expect(readThreadSignals(edited, ROOT, ME, NOW).lastReply?.preview).toEqual({
      kind: 'text',
      text: 'Final edited long reply.',
    });

    const { room: blank } = await setup(ME, [
      event({
        id: '$blank-long',
        ts: 2000,
        sender: AGENT,
        content: {
          msgtype: 'm.file',
          body: '   ',
          url: 'mxc://example.org/sidecar-3',
          'io.mindroom.long_text': longTextMeta,
        },
      }),
    ]);
    expect(readThreadSignals(blank, ROOT, ME, NOW).lastReply?.preview).toEqual({
      kind: 'text',
      text: 'File',
      localization: { kind: 'file' },
    });

    const { room: plainFile } = await setup(ME, [
      event({ id: '$plain-file', ts: 2000, content: { msgtype: 'm.file', body: 'notes.pdf' } }),
    ]);
    expect(readThreadSignals(plainFile, ROOT, ME, NOW).lastReply?.preview).toEqual({
      kind: 'file',
    });
  });

  it('hands the last reply to plugins as the timeline does, its newest edit included', async () => {
    const card = { 'com.example.greeting': { text: 'Hello' } };
    const { room } = await setup(
      ME,
      [
        event({ id: '$r', ts: 2000, sender: AGENT, content: { body: 'Hi' } }),
        edit('$fix', '$r', 3000, { body: 'Hello', ...card }),
      ],
      { opened: true }
    );

    expect(readThreadSignals(room, ROOT, ME, NOW).lastReply?.event).toEqual({
      eventId: '$r',
      roomId: ROOM_ID,
      type: 'm.room.message',
      sender: AGENT,
      content: { msgtype: 'm.text', body: 'Hello', ...card },
    });
  });

  it('keeps the MindRoom metadata an edit carries beside m.new_content, as the timeline does', async () => {
    const reply = event({ id: '$r', ts: 2000, sender: AGENT, content: { body: 'Thinking...' } });
    const done = new MatrixEvent({
      event_id: '$done',
      room_id: ROOM_ID,
      sender: AGENT,
      type: 'm.room.message',
      origin_server_ts: 3000,
      content: {
        msgtype: 'm.text',
        body: '* Done',
        'io.mindroom.stream_status': 'completed',
        'm.new_content': { msgtype: 'm.text', body: 'Done' },
        'm.relates_to': { rel_type: RelationType.Replace, event_id: '$r' },
      },
    });
    const { room } = await setup(ME, [reply, done], { opened: true });

    expect(readThreadSignals(room, ROOT, ME, NOW).lastReply?.event?.content).toEqual({
      msgtype: 'm.text',
      body: 'Done',
      'io.mindroom.stream_status': 'completed',
    });
  });

  it('looks up no event for plugins while no renderer of the build has a preview', async () => {
    const { room } = await setup(AGENT, [
      event({ id: '$r', ts: 2000, sender: AGENT, content: { body: 'Hi' } }),
    ]);
    plugins.splice(0, 1, {
      ...previewPlugin,
      messageRenderers: [{ match: () => true, Component: () => null }],
    } as unknown as RegisteredPlugin);
    try {
      const signals = readThreadSignals(room, ROOT, ME, NOW);
      expect(signals.lastReply?.eventId).toBe('$r');
      expect(signals.lastReply?.event).toBeUndefined();
      const getThread = vi.spyOn(room, 'getThread');
      const findEventById = vi.spyOn(room, 'findEventById');
      const entry = { threadRootId: ROOT, threadRecord: { presentation: {} } } as Pick<
        CrossRoomThreadIndexEntry,
        'threadRecord' | 'threadRootId'
      >;
      expect(threadRootPluginEvent(room, entry)).toBeUndefined();
      expect(getThread).not.toHaveBeenCalled();
      expect(findEventById).not.toHaveBeenCalled();
    } finally {
      plugins.splice(0, 1, previewPlugin);
    }
  });

  it("hands a thread's root to plugins with its newest edit, unless the thread has an AI title", async () => {
    const card = { 'com.example.greeting': { text: 'Hello' } };
    const { room } = await setup(AGENT, []);
    const fix = edit('$fix', ROOT, 3000, { body: 'Hello', ...card });
    room.getUnfilteredTimelineSet().addLiveEvent(fix, { addToState: false });
    const entry = (summaryText?: string) =>
      ({ threadRootId: ROOT, threadRecord: { presentation: { summaryText } } }) as Pick<
        CrossRoomThreadIndexEntry,
        'threadRecord' | 'threadRootId'
      >;

    expect(threadRootPluginEvent(room, entry())).toMatchObject({
      eventId: ROOT,
      sender: AGENT,
      content: { body: 'Hello', ...card },
    });
    expect(threadRootPluginEvent(room, entry('Greetings'))).toBeUndefined();
    expect(threadRootPluginEvent(room, { ...entry(), threadRootId: '$gone' })).toBeUndefined();
  });

  it('drops questions from resolved threads but keeps approvals asked after the resolve', async () => {
    const { room } = await setup(ME, [approval('$ask', 2000, null), question('$q', 3000)]);
    const afterBoth = readThreadSignals(room, ROOT, ME, NOW, 3000);
    expect(afterBoth.newsTs).toBe(3000);
    expect(afterBoth.pendingApproval).toBeUndefined();
    expect(afterBoth.pendingQuestion).toBeUndefined();

    const between = readThreadSignals(room, ROOT, ME, NOW, 2500);
    expect(between.pendingApproval).toBeUndefined();
    expect(between.pendingQuestion).toBeUndefined();

    const beforeBoth = readThreadSignals(room, ROOT, ME, NOW, 1500);
    expect(beforeBoth.pendingApproval?.eventId).toBe('$ask');
    expect(beforeBoth.pendingQuestion).toBeUndefined();
  });

  it('drops a streamed question added by an edit after the resolve', async () => {
    const { 'io.mindroom.interactive': prompt } = question('$q', 2000).getContent();
    const { room } = await setup(
      ME,
      [
        event({ id: '$q', ts: 2000, sender: AGENT, content: { body: 'Thinking...' } }),
        edit('$q-done', '$q', 3000, {
          body: 'Which deck should I polish?',
          'io.mindroom.stream_status': 'completed',
          'io.mindroom.interactive': prompt,
        }),
      ],
      { opened: true }
    );
    expect(readThreadSignals(room, ROOT, ME, NOW).pendingQuestion?.eventId).toBe('$q');
    const resolved = readThreadSignals(room, ROOT, ME, NOW, 2500);
    expect(resolved.newsTs).toBe(3000);
    expect(resolved.pendingQuestion).toBeUndefined();
  });

  it('asks from the edit that finished the stream, so a message written meanwhile is no answer', async () => {
    const { 'io.mindroom.interactive': prompt } = question('$q', 2000).getContent();
    const { room, thread } = await setup(
      ME,
      [
        event({ id: '$q', ts: 2000, sender: AGENT, content: { body: 'Thinking...' } }),
        event({ id: '$also', ts: 2500, sender: ME, content: { body: 'also check the v2 deck' } }),
        edit('$q-done', '$q', 3000, {
          body: 'Which deck should I polish?',
          'io.mindroom.stream_status': 'completed',
          'io.mindroom.interactive': prompt,
        }),
      ],
      { opened: true }
    );
    expect(readThreadSignals(room, ROOT, ME, NOW).pendingQuestion?.eventId).toBe('$q');

    thread.addEvent(event({ id: '$bob', ts: 3500, sender: BOB }), false);
    expect(readThreadSignals(room, ROOT, ME, NOW).pendingQuestion).toBeUndefined();
  });

  it('takes a corrected reply for read once the user read it, as the thread list does', async () => {
    // An agent fixes a typo in a reply the user already read: the receipt stays on the reply.
    const { room } = await setup(
      ME,
      [
        event({ id: '$r', ts: 2000, sender: AGENT, content: { body: 'Leave at 7:54' } }),
        edit('$fix', '$r', 3000, { body: 'Leave at 7:45' }),
      ],
      { opened: true }
    );
    readUpTo(room, '$r', 2500);

    const signals = readThreadSignals(room, ROOT, ME, NOW);

    expect(signals.lastReply).toMatchObject({ preview: { text: 'Leave at 7:45' } });
    expect(signals.newCount).toBe(0);
  });

  it('takes a streamed reply for read when the receipt names its bundled finishing edit', async () => {
    // After a reload or on another device: the thread holds the reply with its edit bundled.
    const reply = event({ id: '$r', ts: 2000, sender: AGENT, content: { body: 'Thinking...' } });
    reply.setUnsigned({
      'm.relations': {
        [RelationType.Replace]: edit('$finish', '$r', 3000, {
          body: 'Leave at 7:45 AM.',
          'io.mindroom.stream_status': 'completed',
        }).event,
      },
    });
    const { room } = await setup(ME, [reply]);
    readUpTo(room, '$finish', 3100);

    const signals = readThreadSignals(room, ROOT, ME, NOW);

    expect(signals.lastReply).toMatchObject({ preview: { text: 'Leave at 7:45 AM.' } });
    expect(signals.newCount).toBe(0);
  });

  it('binds a streamed question to its message, so a reaction on it answers it', async () => {
    const { room } = await setup(
      ME,
      [
        event({ id: '$q', ts: 2000, sender: AGENT, content: { body: 'Thinking...' } }),
        edit('$qe', '$q', 3000, {
          body: 'Which deck should I polish?',
          'io.mindroom.interactive': {
            question_text: 'Which deck should I polish?',
            options: { '✅': 'v3' },
            option_labels: { '✅': 'v3 final' },
          },
        }),
      ],
      { opened: true }
    );
    expect(readThreadSignals(room, ROOT, ME, NOW).pendingQuestion?.eventId).toBe('$q');

    room.getUnfilteredTimelineSet().relations.aggregateChildEvent(
      new MatrixEvent({
        event_id: '$react',
        room_id: ROOM_ID,
        sender: ME,
        type: 'm.reaction',
        origin_server_ts: 3500,
        content: {
          'm.relates_to': { rel_type: RelationType.Annotation, event_id: '$q', key: '✅' },
        },
      })
    );
    expect(readThreadSignals(room, ROOT, ME, NOW).pendingQuestion).toBeUndefined();
  });

  it('never takes the root for a reply', async () => {
    const { room } = await setup(BOB, [
      event({
        id: '$title',
        ts: 2000,
        sender: AGENT,
        content: {
          msgtype: 'm.notice',
          'io.mindroom.thread_summary': { version: 1, summary: 'Plan', generated_at: 'x' },
        },
      }),
    ]);
    const signals = readThreadSignals(room, ROOT, ME, NOW);
    expect(signals.lastReply).toBeUndefined();
    expect(signals.newCount).toBe(0);
    expect(signals.newSenderIds).toEqual([]);
  });

  it('never counts the router relaying a message, an echo of what someone wrote', async () => {
    const ROUTER = '@mindroom_router:example.org';
    const { room } = await setup(ME, [
      event({
        id: '$relay',
        ts: 2000,
        sender: ROUTER,
        content: {
          body: '@mindroom_code:example.org plan the launch',
          'com.mindroom.original_sender': ME,
          'com.mindroom.source_kind': 'trusted_internal_relay',
        },
      }),
      event({ id: '$answer', ts: 3000, sender: AGENT }),
    ]);
    const signals = readThreadSignals(room, ROOT, ME, NOW);
    expect(signals.newCount).toBe(1);
    expect(signals.newSenderIds).toEqual([AGENT]);
  });

  it('takes an approval for answered once the edit resolving it syncs, in a thread not opened', async () => {
    const { mx, room } = await setup(ME, [approval('$ask', 2000, null)]);
    const stop = keepSyncedEdits(mx);
    // MindRoom resolves a card by editing it; a thread not opened holds the edit back.
    const { 'm.relates_to': _thread, ...card } = approval('$ask', 2000, null).getContent();
    mx.emit(
      ClientEvent.Event,
      new MatrixEvent({
        type: 'io.mindroom.tool_approval',
        event_id: '$ask-resolved',
        room_id: ROOM_ID,
        sender: AGENT,
        origin_server_ts: 3000,
        content: {
          'm.new_content': { ...card, status: 'approved' },
          'm.relates_to': { rel_type: RelationType.Replace, event_id: '$ask' },
        },
      })
    );

    expect(readThreadSignals(room, ROOT, ME, NOW).pendingApproval).toBeUndefined();
    stop();
  });

  it('drops an approval once it expired', async () => {
    const ask = approval('$ask', 2000, null);
    ask.getContent().expires_at = new Date(NOW - 1000).toISOString();
    const { room } = await setup(ME, [ask]);
    expect(readThreadSignals(room, ROOT, ME, NOW).pendingApproval).toBeUndefined();
  });
});
