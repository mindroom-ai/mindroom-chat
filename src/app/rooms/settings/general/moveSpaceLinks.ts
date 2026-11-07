import { EventTimeline, type MatrixClient, type Room } from 'matrix-js-sdk';
import { StateEvent } from '../../../matrix/types/room';
import { isJoined } from '../../../matrix/state/roomList';

const stateOf = (room: Room | null, type: string, stateKey: string) =>
  room?.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getStateEvents(type, stateKey);

const hasVia = (content: Record<string, unknown> | undefined): boolean =>
  Array.isArray(content?.via) && content.via.length > 0;

/**
 * After an upgrade, carries the `m.space.*` links of `oldRoomId` over to the replacement; servers
 * copy none of them (Matrix spec, "Room Upgrades"). The spaces that listed the old room list the
 * replacement instead (`m.space.child`), and the replacement gets the old room's `m.space.parent`
 * links; each is best effort, since a space this account may not change keeps its old child, which
 * the tombstone then leads on from. The replacement also lists the old room's children, and each
 * child that names the old room as its parent names the replacement too, so a sub-room stays
 * under its room. Resolves to the children that did not come along: one the replacement could not
 * list, one that refused the new parent, or a chat room's child this account has not joined and so
 * cannot point at the replacement (a Space lists its rooms on its own; a chat room's sub-room
 * needs its own link too).
 */
export const moveSpaceLinks = async (
  client: MatrixClient,
  oldRoomId: string,
  newRoomId: string,
  spaceIds: Iterable<string>
): Promise<string[]> => {
  const oldRoom = client.getRoom(oldRoomId);
  const send = (roomId: string, type: string, content: object, stateKey: string) =>
    client.sendStateEvent(roomId, type as never, content as never, stateKey);
  const writes: Array<Promise<unknown>> = [];
  const tryToSend = (...args: Parameters<typeof send>) =>
    writes.push(send(...args).catch(() => undefined));

  [...spaceIds].forEach((spaceId) => {
    const child = stateOf(client.getRoom(spaceId), StateEvent.SpaceChild, oldRoomId)?.getContent();
    if (!hasVia(child)) return;
    tryToSend(spaceId, StateEvent.SpaceChild, child as object, newRoomId);
    tryToSend(spaceId, StateEvent.SpaceChild, {}, oldRoomId);
  });

  const oldState = oldRoom?.getLiveTimeline().getState(EventTimeline.FORWARDS);
  oldState?.getStateEvents(StateEvent.SpaceParent).forEach((parent) => {
    const content = parent.getContent();
    const spaceId = parent.getStateKey();
    if (spaceId && hasVia(content)) tryToSend(newRoomId, StateEvent.SpaceParent, content, spaceId);
  });

  const moved = (oldState?.getStateEvents(StateEvent.SpaceChild) ?? []).map(async (event) => {
    const childId = event.getStateKey();
    if (!childId || !hasVia(event.getContent())) return undefined;
    const child = client.getRoom(childId);
    const joined = !!child && isJoined(child);
    const parent = joined
      ? stateOf(child, StateEvent.SpaceParent, oldRoomId)?.getContent()
      : undefined;
    try {
      await Promise.all([
        send(newRoomId, StateEvent.SpaceChild, event.getContent(), childId),
        hasVia(parent) && send(childId, StateEvent.SpaceParent, parent as object, newRoomId),
      ]);
    } catch {
      return childId;
    }
    return joined || oldRoom?.isSpaceRoom() ? undefined : childId;
  });

  const [unmoved] = await Promise.all([Promise.all(moved), Promise.all(writes)]);
  return unmoved.filter((childId): childId is string => childId !== undefined);
};
