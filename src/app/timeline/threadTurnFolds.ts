import type { MatrixEvent } from 'matrix-js-sdk';
import { getTimelineMessageKind } from '../event-store/timeline/timelineRowTypes';
import { inSameDay } from '../lib/time';
import {
  isMindroomAgentMessageEvent,
  isMindroomAgentUserId,
} from '../matrix/protocol/agentIdentity';
import { isRowlessTimelineEvent } from './timelineRowFold';

/**
 * Who wrote a thread row, for its turns: a person's message or sticker starts a turn, an agent's
 * message can answer one, and a row that cannot tell (a message not decrypted, whoever sent it: an
 * agent's could be its answer) keeps its turn unfolded. Other rows (approval cards, state notices)
 * are neither. A redacted message keeps only its sender, as the minimap reads it.
 */
export type ThreadRowAuthor = 'person' | 'agent' | 'unknown' | 'none';

export const threadRowAuthor = (event: MatrixEvent): ThreadRowAuthor => {
  if (event.getStateKey() !== undefined) return 'none';
  const kind = getTimelineMessageKind(event.getType());
  if (kind !== 'message' && kind !== 'sticker' && kind !== 'encrypted') return 'none';
  const byAgentName = isMindroomAgentUserId(event.getSender());
  if (event.isRedacted()) return byAgentName ? 'agent' : 'person';
  if (kind === 'encrypted' || event.isDecryptionFailure?.()) return 'unknown';
  return isMindroomAgentMessageEvent(event) ? 'agent' : 'person';
};

/**
 * A finished turn of an open thread whose rows between the person's message and the agent's
 * answer fold behind one break (`TurnBreak`), as a long reply folds its work (`FinishedWorkFold`).
 */
export type ThreadTurnFold = {
  /** The person's message that starts the turn: the reader's choice is kept under its ID. */
  key: string;
  /** The rows between that message and the answer, in order; the first one draws the break. */
  hiddenIds: readonly string[];
  /** How many of them are messages, not quiet markers: what the break counts. */
  count: number;
  /** The turn's answer, the last message an agent wrote in it, which stays in view. */
  answerId: string;
};

export type ThreadTurnRules = {
  /** A message from a person, not an agent, which ends the turn before it and starts its own. */
  isPersonMessage: (event: MatrixEvent) => boolean;
  /** A row that renders nothing here already: another plan, a plugin, an ignored sender. */
  isSkipped: (event: MatrixEvent) => boolean;
  /** An agent's message that can answer a turn: neither a quiet marker nor a notice. */
  isAnswer: (event: MatrixEvent) => boolean;
  /** A row that renders as a quiet marker line, such as the thread's title. */
  isQuietMarker: (event: MatrixEvent) => boolean;
  /** A row that keeps its turn unfolded: a reply still streaming, a request waiting on the reader. */
  holdsTurn: (event: MatrixEvent) => boolean;
  /** Rows that must stay in view: one the route or a jump opened, one a fork's line sits on. */
  pinnedIds: ReadonlySet<string>;
  /** The thread still works on its newest turn: a reply streams, a background job runs. */
  lastTurnBusy: boolean;
};

/** Fewer messages than this between a turn's question and its answer leave the turn unfolded. */
export const MIN_FOLDED_MESSAGES = 2;

/**
 * The turns of an open thread's rows (`events`, in order) that fold. A turn runs from a person's
 * message to the next one. Its answer is its last agent message; the rows after it (quiet markers)
 * stay, and the rows before it fold once at least `MIN_FOLDED_MESSAGES` of them are messages. A
 * turn that is not finished (a row holds it, or it is the newest while the thread works) or that
 * would hide a pinned row stays unfolded, as does one that crosses a day, whose date divider would
 * sit inside the fold. Rows without one of their own (edits, reactions) and rows other plans hide
 * take no part.
 */
export const planThreadTurnFolds = (
  events: readonly MatrixEvent[],
  rules: ThreadTurnRules
): ThreadTurnFold[] => {
  const folds: ThreadTurnFold[] = [];
  const foldTurn = (start: number, end: number, lastTurn: boolean) => {
    const key = events[start]?.getId();
    if (!key || (lastTurn && rules.lastTurnBusy)) return;
    const rows: MatrixEvent[] = [];
    for (let index = start + 1; index < end; index += 1) {
      const event = events[index];
      if (!event || isRowlessTimelineEvent(event)) continue;
      if (rules.holdsTurn(event)) return;
      if (!rules.isSkipped(event)) rows.push(event);
    }
    let answerAt = rows.length - 1;
    while (answerAt >= 0 && !rules.isAnswer(rows[answerAt]!)) answerAt -= 1;
    const answer = rows[answerAt];
    const answerId = answer?.getId();
    if (!answer || !answerId) return;
    const askedTs = events[start]!.getTs();
    if (rows.slice(0, answerAt + 1).some((event) => !inSameDay(askedTs, event.getTs()))) return;
    const hidden = rows.slice(0, answerAt);
    const hiddenIds = hidden.flatMap((event) => event.getId() ?? []);
    if (hiddenIds.length !== hidden.length || hiddenIds.some((id) => rules.pinnedIds.has(id))) {
      return;
    }
    const count = hidden.filter((event) => !rules.isQuietMarker(event)).length;
    if (count < MIN_FOLDED_MESSAGES) return;
    folds.push({ key, hiddenIds, count, answerId });
  };
  let turnStart: number | undefined;
  events.forEach((event, index) => {
    if (isRowlessTimelineEvent(event) || !rules.isPersonMessage(event)) return;
    if (turnStart !== undefined) foldTurn(turnStart, index, false);
    turnStart = index;
  });
  if (turnStart !== undefined) foldTurn(turnStart, events.length, true);
  return folds;
};

/** What the open thread shows of its folding turns, with the reader's choice for each. */
export type ThreadTurnFoldView = {
  /** Rows of closed turns, which render nothing: the first one still draws its turn's break. */
  hiddenIds: ReadonlySet<string>;
  /** Each turn's break, under the ID of the row that draws it (its first hidden row). */
  breaks: ReadonlyMap<string, { fold: ThreadTurnFold; open: boolean }>;
};

export const EMPTY_TURN_FOLD_VIEW: ThreadTurnFoldView = { hiddenIds: new Set(), breaks: new Map() };

/** The rows `folds` hide and their breaks, a turn open where `isOpen` says so. */
export const viewThreadTurnFolds = (
  folds: readonly ThreadTurnFold[],
  isOpen: (fold: ThreadTurnFold) => boolean
): ThreadTurnFoldView => {
  if (folds.length === 0) return EMPTY_TURN_FOLD_VIEW;
  const hiddenIds = new Set<string>();
  const breaks = new Map<string, { fold: ThreadTurnFold; open: boolean }>();
  folds.forEach((fold) => {
    const open = isOpen(fold);
    if (!open) fold.hiddenIds.forEach((id) => hiddenIds.add(id));
    const breakRowId = fold.hiddenIds[0];
    if (breakRowId) breaks.set(breakRowId, { fold, open });
  });
  return { hiddenIds, breaks };
};
