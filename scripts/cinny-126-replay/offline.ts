import { MatrixEvent, MatrixEventEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { FeatureSupport, Thread, ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { buildCrossRoomThreadIndexEntry } from '../../src/app/mindroom/cross-room-threads/crossRoomThreadIndex';
import { buildCompactThreadCardViewModelFromRecord } from '../../src/app/mindroom/threads/compactThreadCardViewModel';
import { getRoomThreadTagSnapshotMap } from '../../src/app/mindroom/threads/threadTagSnapshots';
import { buildThreadRecord } from '../../src/app/mindroom/threads/threadRecord';
import { fingerprintText, fingerprintsMatch, orderedSignalIdsMatch } from './exactReplayOracle';
import { cloneTraceEvent, loadExactTrace, type TraceEvent } from './trace';

const OFFLINE_ROOM_ID = '!cinny-126-replay:test.invalid';

type Scenario = 'exact' | 'warm' | 'slow-init' | 'forced-init-failure';

const getArgument = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};

const scenario = (getArgument('scenario') ?? 'exact') as Scenario;
const speed = Number(getArgument('speed') ?? '1');
if (!['exact', 'warm', 'slow-init', 'forced-init-failure'].includes(scenario)) {
  throw new Error(`Unknown scenario: ${scenario}`);
}
if (!Number.isFinite(speed) || speed <= 0) throw new Error(`Invalid replay speed: ${speed}`);

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, milliseconds));
  });

const settle = async (cycles = 12) => {
  for (let index = 0; index < cycles; index += 1) await Promise.resolve();
  await sleep(0);
};

const emitDiagnostic = (kind: string, value: Record<string, unknown>) => {
  process.stdout.write(`${JSON.stringify({ kind, ...value })}\n`);
};

const trace = await loadExactTrace();
const originalThreadSupport = Thread.hasServerSideSupport;
Thread.hasServerSideSupport = FeatureSupport.Stable;
let unhandledRejectionCount = 0;
const captureUnhandledRejection = () => {
  unhandledRejectionCount += 1;
  emitDiagnostic('unhandled-rejection', { occurred: true });
};
if (scenario === 'forced-init-failure') {
  process.on('unhandledRejection', captureUnhandledRejection);
}

let releaseRootFetch: ((event: TraceEvent) => void) | undefined;
const rootFetch = new Promise<TraceEvent>((resolve) => {
  releaseRootFetch = resolve;
});
let paginationAttempts = 0;
const firstOrderEvents: MatrixEvent[] = [];

const client = {
  canSupport: new Map([[Feature.RelationsRecursion, ServerSupport.Stable]]),
  fetchRoomEvent: () => rootFetch,
  getEventMapper:
    () =>
    (event: TraceEvent | MatrixEvent): MatrixEvent =>
      event instanceof MatrixEvent ? event : new MatrixEvent(event),
  getUserId: () => '@cinny-126-viewer:test.invalid',
  paginateEventTimeline: async (timeline: ReturnType<Room['getLiveTimeline']>) => {
    paginationAttempts += 1;
    if (scenario === 'forced-init-failure' && paginationAttempts === 1) {
      throw new Error('CINNY-126 forced initial thread pagination failure');
    }
    timeline
      .getTimelineSet()
      .addEventsToTimeline([...firstOrderEvents].reverse(), true, false, timeline, null);
    return true;
  },
  supportsThreads: () => true,
};

const room = new Room(
  OFFLINE_ROOM_ID,
  client as unknown as ConstructorParameters<typeof Room>[1],
  '@cinny-126-viewer:test.invalid'
);
const latestForRoot = cloneTraceEvent(trace.voice, OFFLINE_ROOM_ID);
const rootWireEvent: TraceEvent = {
  content: { body: 'CINNY-126 exact-trace replay root', msgtype: 'm.text' },
  event_id: trace.ids.threadRoot,
  origin_server_ts: trace.voice.origin_server_ts - 1,
  room_id: OFFLINE_ROOM_ID,
  sender: '@cinny-126-root:test.invalid',
  type: 'm.room.message',
  unsigned: {
    'm.relations': {
      'm.thread': {
        count: 12,
        current_user_participated: true,
        latest_event: latestForRoot,
      },
    },
  },
};
const rootEvent = new MatrixEvent(rootWireEvent);
room.getUnfilteredTimelineSet().addEventToTimeline(rootEvent, room.getLiveTimeline(), {
  addToState: false,
  roomState: room.currentState,
  toStartOfTimeline: false,
});
const thread = room.createThread(trace.ids.threadRoot, rootEvent, [], false);

const submittedEventIds: string[] = [];
const sdkProcessedEventIds: string[] = [];
const editTimelineEventIds: string[] = [];
const expectedEditIds = trace.edits.map((event) => event.event_id);
const threadUpdateEditIds: string[] = [];
const replacementSignalEventIds: string[] = [];
room.on(RoomEvent.Timeline, (event) => {
  if (trace.edits.some((edit) => edit.event_id === event.getId())) {
    editTimelineEventIds.push(event.getId() ?? 'missing-id');
  }
});
thread.on(ThreadEvent.Update, () => {
  const replacementId = mappedEvents.get(trace.ids.placeholder)?.replacingEvent()?.getId();
  if (replacementId && expectedEditIds.includes(replacementId)) {
    threadUpdateEditIds.push(replacementId);
  }
});

const mappedEvents = new Map<string, MatrixEvent>();
const replayStartTs = trace.replayEvents[0].origin_server_ts;
const wallStart = Date.now();

const releaseInitialization = async () => {
  releaseRootFetch?.(rootWireEvent);
  releaseRootFetch = undefined;
  await settle();
};

if (scenario === 'warm') await releaseInitialization();

const eventReachedSdkState = (event: MatrixEvent): boolean => {
  const eventId = event.getId();
  if (!eventId) return false;
  if (event.isRelation('m.replace')) {
    return (
      event.getThread() === thread &&
      (thread.replayEvents?.includes(event) === true ||
        thread.findEventById(eventId) === event ||
        mappedEvents.get(trace.ids.placeholder)?.replacingEvent()?.getId() === eventId)
    );
  }
  if (event.isRelation('m.thread')) return thread.findEventById(eventId) === event;
  if (event.isState()) {
    const stateKey = event.getStateKey();
    return (
      typeof stateKey === 'string' &&
      room.currentState.getStateEvents(event.getType(), stateKey)?.getId() === eventId
    );
  }
  return room.findEventById(eventId) === event;
};

const observeAcceptanceSurfaces = (placeholder: MatrixEvent) => {
  const tagSnapshot = getRoomThreadTagSnapshotMap(room).get(trace.ids.threadRoot);
  const record = buildThreadRecord({
    room,
    threadRootId: trace.ids.threadRoot,
    threadRootEvent: rootEvent,
    currentUserId: trace.senders.user,
    readUpToTs: rootEvent.getTs(),
    threadResolution: tagSnapshot
      ? { isResolved: tagSnapshot.isResolved, tags: tagSnapshot.content.tags }
      : undefined,
  });
  const compactCard = buildCompactThreadCardViewModelFromRecord({
    record,
    room,
    currentUserId: trace.senders.user,
    mx: client as never,
    useAuthentication: false,
  });
  const globalEntry = buildCrossRoomThreadIndexEntry({
    room,
    threadRootId: trace.ids.threadRoot,
    threadRootEvent: rootEvent,
    currentUserId: trace.senders.user,
    tagSnapshot,
  });
  const content = placeholder.getContent<Record<string, unknown>>();
  const replacement = placeholder.replacingEvent();
  const presentationBody = record.presentation.latestReplyPreviewText ?? '';
  const globalPreview = globalEntry?.threadRecord.presentation.latestReplyPreviewText ?? '';
  const compactCardFingerprint = fingerprintText(compactCard.previewText);
  const globalThreadsFingerprint = fingerprintText(globalPreview);
  const effectiveBodyFingerprint = fingerprintText(
    typeof content.body === 'string' ? content.body : ''
  );
  const overviewTagsFingerprint = fingerprintText(JSON.stringify(tagSnapshot?.displayTags ?? []));
  return {
    compactCardUsesFinal: fingerprintsMatch(
      compactCardFingerprint,
      trace.expectedFingerprints.compactCard
    ),
    effectiveBodyIsFinal: fingerprintsMatch(
      effectiveBodyFingerprint,
      trace.expectedFingerprints.effectiveBody
    ),
    globalThreadsUsesFinal: fingerprintsMatch(
      globalThreadsFingerprint,
      trace.expectedFingerprints.globalThreads
    ),
    overviewTagsVisible: fingerprintsMatch(
      overviewTagsFingerprint,
      trace.expectedFingerprints.overviewTags
    ),
    presentationUsesFinal: fingerprintsMatch(
      fingerprintText(presentationBody),
      trace.expectedFingerprints.presentation
    ),
    replacementEventId: replacement?.getId() ?? null,
    replacementIsFinal: replacement?.getId() === trace.ids.finalEdit,
    roomNavUnread: record.status.isUnread,
    streamCompleted: content['io.mindroom.stream_status'] === 'completed',
    streamStatus: content['io.mindroom.stream_status'] ?? null,
  };
};

try {
  for (const [index, wireEvent] of trace.replayEvents.entries()) {
    if (scenario === 'slow-init' && index === 11) await releaseInitialization();
    if (scenario === 'forced-init-failure' && index === 0) await releaseInitialization();
    const targetElapsed = (wireEvent.origin_server_ts - replayStartTs) / speed;
    await sleep(targetElapsed - (Date.now() - wallStart));
    const event = new MatrixEvent(cloneTraceEvent(wireEvent, OFFLINE_ROOM_ID));
    mappedEvents.set(wireEvent.event_id, event);
    submittedEventIds.push(wireEvent.event_id);
    await room.addLiveEvents([event], {
      addToState: true,
      fromCache: false,
    });
    await settle();
    if (wireEvent.event_id === trace.ids.placeholder) {
      event.on(MatrixEventEvent.Replaced, () => {
        const replacementId = event.replacingEvent()?.getId();
        if (replacementId) replacementSignalEventIds.push(replacementId);
      });
    }
    if (eventReachedSdkState(event)) sdkProcessedEventIds.push(wireEvent.event_id);
    if (event.isRelation('m.thread')) firstOrderEvents.push(event);
    emitDiagnostic('event', {
      sequence: index,
      eventType: wireEvent.type,
      relationType: event.getRelation()?.rel_type ?? null,
      scheduledOffsetMs: wireEvent.origin_server_ts - replayStartTs,
      observedOffsetMs: Date.now() - wallStart,
    });
  }
  await settle();

  const placeholder = mappedEvents.get(trace.ids.placeholder);
  if (!placeholder) throw new Error('Replay did not map the placeholder');
  const preInitSurfaces = observeAcceptanceSurfaces(placeholder);
  const summary = mappedEvents.get(trace.summary.event_id);
  const summaryReplyTarget = (
    summary?.getWireContent()['m.relates_to'] as Record<string, unknown> | undefined
  )?.['m.in_reply_to'] as Record<string, unknown> | undefined;

  const allSdkEventsProcessed = sdkProcessedEventIds.length === trace.replayEvents.length;
  const preInitEditTimelineCount = editTimelineEventIds.length;
  const summaryTargetsFinal = summaryReplyTarget?.event_id === trace.ids.finalEdit;
  const replacementSignalsMatch = orderedSignalIdsMatch(expectedEditIds, replacementSignalEventIds);
  const threadUpdatesMatch = orderedSignalIdsMatch(expectedEditIds, threadUpdateEditIds);
  const preInitReplacementSignalCount = replacementSignalEventIds.length;
  const preInitThreadUpdateCount = threadUpdateEditIds.length;
  const requireExactPreInitSignals = scenario === 'exact';

  let status: 'GREEN' | 'RED';
  let hypothesis: string;
  if (!allSdkEventsProcessed) {
    status = 'RED';
    hypothesis = 'SYNC_NOT_PROCESSED';
  } else if (
    scenario === 'forced-init-failure' &&
    (paginationAttempts < 2 || !thread.initialEventsFetched || unhandledRejectionCount > 0)
  ) {
    status = 'RED';
    hypothesis = 'H1_STRANDED_INIT_PROMISE';
  } else if (!preInitSurfaces.replacementIsFinal && preInitEditTimelineCount === 0) {
    status = 'RED';
    hypothesis = 'H1_SDK_PREINIT_BUFFERING';
  } else if (
    requireExactPreInitSignals &&
    preInitSurfaces.replacementIsFinal &&
    !replacementSignalsMatch
  ) {
    status = 'RED';
    hypothesis = 'SDK_NO_REPLACEMENT_SIGNAL';
  } else if (
    requireExactPreInitSignals &&
    preInitSurfaces.replacementIsFinal &&
    !threadUpdatesMatch
  ) {
    status = 'RED';
    hypothesis = 'SDK_NO_THREAD_UPDATE';
  } else if (
    preInitSurfaces.replacementIsFinal &&
    (!preInitSurfaces.compactCardUsesFinal ||
      !preInitSurfaces.globalThreadsUsesFinal ||
      !preInitSurfaces.presentationUsesFinal)
  ) {
    status = 'RED';
    hypothesis = 'PRESENTATION_HELPER';
  } else if (
    preInitSurfaces.replacementIsFinal &&
    preInitSurfaces.effectiveBodyIsFinal &&
    preInitSurfaces.streamCompleted &&
    preInitSurfaces.compactCardUsesFinal &&
    preInitSurfaces.globalThreadsUsesFinal &&
    preInitSurfaces.presentationUsesFinal &&
    preInitSurfaces.overviewTagsVisible &&
    preInitSurfaces.roomNavUnread &&
    summaryTargetsFinal
  ) {
    status = 'GREEN';
    hypothesis = 'NONE';
  } else {
    status = 'RED';
    hypothesis = 'INCOMPLETE_ACCEPTANCE_STATE';
  }

  emitDiagnostic('pre-init-observation', {
    allSdkEventsProcessed,
    compactCardUsesFinal: preInitSurfaces.compactCardUsesFinal,
    editTimelineEventCount: preInitEditTimelineCount,
    globalThreadsUsesFinal: preInitSurfaces.globalThreadsUsesFinal,
    overviewTagsVisible: preInitSurfaces.overviewTagsVisible,
    paginationAttempts,
    presentationUsesFinal: preInitSurfaces.presentationUsesFinal,
    replacementIsFinal: preInitSurfaces.replacementIsFinal,
    replacementSignalCount: preInitReplacementSignalCount,
    replacementSignalsMatch,
    roomNavUnread: preInitSurfaces.roomNavUnread,
    sdkProcessedEventCount: sdkProcessedEventIds.length,
    streamStatus: preInitSurfaces.streamStatus,
    submittedEventCount: submittedEventIds.length,
    summaryTargetsFinal,
    threadInitialEventsFetched: thread.initialEventsFetched,
    threadUpdateCount: preInitThreadUpdateCount,
    threadUpdatesMatch,
    unhandledRejectionCount,
  });

  if (!releaseRootFetch && scenario === 'forced-init-failure') {
    thread.addEvents([], false);
    await settle();
  } else {
    await releaseInitialization();
  }
  const postInitSurfaces = observeAcceptanceSurfaces(placeholder);
  const postInitAccepted =
    postInitSurfaces.replacementIsFinal &&
    postInitSurfaces.effectiveBodyIsFinal &&
    postInitSurfaces.streamCompleted &&
    postInitSurfaces.compactCardUsesFinal &&
    postInitSurfaces.globalThreadsUsesFinal &&
    postInitSurfaces.presentationUsesFinal &&
    postInitSurfaces.overviewTagsVisible &&
    postInitSurfaces.roomNavUnread;
  if (status === 'GREEN' && !postInitAccepted) {
    status = 'RED';
    hypothesis = 'FIRST_ENTRY_STATE_LOST';
  }
  emitDiagnostic('post-init-observation', {
    compactCardUsesFinal: postInitSurfaces.compactCardUsesFinal,
    effectiveBodyIsFinal: postInitSurfaces.effectiveBodyIsFinal,
    globalThreadsUsesFinal: postInitSurfaces.globalThreadsUsesFinal,
    overviewTagsVisible: postInitSurfaces.overviewTagsVisible,
    paginationAttempts,
    replacementIsFinal: postInitSurfaces.replacementIsFinal,
    replacementSignalCount: replacementSignalEventIds.length,
    roomNavUnread: postInitSurfaces.roomNavUnread,
    streamStatus: postInitSurfaces.streamStatus,
    threadInitialEventsFetched: thread.initialEventsFetched,
    threadUpdateCount: threadUpdateEditIds.length,
    unhandledRejectionCount,
  });
  process.stdout.write(
    `CINNY126_VERDICT status=${status} hypothesis=${hypothesis} scenario=${scenario} speed=${speed} ` +
      `sdkProcessed=${sdkProcessedEventIds.length}/${trace.replayEvents.length} ` +
      `editTimeline=${preInitEditTimelineCount}/17 replacementFinal=${preInitSurfaces.replacementIsFinal} ` +
      `threadUpdates=${preInitThreadUpdateCount}/17 tagsBeforeEntry=${preInitSurfaces.overviewTagsVisible} ` +
      `summaryTargetsFinal=${summaryTargetsFinal} firstEntryFinal=${postInitAccepted}\n`
  );
  if (status !== 'GREEN') process.exitCode = 1;
} finally {
  process.removeListener('unhandledRejection', captureUnhandledRejection);
  Thread.hasServerSideSupport = originalThreadSupport;
}
