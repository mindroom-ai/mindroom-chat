import { getThinkingPlaceholderBody } from './thinkingPlaceholder';

export const MINDROOM_TRANSCRIBING_PLACEHOLDER_BODY = 'Router agent is transcribing…';

const MINDROOM_VISIBLE_ROUTER_VOICE_ECHO_KEY = 'com.mindroom.visible_router_voice_echo';

export const isVisibleRouterVoiceEcho = (content: Record<string, unknown>): boolean =>
  content[MINDROOM_VISIBLE_ROUTER_VOICE_ECHO_KEY] === true;

export const isTranscribingPlaceholder = (content: Record<string, unknown>): boolean =>
  isVisibleRouterVoiceEcho(content) &&
  getThinkingPlaceholderBody(content) === MINDROOM_TRANSCRIBING_PLACEHOLDER_BODY;

const MINDROOM_VOICE_SOURCE_EVENT_ID_KEY = 'com.mindroom.voice_source_event_id';

/** The voice message a router's voice echo transcribes, which newer backends name on each version. */
export const getVoiceSourceEventId = (content: Record<string, unknown>): string | undefined => {
  const id = content[MINDROOM_VOICE_SOURCE_EVENT_ID_KEY];
  return isVisibleRouterVoiceEcho(content) && typeof id === 'string' && id !== '' ? id : undefined;
};
