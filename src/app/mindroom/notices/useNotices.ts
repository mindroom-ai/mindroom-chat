import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DISMISSED_NOTICES_STORAGE_KEY,
  Notice,
  NOTICE_REFRESH_INTERVAL_MS,
  dismissNotice,
  fetchNotices,
  readDismissedNoticeIds,
  selectVisibleNotices,
} from './notices';

/**
 * Polls `url` on mount, every minute and on window focus, and returns the notices to show
 * now. No `url` turns notices off.
 */
export const useNotices = (url: string | undefined) => {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(
    () => new Set(readDismissedNoticeIds())
  );

  useEffect(() => {
    if (!url) return undefined;
    const controller = new AbortController();
    let loading = false;
    const refresh = () => {
      if (loading) return;
      loading = true;
      fetchNotices(url, controller.signal).then((next) => {
        loading = false;
        if (controller.signal.aborted) return;
        if (next) setNotices(next);
        setNow(Date.now());
      });
    };

    refresh();
    const interval = window.setInterval(refresh, NOTICE_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [url]);

  // Another tab's dismissal applies here too.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === DISMISSED_NOTICES_STORAGE_KEY) {
        setDismissedIds(new Set(readDismissedNoticeIds()));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const dismiss = useCallback((id: string) => setDismissedIds(new Set(dismissNotice(id))), []);
  const visible = useMemo(
    () => selectVisibleNotices(notices, now, dismissedIds),
    [notices, now, dismissedIds]
  );

  return { notices: visible, dismiss };
};
