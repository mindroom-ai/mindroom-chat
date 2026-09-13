import { getMindroomThinkingPlaceholderBody } from './thinkingPlaceholder';

export const MINDROOM_TRANSCRIBING_PLACEHOLDER_BODY = 'Router agent is transcribing…';

const MINDROOM_VISIBLE_ROUTER_VOICE_ECHO_KEY = 'com.mindroom.visible_router_voice_echo';

export const isMindroomTranscribingPlaceholder = (content: Record<string, unknown>): boolean =>
  content[MINDROOM_VISIBLE_ROUTER_VOICE_ECHO_KEY] === true &&
  getMindroomThinkingPlaceholderBody(content) === MINDROOM_TRANSCRIBING_PLACEHOLDER_BODY;
