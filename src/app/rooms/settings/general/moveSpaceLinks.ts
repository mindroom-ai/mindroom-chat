import { EventTimeline, type MatrixClient, type Room } from 'matrix-js-sdk';
import { StateEvent } from '../../../matrix/types/room';

const stateOf = (room: Room | null, type: string, stateKey: string) =>
  room?.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getStateEvents(type, stateKey);

const hasVia = (content: Record<string, unknown> | undefined): boolean =>
  Array.isArray(content?.via) && content.via.length > 0;

/**
 * After an upgrade, points the spaces that listed `oldRoomId` at the replacement instead
 * (`m.space.child`), and gives the replacement the old room's `m.space.parent` links; servers
 * copy neither (Matrix spec, "Room Upgrades"). Each link is best effort: a space this account
 * may not change keeps its old child, which the tombstone then leads on from.
 */
export const moveSpaceLinks = async (
  client: MatrixClient,
  oldRoomId: string,
  newRoomId: string,
  spaceIds: Iterable<string>
): Promise<void> => {
  const oldRoom = client.getRoom(oldRoomId);
  const writes: Array<Promise<unknown>> = [];
  const send = (roomId: string, type: string, content: object, stateKey: string) =>
    writes.push(
      client
        .sendStateEvent(roomId, type as never, content as never, stateKey)
        .catch(() => undefined)
    );

  [...spaceIds].forEach((spaceId) => {
    const child = stateOf(client.getRoom(spaceId), StateEvent.SpaceChild, oldRoomId)?.getContent();
    if (!hasVia(child)) return;
    send(spaceId, StateEvent.SpaceChild, child as object, newRoomId);
    send(spaceId, StateEvent.SpaceChild, {}, oldRoomId);
  });

  oldRoom
    ?.getLiveTimeline()
    .getState(EventTimeline.FORWARDS)
    ?.getStateEvents(StateEvent.SpaceParent)
    .forEach((parent) => {
      const content = parent.getContent();
      const spaceId = parent.getStateKey();
      if (spaceId && hasVia(content)) send(newRoomId, StateEvent.SpaceParent, content, spaceId);
    });

  await Promise.all(writes);
};
