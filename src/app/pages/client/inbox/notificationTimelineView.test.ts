import { describe, expect, it } from 'vitest';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { shouldRenderNotificationLoadingPlaceholders } from './notificationTimelineView';

describe('notificationTimelineView', () => {
  it('does not render loading placeholders while existing notification groups stay visible', () => {
    expect(shouldRenderNotificationLoadingPlaceholders(AsyncStatus.Loading, 1)).toBe(false);
  });

  it('renders loading placeholders for the initial empty load', () => {
    expect(shouldRenderNotificationLoadingPlaceholders(AsyncStatus.Loading, 0)).toBe(true);
  });
});
