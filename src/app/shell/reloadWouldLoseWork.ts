// What a reload of this page would lose. A part of the app that could not load offers Retry, which
// may reload the page (src/app/ui/partRetry.ts); the account's providers (ClientRoot.tsx) hand
// this check to it, since the part's view sits below the domains that hold the state.

import { EventStatus, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { createStore } from 'jotai';
import { activeCallAtom } from '../calls/callStore';
import { composersHoldUnsavedWork } from '../composer/roomInputDrafts';

type JotaiStore = ReturnType<typeof createStore>;

/** Local echoes a reload drops: not yet at the server, or failed and waiting for a resend. */
const UNSENT_STATUSES = new Set<EventStatus | null>([
  EventStatus.ENCRYPTING,
  EventStatus.QUEUED,
  EventStatus.SENDING,
  EventStatus.NOT_SENT,
]);

const isUnsent = (event: MatrixEvent): boolean => UNSENT_STATUSES.has(event.status);

const holdsUnsentMessages = (room: Room): boolean =>
  room.getLiveTimeline().getEvents().some(isUnsent) ||
  room.getThreads().some((thread) => thread.liveTimeline.getEvents().some(isUnsent));

/**
 * Whether a reload of this page would lose something: a call in progress, a file being uploaded,
 * a message not yet sent, or composer state that lives only in memory (staged files, a reply
 * target, a voice message). Without a client (fixtures) only the store is asked.
 */
export const reloadWouldLoseWork = (store: JotaiStore, mx: MatrixClient | undefined): boolean =>
  store.get(activeCallAtom) !== undefined ||
  composersHoldUnsavedWork(store) ||
  (mx !== undefined &&
    (mx.getCurrentUploads().length > 0 || mx.getRooms().some(holdsUnsentMessages)));
