import {
  EventType,
  ICreateRoomOpts,
  ICreateRoomStateEvent,
  KnownMembership,
  MatrixClient,
  MatrixError,
  Preset,
  Room,
  Visibility,
} from 'matrix-js-sdk';
import { JoinRule, RoomType, StateEvent } from './types/room';
import type { MDirectContent } from './types/accountData';
import { getViaServers } from './via-servers';
import { addRoomIdToMDirect, creatorsSupported } from './matrix';
import { CreateRoomAccess } from './createRoomTypes';
import { MINDROOM_AUTO_APPROVE_EVENT } from './protocol/autoApproveContract';
import { MINDROOM_BACKGROUND_JOBS_EVENT } from './protocol/backgroundJobsContract';
import { ROOM_THREAD_MODE_EVENT } from './protocol/roomThreadMode';

const MEGOLM_ALGORITHM = 'm.megolm.v1.aes-sha2';
const GROUP_CALL_STATE_EVENT = 'org.matrix.msc3401.call';

export const createRoomEncryptionState = (): ICreateRoomStateEvent => ({
  type: StateEvent.RoomEncryption,
  state_key: '',
  content: { algorithm: MEGOLM_ALGORITHM },
});

/** Marks a call room as holding one ongoing group call (MSC3401). */
export const createRoomCallState = (): ICreateRoomStateEvent => ({
  type: GROUP_CALL_STATE_EVENT,
  state_key: '',
  content: {},
});

/** The level servers pin by default for the room's security-relevant state. */
const PINNED_STATE_LEVEL = 100;

/**
 * Lets every member publish call membership, so anyone in the room can start or join its call,
 * and the state MindRoom's agents publish; the presets alone keep both at the state default (50),
 * for moderators. The override replaces the whole `events` map (Client-Server API,
 * `m.room.power_levels`), so it repeats the levels servers pin by default. Where creators are
 * privileged (room version 12, MSC4289), servers raise the upgrade (`m.room.tombstone`) level
 * above every assignable level, to 150.
 */
export const createRoomPowerLevelsOverride = (version?: string) => {
  const events: Record<string, number> = {
    [StateEvent.RoomEncryption]: PINNED_STATE_LEVEL,
    [StateEvent.RoomHistoryVisibility]: PINNED_STATE_LEVEL,
    [StateEvent.RoomPowerLevels]: PINNED_STATE_LEVEL,
    [StateEvent.RoomServerAcl]: PINNED_STATE_LEVEL,
    [StateEvent.RoomTombstone]: creatorsSupported(version) ? 150 : PINNED_STATE_LEVEL,
    // MSC3401 call membership: any member may join the call.
    [StateEvent.GroupCallMemberPrefix]: 0,
    // State MindRoom's agents and router publish; they join with no power. The client reads
    // server, jobs and auto-approve state only from an agent under its own user ID, a state key
    // Matrix accepts only from that user; any member may write thread tags and the thread mode.
    // The rooms MindRoom creates open the same types but the thread mode, which their router
    // writes as an admin; the router of a room made here is not known when it is made.
    'io.mindroom.server': 0,
    [MINDROOM_BACKGROUND_JOBS_EVENT]: 0,
    [MINDROOM_AUTO_APPROVE_EVENT]: 0,
    'com.mindroom.thread.tags': 0,
    [ROOM_THREAD_MODE_EVENT]: 0,
  };
  return { events };
};

/**
 * The new room's `creation_content` (Client-Server API, `POST /createRoom`): its room type, and
 * `m.federate: false` when only users of this server may ever join.
 */
const createRoomCreationContent = ({
  type,
  allowFederation,
}: Pick<CreateRoomData, 'type' | 'allowFederation'>): Record<string, unknown> => {
  const content: Record<string, unknown> = {};
  if (type) content.type = type;
  if (!allowFederation) content['m.federate'] = false;
  return content;
};

/**
 * The `m.room.join_rules` state for `access`. A restricted room admits the members of `parent`;
 * with `knock`, everyone else may ask to join (`knock_restricted`, or `knock` for invite-only).
 */
const createRoomJoinRulesState = ({
  access,
  parent,
  knock,
}: Pick<CreateRoomData, 'access' | 'parent' | 'knock'>): ICreateRoomStateEvent => {
  const joinRules = (content: Record<string, unknown>): ICreateRoomStateEvent => ({
    type: StateEvent.RoomJoinRules,
    state_key: '',
    content,
  });
  if (access === CreateRoomAccess.Public) return joinRules({ join_rule: JoinRule.Public });
  if (access === CreateRoomAccess.Restricted && parent) {
    return joinRules({
      join_rule: knock ? JoinRule.KnockRestricted : JoinRule.Restricted,
      allow: [{ type: 'm.room_membership', room_id: parent.roomId }],
    });
  }
  return joinRules({ join_rule: knock ? JoinRule.Knock : JoinRule.Invite });
};

/** `m.space.parent` pointing at `parent`, marked canonical. */
const createRoomParentState = (parent: Room): ICreateRoomStateEvent => {
  const via = getViaServers(parent);
  return {
    type: StateEvent.SpaceParent,
    state_key: parent.roomId,
    content: { canonical: true, via },
  };
};

/** What the room is called and how people find it. */
type RoomIdentity = {
  name: string;
  topic?: string;
  /** Local part of the room alias; the room gets none when left out. */
  aliasLocalPart?: string;
};

/** Who may join the room and which protocol features it uses. */
type RoomPolicy = {
  access: CreateRoomAccess;
  knock: boolean;
  /** Room version; the server default when left out. */
  version?: string;
  allowFederation: boolean;
  encryption?: boolean;
};

/** What `createRoom` needs; `CreateRoomForm` fills it in from the form. */
export type CreateRoomData = RoomIdentity &
  RoomPolicy & {
    /** `RoomType.Space` or `RoomType.Call`; a chat room when left out. */
    type?: RoomType;
    /** The room or space that lists the new room (`m.space.child`). */
    parent?: Room;
  };

/**
 * Creates a room (or space, or voice room) and returns its ID; adds it to `parent` if given. When
 * the server refuses to list a room that is not public under `parent`, it leaves and forgets the
 * room, if the server lets it, before it throws.
 */
export const createRoom = async (client: MatrixClient, data: CreateRoomData): Promise<string> => {
  const { access, parent, type, version } = data;
  const isPublic = access === CreateRoomAccess.Public;
  const isVoice = type === RoomType.Call;

  const initialState = [
    data.encryption ? createRoomEncryptionState() : undefined,
    parent && createRoomParentState(parent),
    createRoomJoinRulesState(data),
    isVoice ? createRoomCallState() : undefined,
  ].filter((event): event is ICreateRoomStateEvent => event !== undefined);

  const options: ICreateRoomOpts = {
    room_version: version,
    name: data.name,
    topic: data.topic,
    room_alias_name: data.aliasLocalPart || undefined,
    preset: isPublic ? Preset.PublicChat : Preset.PrivateChat,
    visibility: isPublic ? Visibility.Public : Visibility.Private,
    initial_state: initialState,
    creation_content: createRoomCreationContent(data),
    // Spaces hold rooms rather than calls; every other room lets its members call and its agents
    // publish their state.
    ...(type === RoomType.Space
      ? {}
      : { power_level_content_override: createRoomPowerLevelsOverride(version) }),
  };

  const result = await client.createRoom(options);

  const roomId = result.room_id;
  if (parent) {
    const childContent = { via: getViaServers(parent), suggested: false, auto_join: false };
    try {
      await client.sendStateEvent(
        parent.roomId,
        StateEvent.SpaceChild as never,
        childContent as never,
        roomId
      );
    } catch (failure) {
      // A refusal (a Matrix error below 500) leaves the room listed nowhere, hidden from the
      // parent's members, and trying again would create another: leave and forget it, unless it is
      // public, where anyone finds it and its address would stay taken. After any other failure the
      // server may still list it, so the room stays.
      const refused = failure instanceof MatrixError && (failure.httpStatus ?? 500) < 500;
      if (refused && !isPublic) {
        await client
          .leave(roomId)
          .then(() => client.forget(roomId))
          .catch(() => undefined);
      }
      throw failure;
    }
  }
  return roomId;
};

/** A joined room the account's `m.direct` lists as its direct chat with `userId`, if any. */
export const findDirectRoom = (client: MatrixClient, userId: string): string | undefined => {
  const listed = client.getAccountData(EventType.Direct)?.getContent<MDirectContent>()[userId];
  return listed?.find(
    (roomId) => client.getRoom(roomId)?.getMyMembership() === KnownMembership.Join
  );
};

/**
 * Starts a direct chat with `userId` and returns its room ID: a private room that invites them
 * with the invite marked `is_direct`, encrypted unless `encryption` is false, then listed under
 * them in the account's `m.direct`. `version` is the room version the server will use.
 */
export const createDirectRoom = async (
  client: MatrixClient,
  userId: string,
  { encryption = true, version }: { encryption?: boolean; version?: string } = {}
): Promise<string> => {
  const { room_id: roomId } = await client.createRoom({
    invite: [userId],
    is_direct: true,
    initial_state: encryption ? [createRoomEncryptionState()] : [],
    // Spec "Creation" presets: trusted_private_chat gives the invitee the creator's power.
    preset: Preset.TrustedPrivateChat,
    visibility: Visibility.Private,
    // Someone invited later joins its calls too, not only the two who started it, and an agent
    // invited later publishes its state.
    power_level_content_override: createRoomPowerLevelsOverride(version),
  });
  await addRoomIdToMDirect(client, roomId, userId);
  return roomId;
};
