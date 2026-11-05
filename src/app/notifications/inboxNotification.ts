import { TweakName, type INotification } from 'matrix-js-sdk';
import { isRecord } from '../lib/isRecord';

/**
 * Whether the server marked a notification as a highlight, which the default push rules do for
 * mentions and keywords: its actions set the `highlight` tweak, true unless a value says false.
 */
export const isHighlightNotification = (notification: Pick<INotification, 'actions'>): boolean =>
  notification.actions.some(
    (action) =>
      isRecord(action) && action.set_tweak === TweakName.Highlight && action.value !== false
  );

/**
 * Whether the Inbox lists a notification: messages, not state events. The default push rules
 * also notify of an invite and of a room's replacement, which the room itself shows; once the
 * person has joined, a listed invite would only read "Unsupported message".
 */
export const isMessageNotification = (notification: Pick<INotification, 'event'>): boolean =>
  notification.event.state_key === undefined;
