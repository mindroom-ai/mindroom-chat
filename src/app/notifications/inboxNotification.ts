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
