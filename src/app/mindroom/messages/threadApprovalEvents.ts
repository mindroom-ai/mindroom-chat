import { MatrixEvent } from 'matrix-js-sdk';
import { isUndecryptedApprovalCandidate, MINDROOM_TOOL_APPROVAL_EVENT } from './toolApproval';

export const mergeThreadApprovalEvents = (
  old: ReadonlyMap<string, MatrixEvent>,
  incoming: readonly MatrixEvent[],
  roomId: string,
  threadId: string,
  fromBackfill = false
): ReadonlyMap<string, MatrixEvent> => {
  let changed = false;
  const next = new Map(old);
  incoming.forEach((event) => {
    const id = event.getId();
    if (!id || event.getRoomId() !== roomId) return;
    const existing = next.get(id);
    if (existing?.isRedacted() && !event.isRedacted()) return;
    const relation = event.getRelation();
    const relevant =
      event.isRedacted() ||
      (event.getType() === MINDROOM_TOOL_APPROVAL_EVENT &&
        (event.getOriginalContent().thread_id === threadId ||
          relation?.rel_type === 'm.replace')) ||
      (isUndecryptedApprovalCandidate(event) &&
        (fromBackfill ||
          (relation?.rel_type === 'm.thread' && relation.event_id === threadId) ||
          (relation?.rel_type === 'm.replace' &&
            !!relation.event_id &&
            next.has(relation.event_id)))) ||
      event.isRedaction();
    if (!relevant) {
      changed = next.delete(id) || changed;
      return;
    }
    changed = true;
    // Keep SDK objects with newer replacements, and never resurrect a redaction.
    if (
      !existing ||
      event.isRedacted() ||
      (isUndecryptedApprovalCandidate(existing) && !isUndecryptedApprovalCandidate(event))
    ) {
      next.set(id, event);
    }
    const replacement = event.replacingEvent();
    const replacementId = replacement?.getId();
    if (replacement && replacementId && !next.get(replacementId)?.isRedacted()) {
      next.set(replacementId, replacement);
    }
  });
  return changed ? next : old;
};
