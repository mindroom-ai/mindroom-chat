import { useEffect } from 'react';
import { useStore } from 'jotai';
import type { Descendant } from 'slate';
import { EventStatus } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { callEmbedAtom } from '../../state/callEmbed';
import {
  getRoomInputDraftKey,
  pendingVoiceSendDraftAtom,
  roomIdToMsgDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
  voiceAutoSendPendingAtom,
} from '../../state/room/roomInputDrafts';
import { UploadStatus } from '../../state/upload';
import { isLocalEchoEventId } from '../threads/threadRouteUtils';
import { isVoiceCaptureActive } from '../voice/voiceCaptureDiagnostics';
import {
  registerStorageRecoveryBlocker,
  registerStorageRecoveryPreparation,
} from './storageConnectionRecovery';

type JotaiStore = ReturnType<typeof useStore>;

/**
 * A composer send still unanswered after this long will not finish on its own
 * once storage is lost: the Rust crypto store can no longer encrypt it.
 */
export const STUCK_SEND_MS = 10_000;

/** Statuses before the request leaves; a later send may already have reached the server. */
const UNSENT_STATUSES = new Set<unknown>([
  EventStatus.ENCRYPTING,
  EventStatus.QUEUED,
  EventStatus.NOT_SENT,
]);

export type ComposerTextSend = {
  userId: string;
  /** The composer that sent it, which can differ from the event's room or thread. */
  roomId: string;
  threadId: string | undefined;
  /** The composer content before it was cleared, formatting included. */
  draft: Descendant[];
  startedAt: number;
  /** Status of the send's local echo, if the room still has it. */
  getStatus: () => EventStatus | null | undefined;
  /** Whether the room had a local echo when tracking began; the SDK drops it on remote echo. */
  hadEcho: boolean;
  /** False once the account's drafts were cleared, for example by removing the account. */
  canWriteDraft: () => boolean;
};

const composerTextSends = new Set<ComposerTextSend>();

/**
 * Tracks a composer text send until it is answered or back in its composer.
 * Only sends that never settle, or whose failure the timeline keeps instead
 * of the composer, need saving before a recovery reload.
 */
export const trackComposerTextSend = (send: ComposerTextSend): (() => void) => {
  composerTextSends.add(send);
  return () => {
    composerTextSends.delete(send);
  };
};

const isInFlight = (send: ComposerTextSend, now: number): boolean =>
  now - send.startedAt < STUCK_SEND_MS;

const NON_TEXT_INPUT_TYPES = [
  'hidden',
  'checkbox',
  'radio',
  'file',
  'range',
  'color',
  'button',
  'submit',
  'reset',
  'image',
  'search',
];
const EDITABLE_SELECTOR = [
  `input${NON_TEXT_INPUT_TYPES.map((type) => `:not([type="${type}"])`).join('')}`,
  'textarea',
  '[contenteditable="true"]',
].join(', ');

const hasTypedText = (element: Element): boolean => {
  if (element.closest('[data-editable-name="RoomInput"]')) return false;
  if (element.getAttribute('role') === 'searchbox') return false;
  const value =
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.value
      : element.textContent ?? '';
  return value.trim().length > 0;
};

/**
 * Text typed outside the persisted room composer lives only in memory: an open
 * dialog or a focused field (settings, room creation, password prompts) that
 * already holds text. Empty fields and search boxes have nothing to lose.
 */
export const hasUnsavedFormInput = (
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document
): boolean => {
  if (!doc) return false;
  const active = doc.activeElement;
  if (active?.matches(EDITABLE_SELECTOR) && hasTypedText(active)) return true;
  return Array.from(
    doc.getElementById('portalContainer')?.querySelectorAll(EDITABLE_SELECTOR) ?? []
  ).some(hasTypedText);
};

/**
 * Work that exists only in this page's memory, which an automatic recovery
 * reload would discard. Composer text persists on every edit, and stuck
 * composer sends are moved back into their composers before reloading.
 */
export const hasUnsavedTransientWork = ({
  store,
  now = Date.now(),
  doc,
  isKnownRoom = () => true,
}: {
  store: JotaiStore;
  now?: number;
  doc?: Document;
  /** Attachments staged in a room of another account cannot be reached here. */
  isKnownRoom?: (roomId: string) => boolean;
}): boolean =>
  isVoiceCaptureActive() ||
  store.get(voiceAutoSendPendingAtom) ||
  store.get(pendingVoiceSendDraftAtom) !== undefined ||
  store.get(callEmbedAtom) !== undefined ||
  Array.from(composerTextSends).some((send) => isInFlight(send, now)) ||
  roomIdToUploadItemsAtomFamily
    .getParams()
    .some(
      (roomId) => isKnownRoom(roomId) && store.get(roomIdToUploadItemsAtomFamily(roomId)).length > 0
    ) ||
  roomUploadAtomFamily
    .getParams()
    .some((file) => store.get(roomUploadAtomFamily(file)).status === UploadStatus.Loading) ||
  hasUnsavedFormInput(doc);

/**
 * Puts unanswered composer sends back at the start of the composers that sent
 * them, ahead of anything typed since, as a failed send would be restored.
 * Automatic reloads leave sends in flight alone, because they wait for them;
 * a user-requested reload saves those too. Sends whose request may already
 * have reached the server are left out to avoid sending them twice.
 */
export const saveUnsentComposerText = ({
  store,
  includeInFlight,
  now = Date.now(),
}: {
  store: JotaiStore;
  includeInFlight: boolean;
  now?: number;
}): void => {
  // Prepend newest first so several sends to one composer come back in send order.
  Array.from(composerTextSends)
    .sort((left, right) => right.startedAt - left.startedAt)
    .forEach((send) => {
      if (!includeInFlight && isInFlight(send, now)) return;
      composerTextSends.delete(send);
      const status = send.getStatus();
      // A vanished echo was replaced by the remote echo, so the server already has it.
      if (status === undefined ? send.hadEcho : !UNSENT_STATUSES.has(status)) return;
      if (!send.canWriteDraft()) return;
      const draftAtom = roomIdToMsgDraftAtomFamily(
        getRoomInputDraftKey(send.userId, send.roomId, send.threadId)
      );
      store.set(draftAtom, [...send.draft, ...store.get(draftAtom)]);
    });
};

/**
 * Web Storage writes made after the loss survive the reload, while recent
 * writes before it may not have reached disk. Write the in-memory drafts
 * again so the last seconds of typing survive too.
 */
export const persistComposerDrafts = (store: JotaiStore): void => {
  roomIdToMsgDraftAtomFamily.getParams().forEach((key) => {
    const draftAtom = roomIdToMsgDraftAtomFamily(key);
    const draft = store.get(draftAtom);
    // A draft first read after the loss may be empty only because storage read as empty.
    if (draft.length > 0) store.set(draftAtom, draft);
  });
};

/** A pending local-echo thread route renders no composer after a reload, so open its room. */
export const leavePendingThreadRoute = (
  location: Pick<Location, 'href'> | undefined = typeof window === 'undefined'
    ? undefined
    : window.location,
  history: Pick<History, 'replaceState' | 'state'> | undefined = typeof window === 'undefined'
    ? undefined
    : window.history
): void => {
  if (!location || !history) return;
  const url = new URL(location.href);
  if (!isLocalEchoEventId(url.searchParams.get('threadId') ?? undefined)) return;
  url.searchParams.delete('threadId');
  history.replaceState(history.state, '', url.toString());
};

/** Keeps storage-loss recovery from reloading over unsent or in-progress work. */
export const useStorageRecoveryBlocker = (): void => {
  const store = useStore();
  const mx = useMatrixClient();

  useEffect(() => {
    const unregisterBlocker = registerStorageRecoveryBlocker(() =>
      hasUnsavedTransientWork({ store, isKnownRoom: (roomId) => !!mx.getRoom(roomId) })
    );
    const unregisterPreparation = registerStorageRecoveryPreparation(({ automatic }) => {
      saveUnsentComposerText({ store, includeInFlight: !automatic });
      persistComposerDrafts(store);
      leavePendingThreadRoute();
    });
    return () => {
      unregisterBlocker();
      unregisterPreparation();
    };
  }, [mx, store]);
};

export const resetComposerTextSendsForTesting = (): void => {
  composerTextSends.clear();
};
