import { useEffect } from 'react';
import { useStore } from 'jotai';
import type { Descendant } from 'slate';
import { type MatrixEvent, RelationType, RoomEvent, type RoomEventHandlerMap } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { BlockType } from '../../components/editor/types';
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
import { isFailedLocalEchoEvent, isPendingLocalEchoEvent } from '../messages/pendingLocalEcho';
import { isVoiceCaptureActive } from '../voice/voiceCaptureDiagnostics';
import {
  registerStorageRecoveryBlocker,
  registerStorageRecoveryPreparation,
} from './storageConnectionRecovery';

type JotaiStore = ReturnType<typeof useStore>;

/**
 * A send still pending after this long will not finish on its own once storage
 * is lost: the Rust crypto store can no longer encrypt it.
 */
export const STUCK_SEND_MS = 10_000;

const TEXT_MSGTYPES = new Set<unknown>(['m.text', 'm.notice', 'm.emote']);

const isUnsentLocalEcho = (event: MatrixEvent): boolean =>
  isPendingLocalEchoEvent(event) || isFailedLocalEchoEvent(event);

const isInFlight = (event: MatrixEvent, now: number): boolean =>
  isPendingLocalEchoEvent(event) && now - event.getTs() < STUCK_SEND_MS;

const isMessage = (event: MatrixEvent): boolean =>
  event.getType() === 'm.room.message' && event.getRelation()?.rel_type !== RelationType.Replace;

/** Unsent text a reload would drop, which the composer can hold instead. */
const getSalvageableText = (event: MatrixEvent): string | undefined => {
  const content = event.getContent();
  return isMessage(event) &&
    TEXT_MSGTYPES.has(content.msgtype) &&
    typeof content.body === 'string' &&
    content.body.trim().length > 0
    ? content.body
    : undefined;
};

/**
 * Work that exists only in this page's memory, which a recovery reload would
 * discard. Composer text persists on every edit, and stuck text sends are
 * moved back into the composer before reloading.
 */
export const hasUnsavedTransientWork = ({
  store,
  localEchoes,
  now = Date.now(),
}: {
  store: JotaiStore;
  localEchoes: Iterable<MatrixEvent>;
  now?: number;
}): boolean =>
  isVoiceCaptureActive() ||
  store.get(voiceAutoSendPendingAtom) ||
  store.get(pendingVoiceSendDraftAtom) !== undefined ||
  store.get(callEmbedAtom) !== undefined ||
  Array.from(localEchoes).some(
    (event) =>
      isUnsentLocalEcho(event) &&
      (isInFlight(event, now) || (isMessage(event) && getSalvageableText(event) === undefined))
  ) ||
  roomIdToUploadItemsAtomFamily
    .getParams()
    .some((key) => store.get(roomIdToUploadItemsAtomFamily(key)).length > 0) ||
  roomUploadAtomFamily
    .getParams()
    .some((file) => store.get(roomUploadAtomFamily(file)).status === UploadStatus.Loading);

/** Appends stuck and failed text sends to their composer drafts so a reload keeps them. */
export const saveUnsentTextToDrafts = ({
  store,
  userId,
  localEchoes,
  now = Date.now(),
}: {
  store: JotaiStore;
  userId: string;
  localEchoes: Iterable<MatrixEvent>;
  now?: number;
}): void => {
  Array.from(localEchoes).forEach((event) => {
    const roomId = event.getRoomId();
    const text = getSalvageableText(event);
    if (!roomId || text === undefined || !isUnsentLocalEcho(event) || isInFlight(event, now)) {
      return;
    }
    const relation = event.getRelation();
    const threadId = relation?.rel_type === RelationType.Thread ? relation.event_id : undefined;
    const draftAtom = roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(userId, roomId, threadId));
    const paragraphs = text
      .split('\n')
      .map((line) => ({ type: BlockType.Paragraph, children: [{ text: line }] } as Descendant));
    store.set(draftAtom, [...store.get(draftAtom), ...paragraphs]);
  });
};

/** Keeps storage-loss recovery from reloading over unsent or in-progress work. */
export const useStorageRecoveryBlocker = (): void => {
  const mx = useMatrixClient();
  const store = useStore();

  useEffect(() => {
    const localEchoes = new Set<MatrixEvent>();
    const trackLocalEcho: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (event) => {
      if (isUnsentLocalEcho(event)) localEchoes.add(event);
      else localEchoes.delete(event);
    };
    mx.on(RoomEvent.LocalEchoUpdated, trackLocalEcho);
    const unregisterBlocker = registerStorageRecoveryBlocker(() =>
      hasUnsavedTransientWork({ store, localEchoes })
    );
    const unregisterPreparation = registerStorageRecoveryPreparation(() => {
      const userId = mx.getUserId();
      if (userId) saveUnsentTextToDrafts({ store, userId, localEchoes });
    });
    return () => {
      mx.removeListener(RoomEvent.LocalEchoUpdated, trackLocalEcho);
      unregisterBlocker();
      unregisterPreparation();
    };
  }, [mx, store]);
};
