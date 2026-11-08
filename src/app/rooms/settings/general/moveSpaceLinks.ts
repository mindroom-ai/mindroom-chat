import { EventTimeline, type MatrixClient, type Room } from 'matrix-js-sdk';
import { JoinRule, StateEvent } from '../../../matrix/types/room';
import { isJoined } from '../../../matrix/state/roomList';
import { readAllow } from './joinRules';

const stateOf = (room: Room | null, type: string, stateKey: string) =>
  room?.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getStateEvents(type, stateKey);

const hasVia = (
  content: Record<string, unknown> | undefined
): content is Record<string, unknown> & { via: unknown[] } =>
  Array.isArray(content?.via) && content.via.length > 0;

/**
 * A restricted room's `m.room.join_rules` content that also admits the members of `newRoomId`,
 * when it admits those of `oldRoomId` (Matrix spec, "Restricted rooms"); `undefined` otherwise.
 */
const admitAlso = (
  content: Record<string, unknown> | undefined,
  oldRoomId: string,
  newRoomId: string
): Record<string, unknown> | undefined => {
  const rule = content?.join_rule;
  if (rule !== JoinRule.Restricted && rule !== JoinRule.KnockRestricted) return undefined;
  const allow = readAllow(content);
  const admitsOld = allow.some(
    ({ type, room_id: roomId }) => type === 'm.room_membership' && roomId === oldRoomId
  );
  if (!admitsOld) return undefined;
  return { ...content, allow: [...allow, { type: 'm.room_membership', room_id: newRoomId }] };
};

/**
 * After an upgrade, carries the `m.space.*` links of `oldRoomId` over to the replacement; servers
 * copy none of them (Matrix spec, "Room Upgrades"). The spaces that listed the old room list the
 * replacement instead (`m.space.child`), and the replacement gets the old room's `m.space.parent`
 * links; each is best effort, since a space this account may not change keeps its old child, which
 * the tombstone then leads on from. The replacement also lists the old room's children, and each
 * child that names the old room as its parent names the replacement instead, so a sub-room moves
 * under the replacement and no longer counts as under the old room; such a child that admits the
 * old room's members (`restricted`) admits the replacement's as well. A Space lists its rooms on its
 * own, so their links back to it are best effort, as when a room is added to one; a chat room's
 * sub-room needs its own link to the replacement as well. Resolves to the children that did not
 * come along: one the replacement could not list, and for a chat room one that refused the new
 * parent or the replacement's members, or that this account has not joined.
 */
export const moveSpaceLinks = async (
  client: MatrixClient,
  oldRoomId: string,
  newRoomId: string,
  spaceIds: Iterable<string>
): Promise<string[]> => {
  const oldRoom = client.getRoom(oldRoomId);
  const space = oldRoom?.isSpaceRoom();
  // Right after the upgrade, this account's server is the one surely in the replacement.
  const domain = client.getDomain();
  const send = (roomId: string, type: string, content: object, stateKey: string) =>
    client.sendStateEvent(roomId, type as never, content as never, stateKey);
  const writes: Array<Promise<unknown>> = [];
  const tryToSend = (...args: Parameters<typeof send>) =>
    writes.push(send(...args).catch(() => undefined));

  [...spaceIds].forEach((spaceId) => {
    const child = stateOf(client.getRoom(spaceId), StateEvent.SpaceChild, oldRoomId)?.getContent();
    if (!hasVia(child)) return;
    tryToSend(spaceId, StateEvent.SpaceChild, child, newRoomId);
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
    const rules = admitAlso(
      stateOf(child, StateEvent.RoomJoinRules, '')?.getContent(),
      oldRoomId,
      newRoomId
    );
    const listed = send(newRoomId, StateEvent.SpaceChild, event.getContent(), childId);
    // In turn, so a step that fails leaves the child as the steps before it left it: the child
    // names the replacement once it lists the child, admits the replacement's members, and lets go
    // of the old room after that.
    const relink = async () => {
      if (!hasVia(parent)) return;
      const via = domain ? [domain] : parent.via;
      await send(childId, StateEvent.SpaceParent, { ...parent, via }, newRoomId);
      if (rules) await send(childId, StateEvent.RoomJoinRules, rules, '');
      await send(childId, StateEvent.SpaceParent, {}, oldRoomId);
    };
    try {
      await listed;
      // A Space's rooms come along on its listing alone.
      await (space ? relink().catch(() => undefined) : relink());
    } catch {
      return childId;
    }
    return joined || space ? undefined : childId;
  });

  const [unmoved] = await Promise.all([Promise.all(moved), Promise.all(writes)]);
  return unmoved.filter((childId): childId is string => childId !== undefined);
};
