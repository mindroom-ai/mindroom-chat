import { getMxIdLocalPart } from '../../utils/matrix';
import { AI_RUN_METADATA_KEY } from '../messages/aiRun';

/**
 * Matrix username localpart prefix the MindRoom platform assigns to
 * agent-like entities (see mindroom `matrix_identifiers.agent_username_localpart`).
 */
const AGENT_USERNAME_PREFIX = 'mindroom_';

const STREAM_STATUS_KEY = 'io.mindroom.stream_status';
const TOOL_TRACE_KEY = 'io.mindroom.tool_trace';

const AGENT_CONTENT_KEYS = [AI_RUN_METADATA_KEY, STREAM_STATUS_KEY, TOOL_TRACE_KEY];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const isMindroomAgentUserId = (userId: string | undefined): boolean => {
  if (!userId) return false;
  const localpart = getMxIdLocalPart(userId) ?? userId;
  return localpart.toLowerCase().startsWith(AGENT_USERNAME_PREFIX);
};

const hasAgentContentKey = (content: Record<string, unknown>): boolean =>
  AGENT_CONTENT_KEYS.some((key) => content[key] !== undefined);

export const hasMindroomAgentMessageMetadata = (content: unknown): boolean => {
  if (!isRecord(content)) return false;
  if (hasAgentContentKey(content)) return true;

  const newContent = content['m.new_content'];
  return isRecord(newContent) && hasAgentContentKey(newContent);
};

export type AgentIdentityEvent = {
  getSender?(): string | undefined;
  getContent(): Record<string, unknown>;
};

/**
 * Whether a timeline event was produced by a MindRoom agent, detected by the
 * platform's agent username convention with `io.mindroom.*` run/stream/tool
 * message metadata as a fallback for renamed or bridged agent senders.
 */
export const isMindroomAgentMessageEvent = (mEvent: AgentIdentityEvent): boolean =>
  isMindroomAgentUserId(mEvent.getSender?.()) ||
  hasMindroomAgentMessageMetadata(mEvent.getContent());
