import React, { ReactNode, useEffect } from 'react';
import { Box } from 'folds';
import { useLocation } from 'react-router-dom';
import { useActiveSession } from '../../hooks/useSessionStore';
import { updateSessionLastPath } from '../../state/sessions';
import { buildSessionLastKnownPath } from './sessionRouteRestore';

type ClientLayoutProps = {
  nav: ReactNode;
  children: ReactNode;
};
export function ClientLayout({ nav, children }: ClientLayoutProps) {
  const location = useLocation();
  const { hash, pathname, search } = location;
  const activeSession = useActiveSession();

  useEffect(() => {
    if (!activeSession) return;

    updateSessionLastPath(
      activeSession.sessionId,
      buildSessionLastKnownPath({ pathname, search, hash })
    );
  }, [activeSession, hash, pathname, search]);

  return (
    <Box grow="Yes">
      <Box shrink="No">{nav}</Box>
      <Box grow="Yes">{children}</Box>
    </Box>
  );
}
