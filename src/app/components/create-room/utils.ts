import {
  ICreateRoomOpts,
  ICreateRoomStateEvent,
  MatrixClient,
  Preset,
  Room,
  Visibility,
} from 'matrix-js-sdk';
import { JoinRule, RoomType, StateEvent } from '../../../types/matrix/room';
import { getViaServers } from '../../plugins/via-servers';
import { creatorsSupported } from '../../utils/matrix';
import { CreateRoomAccess } from './types';

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
 * Voice rooms let every member publish call membership. The override replaces the whole
 * `events` map (Client-Server API, `m.room.power_levels`), so it repeats the levels servers pin
 * by default. Where creators are privileged (room version 12, MSC4289), servers raise the
 * upgrade (`m.room.tombstone`) level above every assignable level, to 150.
 */
export const createVoiceRoomPowerLevelsOverride = (version?: string) => {
  // Spec `m.room.*` state events, alphabetical.
  const pinned = [



    StateEvent.RoomServerAcl,
  ];
  const events: Record<string, number> = {};
  pinned.forEach((type) => {
    events[type] = PINNED_STATE_LEVEL;
  });
  events[StateEvent.RoomTombstone] = creatorsSupported(version) ? 150 : PINNED_STATE_LEVEL;
  // MSC3401 call membership: any member may join the call.
  events[StateEvent.GroupCallMemberPrefix] = 0;
  return { events };
};





): Record<string, unknown> => {
  const content: Record<string, unknown> = {};
  if (type) content.type = type;
  if (!allowFederation) content['m.federate'] = false;















      content: { join_rule: JoinRule.Public },
    };
  }




      content: {
        join_rule: knock ? JoinRule.KnockRestricted : JoinRule.Restricted,
        allow: [{ type: 'm.room_membership', room_id: parent.roomId }],
      },
    };
  }
  return {
    type: StateEvent.RoomJoinRules,
    state_key: '',
    content: { join_rule: knock ? JoinRule.Knock : JoinRule.Invite },
  };
};

/** `m.space.parent` pointing at `parent`, marked canonical. */
export const createRoomParentState = (parent: Room): ICreateRoomStateEvent => {
  const via = getViaServers(parent);
  return {
    type: StateEvent.SpaceParent,
    state_key: parent.roomId,
    content: { canonical: true, via },
  };
};













};

/** Creates a room (or space, or voice room) and returns its ID; adds it to `parent` if given. */
export const createRoom = async (mx: MatrixClient, data: CreateRoomData): Promise<string> => {
  const { access, parent, type, version } = data;
  const isPublic = access === CreateRoomAccess.Public;
  const isVoice = type === RoomType.Call;

  const initialState = [
    data.encryption ? createRoomEncryptionState() : undefined,
    parent && createRoomParentState(parent),
    createRoomJoinRulesState(access, parent, data.knock),
    isVoice ? createRoomCallState() : undefined,
  ].filter((event): event is ICreateRoomStateEvent => event !== undefined);

  const options: ICreateRoomOpts = {
    room_version: version,
    name: data.name,
    topic: data.topic,
    room_alias_name: data.aliasLocalPart || undefined,
    preset: isPublic ? Preset.PublicChat : Preset.PrivateChat,
    visibility: isPublic ? Visibility.Public : Visibility.Private,





    ),
    ...(isVoice
      ? { power_level_content_override: createVoiceRoomPowerLevelsOverride(version) }
      : {}),
  };

  const result = await mx.createRoom(options);

  const roomId = result.room_id;
  if (parent) {
    const childContent = { via: getViaServers(parent), suggested: false, auto_join: false };
    await mx.sendStateEvent(
      parent.roomId,
      StateEvent.SpaceChild as never,
      childContent as never,
      roomId
    );
  }
  return roomId;
};
