import { useEffect, useReducer } from 'react';
import { Box, Text, Tooltip } from 'folds';
import { TooltipProvider } from '../../ui/directional';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { RelationsEvent, type Relations } from 'matrix-js-sdk/lib/models/relations';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { Reaction, ReactionTooltipMsg } from '..';
import {
  getRenderableAnnotationsByKey,
  isAgentStopButton,
} from '../../matrix/protocol/stopReaction';
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
    relations: Relations
  ) => void;
};

const reactionShortcode = (events: MatrixEvent[]): string | undefined => {
  const content = events[0]?.getContent?.<Record<string, unknown>>();
  const shortcode = content?.shortcode ?? content?.['com.beeper.reaction.shortcode'];
  return typeof shortcode === 'string' ? shortcode : undefined;
};

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

  const myUserId = client.getUserId();
  const annotations = getRenderableAnnotationsByKey(relations, targetEvent);
  // Local echoes carry a transaction ID until the server confirms them; they cannot be reacted to.
  const canToggle = !!canSendReaction && isConfirmedMatrixEventId(mEventId);

  if (annotations.length === 0) return null;

  return (
    <Box className={css.ReactionsContainer} gap="200" wrap="Wrap">
      {annotations.map(([key, eventSet]) => {
        const events = Array.from(eventSet);
        const stopButton = isAgentStopButton(key, events, targetEvent);
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
                aria-pressed={mine}
                mx={client}
                useAuthentication={authenticatedMedia}
                reaction={key}
                count={events.length}
                label={stopButton ? t('mindroomUi.messages.stopButton.label') : undefined}
                onClick={
                  canToggle
                    ? () => onReactionToggle(mEventId, key, shortcode, relations)
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
