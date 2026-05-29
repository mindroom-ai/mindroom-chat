import { AsyncStatus } from '../../../hooks/useAsyncCallback';

export const shouldRenderNotificationLoadingPlaceholders = (
  timelineStatus: AsyncStatus,
  groupCount: number
): boolean => timelineStatus === AsyncStatus.Loading && groupCount === 0;
