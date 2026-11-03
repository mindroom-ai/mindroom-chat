import { useEffect, useState } from 'react';

/** The browser's current notification permission, in Permissions API terms. */
export const getNotificationState = (): PermissionState => {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  const { permission } = window.Notification;
  return permission === 'default' ? 'prompt' : permission;
};

/**
 * The state of a browser permission, following changes (granting it from the address bar, for
 * example). Starts from `initial` until the Permissions API answers.
 */
export const usePermissionState = (
  name: PermissionName,
  initial: PermissionState
): PermissionState => {
  const [state, setState] = useState<PermissionState>(initial);

  useEffect(() => {
    const permissions = typeof navigator === 'undefined' ? undefined : navigator.permissions;
    if (!permissions?.query) return undefined;
    let status: PermissionStatus | undefined;
    let disposed = false;
    const handleChange = () => {
      if (status) setState(status.state);
    };
    permissions
      .query({ name })
      .then((result) => {
        if (disposed) return;
        status = result;
        setState(result.state);
        result.addEventListener('change', handleChange);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      status?.removeEventListener('change', handleChange);
    };
  }, [name]);

  return state;
};
