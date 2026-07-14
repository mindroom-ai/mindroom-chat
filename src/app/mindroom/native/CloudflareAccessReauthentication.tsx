import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Box, Button, Dialog, Overlay, OverlayBackdrop, OverlayCenter, Text } from 'folds';
import FocusTrap from 'focus-trap-react';
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setError(undefined);
  }, [requirement?.scope]);

  if (!requirement) return null;

  const handleContinue = async () => {
    setPending(true);
    setError(undefined);
    try {
      await retryCloudflareAccessAuthentication();
    } catch (authError) {
      setError(
        authError instanceof Error ? authError.message : 'Organization sign-in could not finish.'
      );
    } finally {
      setPending(false);
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
                  <Button
                    variant="Primary"
                    fill="Solid"
                    disabled={pending}
                    onClick={handleContinue}
                  >
                    {pending ? 'Opening sign-in…' : 'Continue'}
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
