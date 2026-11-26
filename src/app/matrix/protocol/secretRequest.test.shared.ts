import { MINDROOM_SECRET_REQUEST_KEY, type SecretRequestStatus } from './secretRequest';

export const secretRequestPayload = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  request_id: 'req-1',
  requester_id: '@reader:example.org',
  env: 'API_TOKEN',
  keep: { memory: 900 },
  reason: 'To deploy',
  status: 'pending' satisfies SecretRequestStatus,
  expires_at: 9_000,
  response_event_id: '$reply',
  tool_call_id: 'call_1',
  ...overrides,
});

export const secretRequestEditContent = (
  targetId: string,
  overrides: Record<string, unknown> = {},
  body = '🔑 Secret received.'
): Record<string, unknown> => ({
  msgtype: 'm.notice',
  body: `* ${body}`,
  'm.new_content': {
    msgtype: 'm.notice',
    body,
    [MINDROOM_SECRET_REQUEST_KEY]: secretRequestPayload({ status: 'saved', ...overrides }),
  },
  'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
});
