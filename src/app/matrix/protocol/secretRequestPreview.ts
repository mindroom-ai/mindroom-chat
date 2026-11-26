import { isRecord } from '../../lib/isRecord';
import { isMindroomAgentUserIdForViewer } from './agentIdentity';

/**
 * Key of the card an agent posts when it needs the person to type a secret, an `m.notice` with
 * the request under this key. The backend edits the notice (`m.replace`) to set the final status.
 * The request is for a service's key, or for a temporary secret, which names a variable instead.
 */
export const MINDROOM_SECRET_REQUEST_KEY = 'io.mindroom.secret_request';

export type SecretRequestStatus = 'pending' | 'saved' | 'declined' | 'expired';

export type SecretRequestEventLike = {
  getType?(): string | undefined;
  getSender?(): string | undefined;
  getContent?(): Record<string, unknown> | undefined;
  getOriginalContent?(): Record<string, unknown> | undefined;
  isRedacted?(): boolean;
  isRedaction?(): boolean;
  replacingEvent?():
    | {
        getType?(): string | undefined;
        getSender?(): string | undefined;
        getContent?(): Record<string, unknown> | undefined;
        isRedacted?(): boolean;
        isDecryptionFailure?(): boolean;
      }
    | null
    | undefined;
};

const MAX_ID_LENGTH = 512;

const isAnchorId = (value: unknown): value is string =>
  typeof value === 'string' && value !== '' && value.length <= MAX_ID_LENGTH;

const getEffectiveSecretRequestContent = (
  event: SecretRequestEventLike,
  sender: string | undefined,
  original: Record<string, unknown>
): Record<string, unknown> | undefined => {
  const edit = event.replacingEvent?.();
  if (!edit) {
    const content = event.getContent?.() ?? original;
    if (!isRecord(content)) return undefined;
    return isRecord(content['m.new_content']) ? content['m.new_content'] : content;
  }
  const type = edit.getType?.();
  const editSender = edit.getSender?.();
  const content = edit.getContent?.();
  if (
    (type === undefined || type === 'm.room.message') &&
    (editSender === undefined || editSender === sender) &&
    !edit.isRedacted?.() &&
    !edit.isDecryptionFailure?.() &&
    isRecord(content)
  ) {
    if (isRecord(content['m.new_content'])) return content['m.new_content'];
    if (MINDROOM_SECRET_REQUEST_KEY in content) return content;
  }
  return original;
};

const readAnchoredSecretRequestStatus = (
  event: SecretRequestEventLike | null | undefined,
  viewerUserId?: string
): SecretRequestStatus | null => {
  if (!event || event.getType?.() !== 'm.room.message') return null;
  if (event.isRedacted?.() || event.isRedaction?.()) return null;
  const sender = event.getSender?.();
  if (!isMindroomAgentUserIdForViewer(sender, viewerUserId)) return null;
  const original = event.getOriginalContent?.() ?? event.getContent?.();
  if (!isRecord(original) || !isRecord(original[MINDROOM_SECRET_REQUEST_KEY])) return null;
  const effective = getEffectiveSecretRequestContent(event, sender, original);
  const req = effective?.[MINDROOM_SECRET_REQUEST_KEY];
  if (!isRecord(req)) return null;
  const { status, response_event_id: responseEventId, tool_call_id: toolCallId } = req;
  if (
    (status !== 'pending' && status !== 'saved' && status !== 'declined' && status !== 'expired') ||
    !isAnchorId(responseEventId) ||
    !isAnchorId(toolCallId)
  ) {
    return null;
  }
  return status;
};

/** Whether `event` is a trusted MindRoom agent's anchored secret-request notice. */
export const isAnchoredSecretRequestEvent = (
  event: SecretRequestEventLike | null | undefined,
  viewerUserId?: string
): boolean => readAnchoredSecretRequestStatus(event, viewerUserId) !== null;

/**
 * Whether `event` is an anchored secret-request notice with a terminal edited status (`saved`,
 * `declined`, or `expired`) that folds into its anchored reply.
 */
export const isFoldedSecretRequestEvent = (
  event: SecretRequestEventLike | null | undefined,
  viewerUserId?: string
): boolean => {
  const status = readAnchoredSecretRequestStatus(event, viewerUserId);
  return status !== null && status !== 'pending';
};
