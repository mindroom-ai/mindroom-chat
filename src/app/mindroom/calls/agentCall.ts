import {
  ClientEvent,
  ICreateRoomStateEvent,
  MatrixClient,
  Preset,
  Room,
  Visibility,
} from 'matrix-js-sdk';
import { RoomType, StateEvent } from '../../../types/matrix/room';
import {
  createRoomCallState,
  createRoomEncryptionState,
  createVoiceRoomPowerLevelsOverride,
} from '../../components/create-room/utils';
import { getMxIdLocalPart } from '../../utils/matrix';
import { getStateEvent } from '../../utils/room';

export const MINDROOM_AGENT_CALL_EVENT_TYPE = 'io.mindroom.agent_call';

export type MindroomAgentCallContent = {
  version: 1;
  agent_user_id: string;
  creator_user_id: string;
  ephemeral: true;
};

const createAgentCallState = (
  creatorUserId: string,
  agentUserId: string
): ICreateRoomStateEvent => ({
  type: MINDROOM_AGENT_CALL_EVENT_TYPE,
  state_key: '',
  content: {
    version: 1,
    agent_user_id: agentUserId,
    creator_user_id: creatorUserId,
    ephemeral: true,
  } satisfies MindroomAgentCallContent,
});

export const createAgentVoiceRoom = async (
  mx: MatrixClient,
  agentUserId: string,
  displayName: string | undefined,
  encrypted: boolean
): Promise<string> => {
  const initialState: ICreateRoomStateEvent[] = [
    createRoomCallState(),
    createAgentCallState(mx.getSafeUserId(), agentUserId),
  ];
  if (encrypted) initialState.unshift(createRoomEncryptionState());

  const result = await mx.createRoom({
    name: `Call with ${displayName ?? getMxIdLocalPart(agentUserId) ?? agentUserId}`,
    invite: [agentUserId],
    visibility: Visibility.Private,
    preset: Preset.TrustedPrivateChat,
    creation_content: {
      type: RoomType.Call,
    },
    power_level_content_override: createVoiceRoomPowerLevelsOverride(),
    initial_state: initialState,
  });

  return result.room_id;
};

export const waitForJoinedRoom = (
  mx: MatrixClient,
  roomId: string,
  timeoutMs = 15_000
): Promise<Room> => {
  const currentRoom = mx.getRoom(roomId);
  if (currentRoom) return Promise.resolve(currentRoom);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      mx.removeListener(ClientEvent.Room, handleRoom);
    };
    const handleRoom = (room: Room) => {
      if (room.roomId !== roomId) return;
      cleanup();
      resolve(room);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('The call room did not become available in time.'));
    }, timeoutMs);

    mx.on(ClientEvent.Room, handleRoom);

    // Avoid missing the room if sync completed between the first lookup and listener setup.
    const roomAfterSubscribe = mx.getRoom(roomId);
    if (roomAfterSubscribe) handleRoom(roomAfterSubscribe);
  });
};

export const getMindroomAgentCallContent = (room: Room): MindroomAgentCallContent | undefined => {
  const content = getStateEvent(room, StateEvent.MindroomAgentCall)?.getContent();
  if (
    content?.version !== 1 ||
    content?.ephemeral !== true ||
    typeof content?.agent_user_id !== 'string' ||
    typeof content?.creator_user_id !== 'string'
  ) {
    return undefined;
  }
  return content as MindroomAgentCallContent;
};

export const cleanupCreatedAgentCall = async (
  mx: MatrixClient,
  roomId: string,
  agentUserId: string
): Promise<void> => {
  try {
    await mx.kick(roomId, agentUserId, 'MindRoom agent call ended');
  } catch {
    // The agent may not have joined yet or may already have left.
  }

  try {
    await mx.leave(roomId);
  } catch {
    // A failed leave remains visible and can be retried from the room menu.
  } finally {
    try {
      await mx.forget(roomId);
    } catch {
      // Leaving is the important cleanup; forgetting can be retried by the SDK/UI later.
    }
  }
};

export const cleanupMindroomAgentCall = async (mx: MatrixClient, room: Room): Promise<void> => {
  const content = getMindroomAgentCallContent(room);
  if (!content || content.creator_user_id !== mx.getUserId()) return;

  await cleanupCreatedAgentCall(mx, room.roomId, content.agent_user_id);
};
