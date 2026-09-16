import { type MatrixEvent, type Room } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';

export const CHAT_UI_ACTION_KEY = 'io.mindroom.ui_action';

export const SETTINGS_SECTIONS = [
  'general',
  'account',
  'notifications',
  'devices',
  'emojis-stickers',
  'developer',
  'about',
] as const;
export type ChatUiSettingsSection = typeof SETTINGS_SECTIONS[number];

type ChatUiTarget = {
  eventId: string;
  requesterId: string;
  agentUserId: string;
  roomId: string;
  threadId?: string;
};

export type ChatUiAction = ChatUiTarget &
  (
    | { action: 'show_computer' }
    | { action: 'open_settings'; section: ChatUiSettingsSection }
    | { action: 'open_panel'; panel: 'members' }
  );

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Read authority from the original Matrix event, never from rendered/edited message text. */
export const readChatUiAction = (
  event: MatrixEvent,
  viewerId: string,
  room: Pick<Room, 'roomId' | 'getMember'>
): ChatUiAction | undefined => {
  const eventId = event.getId();
  const sender = event.getSender();
  if (
    !eventId?.startsWith('$') ||
    !sender ||
    event.getType() !== 'm.room.message' ||
    event.getRoomId() !== room.roomId ||
    event.isRedacted() ||
    event.replacingEventId() ||
    event.status ||
    !isMindroomAgentUserIdForViewer(sender, viewerId) ||
    room.getMember(sender)?.membership !== 'join' ||
    room.getMember(viewerId)?.membership !== 'join'
  ) {
    return undefined;
  }

  const content = event.getOriginalContent<Record<string, unknown>>();
  const data = content[CHAT_UI_ACTION_KEY];
  if (
    content.msgtype !== 'm.notice' ||
    !record(data) ||
    data.version !== 1 ||
    data.requester_id !== viewerId ||
    data.agent_user_id !== sender ||
    data.room_id !== room.roomId
  ) {
    return undefined;
  }
  const relation = content['m.relates_to'];
  let threadId: string | undefined;
  if (data.thread_id === null) {
    if (record(relation) && relation.rel_type !== undefined) return undefined;
  } else if (
    typeof data.thread_id === 'string' &&
    data.thread_id.startsWith('$') &&
    record(relation) &&
    relation.rel_type === 'm.thread' &&
    relation.event_id === data.thread_id
  ) {
    threadId = data.thread_id;
  } else {
    return undefined;
  }

  const target: ChatUiTarget = {
    eventId,
    requesterId: viewerId,
    agentUserId: sender,
    roomId: room.roomId,
    threadId,
  };
  if (data.action === 'show_computer') return { ...target, action: 'show_computer' };
  if (
    data.action === 'open_settings' &&
    SETTINGS_SECTIONS.some((section) => section === data.section)
  ) {
    return { ...target, action: 'open_settings', section: data.section as ChatUiSettingsSection };
  }
  if (data.action === 'open_panel' && data.panel === 'members') {
    return { ...target, action: 'open_panel', panel: 'members' };
  }
  return undefined;
};
