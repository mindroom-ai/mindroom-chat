import { useRef } from 'react';
import { RelationType, type MatrixEvent } from 'matrix-js-sdk';
import { isMindroomAgentUserId } from '../matrix/protocol/agentIdentity';
import {
  MODEL_RESULT,
  MODEL_SELECTION,
  parseModelSelectionResult,
  type ModelSelectionResult,
} from '../models/modelProtocol';

/** A thread's applied model change, as its one line shows it. */
export type ModelChange = {
  /** The command that was answered, whose own row hides. */
  command: MatrixEvent;
  operation: 'set' | 'reset';
  /** The reference a set chose, `key` or `key@level`; a reset names none. */
  model?: string;
  /** Who sent the command. */
  senderId: string;
  threadId: string;
  /** The runtime that applied the change: only its own catalog names the model. */
  runtimeUserId: string;
  runtimeDeviceId: string;
};

/**
 * The model changes a thread draws as one line each, at the acknowledgement's row (`byAckId`),
 * in place of that reply and of the command it answers, whose row hides.
 */
export type ModelChangePlan = {
  hiddenEventIds: ReadonlySet<string>;
  byAckId: ReadonlyMap<string, ModelChange>;
};

export const NO_MODEL_CHANGES: ModelChangePlan = { hiddenEventIds: new Set(), byAckId: new Map() };

/**
 * The root of the thread a message is in by the relation the event itself was sent with, which no
 * edit of it carries; undefined for a root.
 */
const threadRootOf = (event: MatrixEvent): string | undefined => {
  const relation = event.getWireContent()['m.relates_to'];
  return relation?.rel_type === RelationType.Thread ? relation.event_id : undefined;
};

/** What a typed `!model <arg>` or `/model <arg>` names, as MindRoom's command parser reads it. */
const TYPED_MODEL_COMMAND = /^[!/]model[^\S\n]+(\S[^\n]*)$/i;
const RESET_ARGUMENTS = new Set(['reset', 'clear']);

/**
 * Whether a message, as its row shows it, is the change `result` says was applied and
 * nothing else: its text is the command with its one argument (the model's exact reference for a
 * set, `reset` or `clear` for a reset; a model with one of those names is a set, as the backend
 * decides). A picker's structured command must agree with the result's change and runtime,
 * even when a text-only edit no longer carries the structured content.
 */
const isAppliedCommand = (
  command: MatrixEvent,
  content: Record<string, unknown>,
  result: ModelSelectionResult
) => {
  for (const version of [command.getOriginalContent<Record<string, unknown>>(), content]) {
    if (!(MODEL_SELECTION in version)) continue;
    const selection = version[MODEL_SELECTION] as {
      operation?: unknown;
      model?: unknown;
      runtime_user_id?: unknown;
      runtime_device_id?: unknown;
    } | null;
    if (
      selection?.operation !== result.operation ||
      selection.model !== result.model ||
      selection.runtime_user_id !== result.runtime_user_id ||
      selection.runtime_device_id !== result.runtime_device_id
    )
      return false;
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
 * - a trusted account sent the acknowledgement (the room's binding or a joined account from
 *   its roster, excluding ignored accounts), and it is not redacted;
 * - its content, as its row shows it (`getContent`, which counts only the sender's own edits),
 *   holds an applied result (`parseModelSelectionResult`) for this room, for the thread the event
 *   itself was sent in, in the sender's own name;
 * - the command the result names is among `events`: a message in that thread (not its root), not
 *   redacted, from a sender who is neither ignored nor a MindRoom agent (one may send the command
 *   for somebody, whom the line could not name), and answered encrypted when it was encrypted;
 * - that message, as its row shows it, is that change (`isAppliedCommand`).
 *
 * Every other reply and command keeps its row as before: a rejected or uncertain change, a
 * listing, a reply without a result (an older backend's to a typed change), one whose command is
 * not loaded or was edited into something else, a second acknowledgement of one command, and a
 * pair either row of which must stay as it is (`keeps`): one the route or a jump opened, one a
 * plugin hides, one a fork was made at, whose row links to the fork.
 */
export const planModelChanges = ({
  events,
  getContent,
  trustedAccountIds,
  ignored,
  keeps,
}: {
  events: readonly MatrixEvent[];
  getContent: (event: MatrixEvent) => Record<string, unknown>;
  trustedAccountIds: ReadonlySet<string>;
  ignored: ReadonlySet<string>;
  keeps: (eventId: string) => boolean;
}): ModelChangePlan => {
  if (trustedAccountIds.size === 0) return NO_MODEL_CHANGES;
  // Every version of an acknowledgement carries the result, so the cheap read of the first finds them.
  const acks = events.filter((event) => {
    const sender = event.getSender();
    return (
      MODEL_RESULT in event.getOriginalContent() &&
      !event.isRedacted() &&
      !!sender &&
      trustedAccountIds.has(sender) &&
      !ignored.has(sender)
    );
  });
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
      result.thread_id !== threadRootOf(ack) ||
      result.runtime_user_id !== ack.getSender() ||
      result.command_event_id === ackId ||
      keeps(ackId) ||
      keeps(result.command_event_id) ||
      hiddenEventIds.has(result.command_event_id)
    )
      return;
    const command = byId.get(result.command_event_id);
    const senderId = command?.getSender();
    if (
      !command ||
      !senderId ||
      command.getType() !== 'm.room.message' ||
      command.isRedacted() ||
      command.getRoomId() !== result.room_id ||
      ignored.has(senderId) ||
      isMindroomAgentUserId(senderId) ||
      (command.isEncrypted() && !ack.isEncrypted()) ||
      threadRootOf(command) !== result.thread_id ||
      !isAppliedCommand(command, getContent(command), result)
    )
      return;
    hiddenEventIds.add(result.command_event_id);
    byAckId.set(ackId, {
      command,
      operation: result.operation,
      model: result.model,
      senderId,
      threadId: result.thread_id,
      runtimeUserId: result.runtime_user_id,
      runtimeDeviceId: result.runtime_device_id,
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
      other.command === change.command &&
      other.operation === change.operation &&
      other.model === change.model &&
      other.threadId === change.threadId &&
      other.runtimeDeviceId === change.runtimeDeviceId
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
