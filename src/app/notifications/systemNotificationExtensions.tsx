import React from 'react';

import { MINDROOM_NOTIFICATION_BRAND } from '../ui/branding/branding';
import { IOSPushNotification } from './push/IOSPushNotification';

export const getMindroomEmailNotificationPusherData = (): Record<string, string> => ({
  brand: MINDROOM_NOTIFICATION_BRAND,
});

export function MindroomNativeNotificationSettings() {
  return <IOSPushNotification />;
}
