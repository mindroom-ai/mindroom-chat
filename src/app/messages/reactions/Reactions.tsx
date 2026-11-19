import { useEffect, useReducer, useState } from 'react';
import { Box, Text, Tooltip } from 'folds';
import { TooltipProvider } from '../../ui/directional';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { RelationsEvent, type Relations } from 'matrix-js-sdk/lib/models/relations';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { Reaction, ReactionTooltipMsg } from './Reaction';
import {
  getRenderableAnnotationsByKey,
  isAgentStopButton,
} from '../../matrix/protocol/stopReaction';
import { useHiddenQuestionReactions } from '../question/useHiddenQuestionReactions';
import * as css from '../styles.css';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';

type ReactionsProps = {
  room: Room;
  mEventId: string;
  /** The message the reactions annotate; its stream state decides the stop chip. */
  targetEvent?: MatrixEvent;
  canSendReaction?: boolean;
  relations: Relations;
  onReactionToggle: (
    targetEventId: string,
    key: string,
    shortcode: string | undefined,
    relations: Relations,
    /** Stop sends a fresh stop, taking back one an earlier run left. */
    resend?: boolean
  ) => void;
};

const reactionShortcode = (events: MatrixEvent[]): string | undefined => {
  const content = events[0]?.getContent?.<Record<string, unknown>>();
  const shortcode = content?.shortcode ?? content?.['com.beeper.reaction.shortcode'];
  return typeof shortcode === 'string' ? shortcode : undefined;
};

const firstUse = (events: Set<MatrixEvent>): number => {
  let first = Infinity;
  events.forEach((event) => {
    first = Math.min(first, event.getTs());
  });
  return first;
};

/**
 * The reactions in the order their emoji was first used. The SDK sorts them by count, which moved
 * a pill as soon as the viewer clicked it, so a second click landed on another emoji.
 */
const byFirstUse = <T extends [string, Set<MatrixEvent>]>(annotations: T[]): T[] =>
  annotations
    .map((annotation) => ({ annotation, first: firstUse(annotation[1]) }))
    .sort((a, b) => a.first - b.first)
    .map(({ annotation }) => annotation);

/** Follows reactions added, removed, or redacted on a message. */
const useRelationsUpdates = (relations: Relations): void => {
  const [, forceUpdate] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    relations.on(RelationsEvent.Add, forceUpdate);
    relations.on(RelationsEvent.Remove, forceUpdate);
    relations.on(RelationsEvent.Redaction, forceUpdate);
    return () => {
      relations.removeListener(RelationsEvent.Add, forceUpdate);
      relations.removeListener(RelationsEvent.Remove, forceUpdate);
      relations.removeListener(RelationsEvent.Redaction, forceUpdate);
    };
  }, [relations]);
};

/**
 * The reaction chips under a message. The MindRoom agent's own 🛑 on a reply
 * that still streams is the stop button; once the reply finished, a leftover
 * stop chip is hidden.
 */
export function Reactions({
  room,
  mEventId,
  targetEvent,
  canSendReaction,
  relations,
  onReactionToggle,
}: ReactionsProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  useRelationsUpdates(relations);
  // The agent's 🛑 the viewer pressed: the run it marks is stopping.
  const [pressedStop, setPressedStop] = useState<string>();

  const myUserId = client.getUserId();
  // A MindRoom agent's question card shows its options and the answer; their chips would repeat them.
  const optionKeys = useHiddenQuestionReactions(targetEvent, room.roomId, myUserId ?? undefined);
  const annotations = byFirstUse(
    getRenderableAnnotationsByKey(relations, targetEvent).filter(([key]) => !optionKeys.has(key))
  );
  // Local echoes carry a transaction ID until the server confirms them; they cannot be reacted to.
  const canToggle = !!canSendReaction && isConfirmedMatrixEventId(mEventId);

  if (annotations.length === 0) return null;

  // The agent's 🛑 on its streaming reply is the reply's Stop. Pressed, it reads Stopping… while
  // that 🛑 and the viewer's stop stay: a refused stop is taken back, a new run brings a new 🛑.
  const stopEntry = annotations.find(([key, set]) => isAgentStopButton(key, [...set], targetEvent));
  const stopEvents = stopEntry ? [...stopEntry[1]] : [];
  const stopMarker = stopEvents.find((e) => e.getSender() === targetEvent?.getSender())?.getId();
  const stopping =
    !!stopMarker &&
    stopMarker === pressedStop &&
    stopEvents.some((e) => e.getSender() === myUserId);
  const stopLabel = (text: string, shown: boolean) => (
    <span className={shown ? css.StopLabel : css.StopLabelHidden} aria-hidden={!shown}>
      {text}
    </span>
  );

  return (
    <Box className={css.ReactionsContainer} gap="200" wrap="Wrap">
      {/* Mounted with the Stop, so its Stopping… is announced once; the Stop keeps its name. */}
      {stopEntry && (
        <span role="status" className={css.StopStatus}>
          {stopping ? t('mindroomUi.messages.stopReply.stopping') : ''}
        </span>
      )}
      {annotations.map((annotation) => {
        const [key, eventSet] = annotation;
        const events = Array.from(eventSet);
        const stopButton = annotation === stopEntry;
        const pending = stopButton && stopping;
        const mine = events.some((event) => event.getSender() === myUserId);
        const shortcode = reactionShortcode(events);
        return (
          <TooltipProvider
            key={key}
            delay={500}
            offset={4}
            position="Top"
            tooltip={
              <Tooltip>
                <Text className={css.ReactionsTooltipText} size="T300">
                  <ReactionTooltipMsg room={room} reaction={key} events={events} />
                </Text>
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <Reaction
                ref={triggerRef}
                // Stop is a command, not a toggle.
                aria-pressed={stopButton ? undefined : mine}
                aria-label={stopButton ? t('mindroomUi.messages.stopReply.label') : undefined}
                mx={client}
                useAuthentication={authenticatedMedia}
                reaction={key}
                count={events.length}
                // Both labels in one cell: the chip keeps the wider one's size.
                label={
                  stopButton && (
                    <span className={css.StopLabels}>
                      {stopLabel(t('mindroomUi.messages.stopReply.label'), !pending)}
                      {stopLabel(t('mindroomUi.messages.stopReply.stopping'), pending)}
                    </span>
                  )
                }
                // Stopping keeps the chip, and the keyboard on it, until the reply ends.
                {...(pending && { 'aria-disabled': true, disabled: false })}
                onClick={
                  canToggle && !pending
                    ? () => {
                        if (stopButton) setPressedStop(stopMarker);
                        onReactionToggle(mEventId, key, shortcode, relations, stopButton);
                      }
                    : undefined
                }
              />
            )}
          </TooltipProvider>
        );
      })}
    </Box>
  );
}
