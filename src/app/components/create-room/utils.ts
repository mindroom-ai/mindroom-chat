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

/**
 * Voice rooms let every member publish call membership. The override replaces the whole
 * `events` map, so it repeats the levels servers pin by default, including the upgrade level
 * servers raise above every assignable level where creators are privileged (room version 12).
 */
export const createVoiceRoomPowerLevelsOverride = (version?: string) => ({
  events: {
    [StateEvent.RoomPowerLevels]: 100,
    [StateEvent.RoomServerAcl]: 100,
    [StateEvent.RoomEncryption]: 100,
    [StateEvent.RoomHistoryVisibility]: 100,
    [StateEvent.RoomTombstone]: creatorsSupported(version) ? 150 : 100,








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

export const createRoomParentState = (parent: Room): ICreateRoomStateEvent => ({
  type: StateEvent.SpaceParent,
  state_key: parent.roomId,





















  if (data.parent) initialState.push(createRoomParentState(data.parent));
  const joinRules = createRoomJoinRulesState(data.access, data.parent, data.knock);
  if (joinRules) initialState.push(joinRules);
  if (data.type === RoomType.Call) initialState.push(createRoomCallState());





    visibility: data.access === CreateRoomAccess.Public ? Visibility.Public : Visibility.Private,
    preset: data.access === CreateRoomAccess.Public ? Preset.PublicChat : Preset.PrivateChat,


















      { auto_join: false, suggested: false, via: getViaServers(data.parent) } as never,
      result.room_id
    );
  }

  return result.room_id;
};
