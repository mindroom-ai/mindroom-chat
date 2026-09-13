import { StatusBar } from '@capacitor/status-bar';

import { isNativeIOS } from './nativeSso';

export const syncNativeStatusBarBackground = (backgroundColor: string): void => {
  if (!isNativeIOS()) return;

  StatusBar.setBackgroundColor({ color: backgroundColor }).catch(() => undefined);
};
