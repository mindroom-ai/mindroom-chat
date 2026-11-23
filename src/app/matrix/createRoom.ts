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
import { getPowersLevelFromMatrixEvent, readPowerLevel } from './hooks/usePowerLevels';
import { getRoomCreators } from './hooks/useRoomCreators';
import { MINDROOM_AUTO_APPROVE_EVENT } from './protocol/autoApproveContract';
import { MINDROOM_ACTIVE_RUNS_EVENT } from './protocol/activeRunsContract';
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
    // State MindRoom accounts can publish at level 0. Agents publish server and jobs state
    // under their own user IDs; the steward does the same for auto-approve and the roster.
    // Only the account named by a user ID state key can write it. Any member may write thread
    // tags and the thread mode. Rooms MindRoom creates open the same types.
    'io.mindroom.server': 0,
    [MINDROOM_BACKGROUND_JOBS_EVENT]: 0,
    [MINDROOM_ACTIVE_RUNS_EVENT]: 0,
    [MINDROOM_AUTO_APPROVE_EVENT]: 0,
    'io.mindroom.accounts': 0,
    'com.mindroom.thread.tags': 0,
    [ROOM_THREAD_MODE_EVENT]: 0,
  };
  return { events };
};

/**
 * Returns updated `m.room.power_levels` content with any missing `required` event levels added,
 * preserving explicit overrides, or `undefined` when every required event type already has a level.
 */
export const mergeMissingEventPowerLevels = (
  powerLevels: Record<string, unknown>,
  required: Record<string, number>
): Record<string, unknown> | undefined => {
  const existing = (powerLevels.events as Record<string, unknown> | undefined) ?? {};
  const missing = Object.entries(required).filter(([type]) => existing[type] === undefined);
  if (missing.length === 0) return undefined;
  return { ...powerLevels, events: { ...existing, ...Object.fromEntries(missing) } };
};

const activeRunsCheckedRooms = new WeakMap<MatrixClient, Set<string>>();
const activeRunsInFlightRooms = new WeakMap<MatrixClient, Set<string>>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const markActiveRunsChecked = (mx: MatrixClient, roomId: string) => {
  const checked = activeRunsCheckedRooms.get(mx);
  if (checked) checked.add(roomId);
  else activeRunsCheckedRooms.set(mx, new Set([roomId]));
};

/**
 * Best-effort, once-per-room-per-session power-level migration for existing MindRoom rooms created
 * before `io.mindroom.active_runs`: pre-checks local state to avoid network traffic on rooms that
 * do not qualify, then reads fresh `m.room.power_levels` from the homeserver before adding
 * `io.mindroom.active_runs: 0` when the room still allows `io.mindroom.background_jobs: 0`,
 * leaving explicit overrides and concurrent power-level changes intact.
 */
export const ensureActiveRunsPowerLevel = async (
  mx: MatrixClient,
  room: Room
): Promise<boolean> => {
  if (activeRunsCheckedRooms.get(mx)?.has(room.roomId)) return false;
  if (activeRunsInFlightRooms.get(mx)?.has(room.roomId)) return false;

  const powerLevelsEvent = room.currentState
    ?.getStateEvents?.(StateEvent.RoomPowerLevels)
    ?.find((event) => event.getStateKey() === '');
  if (!powerLevelsEvent) return false;
  const localContent = powerLevelsEvent.getContent();
  if (localContent.events?.[MINDROOM_BACKGROUND_JOBS_EVENT] !== 0) return false;
  if (localContent.events?.[MINDROOM_ACTIVE_RUNS_EVENT] !== undefined) return false;
  const userId = mx.getUserId();
  if (!userId) return false;
  const parsed = getPowersLevelFromMatrixEvent(powerLevelsEvent);
  const createEvent = room.currentState
    ?.getStateEvents?.(StateEvent.RoomCreate)
    ?.find((event) => event.getStateKey() === '');
  const isCreator = createEvent ? getRoomCreators(createEvent).has(userId) : false;
  const canEdit =
    isCreator ||
    readPowerLevel.user(parsed, userId) >= readPowerLevel.state(parsed, StateEvent.RoomPowerLevels);
  if (!canEdit) return false;

  let inFlight = activeRunsInFlightRooms.get(mx);
  if (!inFlight) {
    inFlight = new Set();
    activeRunsInFlightRooms.set(mx, inFlight);
  }
  inFlight.add(room.roomId);
  try {
    const freshContent: unknown = await mx.getStateEvent(
      room.roomId,
      StateEvent.RoomPowerLevels,
      ''
    );
    if (!isRecord(freshContent)) return false;
    const freshEvents = isRecord(freshContent.events) ? freshContent.events : undefined;
    if (freshEvents?.[MINDROOM_BACKGROUND_JOBS_EVENT] !== 0) {
      markActiveRunsChecked(mx, room.roomId);
      return false;
    }
    const nextLevels = mergeMissingEventPowerLevels(freshContent, {
      [MINDROOM_ACTIVE_RUNS_EVENT]: 0,
    });
    if (!nextLevels) {
      markActiveRunsChecked(mx, room.roomId);
      return false;
    }
    await mx.sendStateEvent(
      room.roomId,
      StateEvent.RoomPowerLevels as never,
      nextLevels as never,
      ''
    );
    markActiveRunsChecked(mx, room.roomId);
    return true;
  } catch {
    return false;
  } finally {
    inFlight.delete(room.roomId);
  }
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
 * them in the account's `m.direct`. `version` is the room version the server will use;
 * `onCreated` hears of the room before it is listed, which may fail.
 */
export const createDirectRoom = async (
  client: MatrixClient,
  userId: string,
  {
    encryption = true,
    version,
    onCreated,
  }: { encryption?: boolean; version?: string; onCreated?: (roomId: string) => void } = {}
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
  onCreated?.(roomId);
  await addRoomIdToMDirect(client, roomId, userId);
  return roomId;
};
