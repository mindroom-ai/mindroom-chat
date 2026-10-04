import { Capacitor } from '@capacitor/core';
import { RelationType, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { APP_BUILD_VERSION } from '../../../appVersion';
import { getMatrixToRoomEvent } from '../../plugins/matrix-to';
import { getViaServers } from '../../plugins/via-servers';
import { buildDiagnosticsPayload, type DiagnosticsPayload } from '../diagnostics/diagnosticsExport';
import { getThreadReplyEventsForRoot } from '../threads/threadUtils';

export const BUG_REPORT_TYPE = 'io.mindroom.bug_report';
export const BUG_REPORT_VERSION = 1;
const MAIN_TIMELINE_EVENT_LIMIT = 50;

type RawEvent = Record<string, unknown>;

export type BugReportEvent = {
  eventId: string | null;
  status: string | null;
  decryptionFailure: boolean;
  event: RawEvent;
  latestEdit: RawEvent | null;
};

export type BugReport = {
  type: typeof BUG_REPORT_TYPE;
  version: typeof BUG_REPORT_VERSION;
  reportedAt: string;
  reporter: { userId: string; deviceId: string | null; homeserver: string };
  target: {
    roomId: string;
    roomName: string;
    threadId: string | null;
    eventId: string;
    permalink: string;
  };
  events: BugReportEvent[];
  client: {
    build: string;
    platform: string;
    userAgent: string;
    language: string;
    timeZone: string;
    viewport: { width: number; height: number; devicePixelRatio: number };
    online: boolean;
    visibility: string;
    syncState: string | null;
    location: string;
  };
  diagnostics: DiagnosticsPayload;
};

const serializeEvent = (event: MatrixEvent): BugReportEvent => ({
  eventId: event.getId() ?? null,
  status: event.status ?? null,
  decryptionFailure: event.isDecryptionFailure(),
  event: event.getEffectiveEvent() as unknown as RawEvent,
  latestEdit: (event.replacingEvent()?.getEffectiveEvent() as RawEvent | undefined) ?? null,
});

const isEditEvent = (event: MatrixEvent): boolean =>
  event.getRelation()?.rel_type === RelationType.Replace;

/**
 * The events an administrator needs to see the reported message in context.
 * `m.replace` edits are left out (streaming produces hundreds); each event's
 * latest edit is attached to it instead. Reactions are kept.
 */
export const collectReportEvents = (room: Room, mEvent: MatrixEvent): MatrixEvent[] => {
  const eventId = mEvent.getId();
  const isReportable = (event: MatrixEvent) => event.getId() === eventId || !isEditEvent(event);

  const threadId = mEvent.threadRootId;
  if (threadId) {
    const byId = new Map<string, MatrixEvent>();
    const add = (event: MatrixEvent | null | undefined) => {
      const id = event?.getId();
      if (event && id && isReportable(event) && !byId.has(id)) byId.set(id, event);
    };
    const thread = room.getThread(threadId);
    add(room.findEventById(threadId) ?? thread?.rootEvent);
    (thread?.events ?? []).forEach(add);
    getThreadReplyEventsForRoot(room.getLiveTimeline().getEvents(), threadId).forEach(add);
    add(mEvent);
    return [...byId.values()].sort((a, b) => a.getTs() - b.getTs());
  }

  const timeline = (eventId ? room.getTimelineForEvent(eventId) : null) ?? room.getLiveTimeline();
  const events = timeline.getEvents().filter(isReportable);
  const index = events.findIndex((event) => event.getId() === eventId);
  if (index === -1) return [...events.slice(-(MAIN_TIMELINE_EVENT_LIMIT - 1)), mEvent];
  return events.slice(Math.max(0, index + 1 - MAIN_TIMELINE_EVENT_LIMIT), index + 1);
};

const buildClientState = (mx: MatrixClient): BugReport['client'] => ({
  build: APP_BUILD_VERSION,
  platform: Capacitor.getPlatform(),
  userAgent: navigator.userAgent,
  language: navigator.language,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  viewport: {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  },
  online: navigator.onLine,
  visibility: document.visibilityState,
  syncState: mx.getSyncState(),
  location: window.location.href,
});

export const buildBugReport = async (
  mx: MatrixClient,
  room: Room,
  mEvent: MatrixEvent,
  now: Date = new Date()
): Promise<BugReport> => {
  const eventId = mEvent.getId() ?? '';
  return {
    type: BUG_REPORT_TYPE,
    version: BUG_REPORT_VERSION,
    reportedAt: now.toISOString(),
    reporter: {
      userId: mx.getSafeUserId(),
      deviceId: mx.getDeviceId(),
      homeserver: mx.getHomeserverUrl(),
    },
    target: {
      roomId: room.roomId,
      roomName: room.name,
      threadId: mEvent.threadRootId ?? null,
      eventId,
      permalink: getMatrixToRoomEvent(room.roomId, eventId, getViaServers(room)),
    },
    events: collectReportEvents(room, mEvent).map(serializeEvent),
    client: buildClientState(mx),
    diagnostics: await buildDiagnosticsPayload(now.getTime()),
  };
};

export const getBugReportFileName = (report: BugReport): string =>
  `mindroom-bug-report-${report.reportedAt.replace(/[:.]/g, '-')}.json`;

export const serializeBugReport = (report: BugReport): Blob =>
  new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
