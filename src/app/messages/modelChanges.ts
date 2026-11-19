import { useRef } from 'react';
import { EventType, RelationType, type MatrixEvent } from 'matrix-js-sdk';
import { isMindroomAgentUserId } from '../matrix/protocol/agentIdentity';
import {
  MODEL_RESULT,
  MODEL_SELECTION,
  parseModelSelectionResult,
  type ModelSelectionResult,
} from '../models/modelProtocol';

/** A thread's model change the router applied, as its one line shows it. */
export type ModelChange = {
  /** The command the router answered, whose own row hides. */
  commandId: string;
  operation: 'set' | 'reset';
  /** The reference a set chose, `key` or `key@level`; a reset names none. */
  model?: string;
  /** Who sent the command. */
  senderId: string;
  threadId: string;
};

/**
 * The model changes a thread draws as one line each, at the row of the router's acknowledgement
 * (`byAckId`), in place of that reply and of the command it answers, whose row hides.
 */
export type ModelChangePlan = {
  hiddenEventIds: ReadonlySet<string>;
  byAckId: ReadonlyMap<string, ModelChange>;
};

export const NO_MODEL_CHANGES: ModelChangePlan = { hiddenEventIds: new Set(), byAckId: new Map() };

/** The root of the thread a message is in by its own relation; undefined for a root or an edit. */
const threadRootOf = (content: Record<string, unknown>): string | undefined => {
  const relation = content['m.relates_to'] as
    | { rel_type?: unknown; event_id?: unknown }
    | undefined;
  return relation?.rel_type === RelationType.Thread && typeof relation.event_id === 'string'
    ? relation.event_id
    : undefined;
};

/** What a typed `!model <arg>` or `/model <arg>` names, as MindRoom's command parser reads it. */
const TYPED_MODEL_COMMAND = /^[!/]model[^\S\n]+(\S[^\n]*)$/i;
const RESET_ARGUMENTS = new Set(['reset', 'clear']);

/**
 * Whether a message, as its row shows it, is the change `result` says the router applied: the
 * picker's command by its structured operation, a typed one by its one argument (the model's
 * exact reference for a set, `reset` or `clear` for a reset; a model with one of those names is
 * a set, as the router decides). A command that carries the structured key is never read as text.
 */
const isAppliedCommand = (content: Record<string, unknown>, result: ModelSelectionResult) => {
  if (MODEL_SELECTION in content) {
    const selection = content[MODEL_SELECTION] as { operation?: unknown; model?: unknown } | null;
    return (
      !!selection &&
      typeof selection === 'object' &&
      selection.operation === result.operation &&
      selection.model === result.model
    );
  }
  const argument =
    typeof content.body === 'string'
      ? TYPED_MODEL_COMMAND.exec(content.body.trim())?.[1]?.trim()
      : undefined;
  if (argument === undefined) return false;
  return result.operation === 'set'
    ? argument === result.model
    : RESET_ARGUMENTS.has(argument.toLowerCase());
};

/**
 * Which model changes of `events` (an open thread's rows) show as one line. A change counts when
 * every part of it is proven by the events themselves, never by what a reply's text says:
 *
 * - the room's router sent the acknowledgement (`routerUserId`, which the room's state names and
 *   `trustedRouterUserId` trusts; none while it names none or the viewer ignores it), and it is
 *   not redacted;
 * - its content, as its row shows it (`getContent`, which counts only the sender's own edits),
 *   holds an applied result (`parseModelSelectionResult`) for this room, for the thread its own
 *   relation puts it in, in the router's own name;
 * - the command the result names is among `events`: a message in that thread (not its root), not
 *   redacted, from a sender who is neither ignored nor a MindRoom agent (one may send the command
 *   for somebody, whom the line could not name), and answered encrypted when it was encrypted;
 * - that message, as its row shows it, is that change (`isAppliedCommand`).
 *
 * Every other reply and command keeps its row as before: a rejected or uncertain change, a
 * listing, a reply without a result (an older backend's to a typed change), one whose command is
 * not loaded or was edited into something else, a row the route or a jump opened (`revealed`),
 * and a second acknowledgement of one command.
 */
export const planModelChanges = ({
  events,
  getContent,
  routerUserId,
  ignored,
  revealed,
}: {
  events: readonly MatrixEvent[];
  getContent: (event: MatrixEvent) => Record<string, unknown>;
  routerUserId: string | undefined;
  ignored: ReadonlySet<string>;
  revealed: ReadonlySet<string>;
}): ModelChangePlan => {
  if (!routerUserId || ignored.has(routerUserId)) return NO_MODEL_CHANGES;
  // Every version of an acknowledgement carries the result, so the cheap read of the first finds them.
  const acks = events.filter(
    (event) =>
      MODEL_RESULT in event.getOriginalContent() &&
      !event.isRedacted() &&
      event.getSender() === routerUserId
  );
  if (acks.length === 0) return NO_MODEL_CHANGES;
  const byId = new Map(events.map((event) => [event.getId(), event]));
  const hiddenEventIds = new Set<string>();
  const byAckId = new Map<string, ModelChange>();
  acks.forEach((ack) => {
    const ackId = ack.getId();
    const ackContent = getContent(ack);
    const result = parseModelSelectionResult(ackContent[MODEL_RESULT]);
    if (
      !ackId ||
      !result ||
      result.status !== 'applied' ||
      !result.thread_id ||
      result.room_id !== ack.getRoomId() ||
      result.thread_id !== threadRootOf(ackContent) ||
      result.runtime_user_id !== routerUserId ||
      result.command_event_id === ackId ||
      revealed.has(ackId) ||
      revealed.has(result.command_event_id) ||
      hiddenEventIds.has(result.command_event_id)
    )
      return;
    const command = byId.get(result.command_event_id);
    const senderId = command?.getSender();
    if (
      !command ||
      !senderId ||
      command.getType() !== EventType.RoomMessage ||
      command.isRedacted() ||
      command.getRoomId() !== result.room_id ||
      ignored.has(senderId) ||
      isMindroomAgentUserId(senderId) ||
      (command.isEncrypted() && !ack.isEncrypted())
    )
      return;
    const commandContent = getContent(command);
    if (
      threadRootOf(commandContent) !== result.thread_id ||
      !isAppliedCommand(commandContent, result)
    )
      return;
    hiddenEventIds.add(result.command_event_id);
    byAckId.set(ackId, {
      commandId: result.command_event_id,
      operation: result.operation,
      model: result.model,
      senderId,
      threadId: result.thread_id,
    });
  });
  return byAckId.size === 0 ? NO_MODEL_CHANGES : { hiddenEventIds, byAckId };
};

/** Whether two plans draw the same: the timeline keeps the older, so its rows do not redraw. */
export const sameModelChangePlan = (a: ModelChangePlan, b: ModelChangePlan): boolean =>
  a.byAckId.size === b.byAckId.size &&
  [...a.byAckId].every(([ackId, change]) => {
    const other = b.byAckId.get(ackId);
    return (
      !!other &&
      other.commandId === change.commandId &&
      other.operation === change.operation &&
      other.model === change.model &&
      other.senderId === change.senderId &&
      other.threadId === change.threadId
    );
  });

/**
 * `planModelChanges` made again on each render, so a change whose rows decrypt or load becomes
 * its line on the next one: finding the acknowledgements reads one key of each event. A plan that
 * draws the same as the last is the last, so the timeline's rows do not redraw.
 */
export const useModelChangePlan = (
  input: Parameters<typeof planModelChanges>[0]
): ModelChangePlan => {
  const last = useRef(NO_MODEL_CHANGES);
  const plan = planModelChanges(input);
  if (!sameModelChangePlan(plan, last.current)) last.current = plan;
  return last.current;
};
