import { sanitizeText } from '../../utils/sanitize';

export type MindroomDelegateMember = {
  membership?: string | null;
  userId?: string | null;
};

export const MINDROOM_ROUTER_USER_ID = '@mindroom_router:mindroom.chat';
export const MINDROOM_DELEGATE_AGENT_PATTERN = /^@mindroom_[^:]+:mindroom\.chat$/;
export const MINDROOM_DELEGATE_PROMPT = 'can you address this question?';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getContentMentions = (
  content: Record<string, unknown>
): Record<string, unknown> | undefined =>
  isRecord(content['m.mentions']) ? (content['m.mentions'] as Record<string, unknown>) : undefined;

export const getMindroomDelegateAgents = (members: MindroomDelegateMember[]): string[] => {
  const agents = new Set<string>();

  members.forEach((member) => {
    if (member.membership !== 'join') return;
    if (typeof member.userId !== 'string') return;
    if (member.userId === MINDROOM_ROUTER_USER_ID) return;
    if (!MINDROOM_DELEGATE_AGENT_PATTERN.test(member.userId)) return;
    agents.add(member.userId);
  });

  return Array.from(agents);
};

export const getMindroomDelegateOriginalBody = (content: Record<string, unknown>): string => {
  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;
  const body = newContent?.body ?? content.body;

  return typeof body === 'string' ? body.trim() : '';
};

export const hasMindroomDelegateMention = (content: Record<string, unknown>): boolean => {
  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;
  const mentionSources = [
    getContentMentions(content),
    newContent && getContentMentions(newContent),
  ];

  return mentionSources.some((mentions) => {
    if (!mentions) return false;
    if (mentions.room === true) return true;

    const userIds = mentions.user_ids;
    return Array.isArray(userIds) && userIds.some((userId) => typeof userId === 'string');
  });
};

export const shouldShowMindroomDelegateAction = (options: {
  agents: string[];
  content: Record<string, unknown>;
  eventId?: string;
  senderId?: string;
  threadRootId?: string;
}): boolean => {
  if (options.senderId !== MINDROOM_ROUTER_USER_ID) return false;
  if (!options.eventId) return false;
  if (!options.threadRootId) return false;
  if (options.agents.length === 0) return false;
  if (hasMindroomDelegateMention(options.content)) return false;
  return getMindroomDelegateOriginalBody(options.content).length > 0;
};

export const buildMindroomDelegateMessageContent = (options: {
  originalBody: string;
  routerEventId: string;
  selectedAgentId: string;
  threadRootId: string;
}): Record<string, unknown> => {
  const body = `${options.originalBody}\n\n${options.selectedAgentId}, ${MINDROOM_DELEGATE_PROMPT}`;
  const formattedOriginalBody = sanitizeText(options.originalBody).replace(/\n/g, '<br>');
  const formattedAgentId = sanitizeText(options.selectedAgentId);

  return {
    msgtype: 'm.text',
    body,
    format: 'org.matrix.custom.html',
    formatted_body: `${formattedOriginalBody}<br><br><a href="https://matrix.to/#/${options.selectedAgentId}">${formattedAgentId}</a>, ${MINDROOM_DELEGATE_PROMPT}`,
    'm.mentions': { user_ids: [options.selectedAgentId] },
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: options.threadRootId,
      is_falling_back: false,
      'm.in_reply_to': { event_id: options.routerEventId },
    },
  };
};
