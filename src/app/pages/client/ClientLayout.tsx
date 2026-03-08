import React, { ReactNode, useEffect } from 'react';
import { Box } from 'folds';
import { useLocation } from 'react-router-dom';
import { useActiveSession } from '../../hooks/useSessionStore';
import { updateSessionLastPath } from '../../state/sessions';

type ClientLayoutProps = {
  nav: ReactNode;
  children: ReactNode;
};
export function ClientLayout({ nav, children }: ClientLayoutProps) {
  const location = useLocation();
  const activeSession = useActiveSession();

  useEffect(() => {
    if (!activeSession) return;

    updateSessionLastPath(
      activeSession.sessionId,
      `${location.pathname}${location.search}${location.hash}`
    );
  }, [activeSession, location.hash, location.pathname, location.search]);

  return (
    <Box grow="Yes">
      <Box shrink="No">{nav}</Box>
      <Box grow="Yes">{children}</Box>
    </Box>
  );
}
