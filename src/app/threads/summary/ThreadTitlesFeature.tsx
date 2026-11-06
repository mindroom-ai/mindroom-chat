import { useEffect } from 'react';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useActiveSession } from '../../matrix/session/useSessionStore';
import { keepThreadTitles } from './threadTitleWatch';

/** Saves the titles of every room's threads that the client learns from their events. Mount it once, at client scope. */
export function ThreadTitlesFeature() {
  const mx = useMatrixClient();
  const sessionId = useActiveSession()?.sessionId;
  useEffect(() => (sessionId ? keepThreadTitles(mx, sessionId) : undefined), [mx, sessionId]);
  return null;
}
