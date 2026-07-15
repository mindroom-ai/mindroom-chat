import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Box, Button, Dialog, Overlay, OverlayBackdrop, OverlayCenter, Text } from 'folds';
import FocusTrap from 'focus-trap-react';
import { removeSessionAndReload } from '../../../client/initMatrix';
import { useActiveSession } from '../../hooks/useSessionStore';
import {
  getCloudflareAccessRequirement,
  retryCloudflareAccessAuthentication,
  subscribeToCloudflareAccessRequirement,
} from './cloudflareAccess';

export function CloudflareAccessReauthentication() {
  const requirement = useSyncExternalStore(
    subscribeToCloudflareAccessRequirement,
    getCloudflareAccessRequirement,
    () => undefined
  );
  const activeSession = useActiveSession();
  const [pendingAction, setPendingAction] = useState<'authenticate' | 'logout'>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setError(undefined);
  }, [requirement?.scope]);

  if (!requirement) return null;

  const handleContinue = async () => {
    setPendingAction('authenticate');
    setError(undefined);
    try {
      await retryCloudflareAccessAuthentication();
    } catch (authError) {
      setError(
        authError instanceof Error ? authError.message : 'Organization sign-in could not finish.'
      );
    } finally {
      setPendingAction(undefined);
    }
  };

  const handleLogout = async () => {
    if (!activeSession) return;
    setPendingAction('logout');
    setError(undefined);
    try {
      await removeSessionAndReload(activeSession);
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : 'Logout could not finish.');
      setPendingAction(undefined);
    }
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap focusTrapOptions={{ escapeDeactivates: false }}>
          <div>
            <Dialog variant="Surface" style={{ maxWidth: 360 }}>
              <Box direction="Column" gap="400" style={{ padding: 24 }}>
                <Box direction="Column" gap="200">
                  <Text size="H4">Organization sign-in required</Text>
                  <Text priority="300">
                    Continue through your organization&apos;s secure sign-in, then return here.
                  </Text>
                  {error && (
                    <Text priority="300" style={{ color: 'var(--bg-critical-solid)' }}>
                      {error}
                    </Text>
                  )}
                </Box>
                <Box direction="Row" gap="200" justifyContent="End">
                  {activeSession && (
                    <Button
                      variant="Secondary"
                      fill="Soft"
                      disabled={pendingAction !== undefined}
                      onClick={handleLogout}
                    >
                      {pendingAction === 'logout' ? 'Logging out…' : 'Logout'}
                    </Button>
                  )}
                  <Button
                    variant="Primary"
                    fill="Solid"
                    disabled={pendingAction !== undefined}
                    onClick={handleContinue}
                  >
                    {pendingAction === 'authenticate' ? 'Opening sign-in…' : 'Continue'}
                  </Button>
                </Box>
              </Box>
            </Dialog>
          </div>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
