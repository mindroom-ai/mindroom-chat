import { useEffect } from 'react';
import { ClientEvent, MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import { LIVE_FRAME_EVENT_TYPE, parseLiveFrame } from '../../matrix/protocol/liveFrame';
import { getLiveReplyStore, type LiveReplyStore } from './liveReplyStore';

/** The patched SDK keeps decryption failures with this id prefix out of its key retries. */
export const SYNTHETIC_EVENT_ID_PREFIX = '$io.mindroom.live.';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Hands the content of each `eventType` frame the client syncs to `receive` until the returned
 * function runs. Room and sender come from the sync section that delivered a frame, never from
 * its content, and only MindRoom's own accounts may send frames. In an encrypted room only
 * encrypted frames count, each decrypted as a room event whose id starts with `idPrefix`.
 * One queue keeps frames in arrival order across asynchronous decryption.
 */
export const bindLiveFrames = (
  mx: MatrixClient,
  eventType: string,
  idPrefix: string,
  receive: (roomId: string, sender: string, content: unknown) => void
): (() => void) => {
  let queue = Promise.resolve();
  let syntheticEvents = 0;
  let bound = true;

  const decryptFrame = async (
    roomId: string,
    sender: string,
    encrypted: Record<string, unknown>,
    ts: number
  ): Promise<unknown> => {
    syntheticEvents += 1;
    const event = new MatrixEvent({
      type: 'm.room.encrypted',
      content: encrypted,
      sender,
      room_id: roomId,
      event_id: `${idPrefix}${syntheticEvents}`,
      origin_server_ts: ts,
    });
    await mx.decryptEventIfNeeded(event);
    if (event.isDecryptionFailure() || event.getType() !== eventType) return undefined;
    return event.getContent();
  };

  const onEvent = (event: MatrixEvent) => {
    if (event.getType() !== eventType) return;
    const roomId = event.getRoomId();
    const sender = event.getSender();
    const room = roomId ? mx.getRoom(roomId) : null;
    if (!roomId || !sender || !room) return;
    if (!isMindroomAgentUserIdForViewer(sender, mx.getUserId() ?? undefined)) return;
    const content = event.getContent();
    const encrypted = room.hasEncryptionStateEvent();
    // An encrypted room accepts only encrypted frames.
    if (encrypted && !isRecord(content.encrypted)) return;
    const ts = event.getTs();
    queue = queue
      .then(async () => {
        const frameContent = encrypted
          ? await decryptFrame(roomId, sender, content.encrypted, ts)
          : content;
        if (bound && frameContent !== undefined) receive(roomId, sender, frameContent);
      })
      // A frame that cannot be read is lost like any other; the queue must keep going.
      .catch(() => undefined);
  };

  mx.on(ClientEvent.Event, onEvent);
  return () => {
    bound = false;
    mx.removeListener(ClientEvent.Event, onEvent);
  };
};

/**
 * Feeds the client's `io.mindroom.live` frames into its live reply store until the returned
 * function runs, which also clears the store.
 */
export const bindLiveReplyFrames = (
  mx: MatrixClient,
  store: LiveReplyStore = getLiveReplyStore(mx)
): (() => void) => {
  const unbind = bindLiveFrames(
    mx,
    LIVE_FRAME_EVENT_TYPE,
    SYNTHETIC_EVENT_ID_PREFIX,
    (roomId, sender, content) => {
      const frame = parseLiveFrame(content);
      if (frame) store.ingest(roomId, sender, frame, Date.now());
    }
  );
  return () => {
    unbind();
    store.clear();
  };
};

/** Keeps the client's live reply store fed while the client is active. */
export const useBindLiveReplyFrames = (mx: MatrixClient) => {
  useEffect(() => bindLiveReplyFrames(mx), [mx]);
};
