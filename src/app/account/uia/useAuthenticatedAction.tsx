import { ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Text, config } from 'folds';
import type { AuthDict, IAuthData, MatrixError } from 'matrix-js-sdk';
import { ActionUIA, ActionUIAFlowsLoader } from './ActionUIA';
import { Dialog } from '../../ui/glass/GlassPrimitives';
import { SettingsOverlay } from '../../ui/settings/SettingsOverlay';

/** Thrown by `run` when the person closes the authentication prompt. */
export class AuthenticationCancelled extends Error {
  constructor() {
    super('Authentication cancelled');
    this.name = 'AuthenticationCancelled';
  }
}

/** The interactive-auth answer in a 401 (Matrix client-server API, "User-interactive API"). */
const readAuthData = (error: unknown): IAuthData | undefined => {
  const data = (error as MatrixError | undefined)?.data as IAuthData | undefined;
  return data && Array.isArray(data.flows) ? data : undefined;
};

type Waiting = {
  authData: IAuthData;
  answer: (auth: AuthDict) => void;
  cancel: () => void;
};

type AuthenticatedAction = {
  /**
   * Calls `request` without auth, then again with each stage the server asks for, until it
   * succeeds or fails for another reason. Rejects with `AuthenticationCancelled` on cancel.
   */
  run: <T>(request: (auth?: AuthDict) => Promise<T>) => Promise<T>;
  /** The prompt for the current stage; render it anywhere. */
  prompt: ReactNode;
};

/** Shown when every flow the server offers has a stage this client cannot do. */
function UnsupportedStages({ stages, onClose }: { stages: string[]; onClose: () => void }) {
  const { t } = useTranslation();
  const messageId = useId();
  // The message is all the dialog says, so it names the dialog too.
  return (
    <Dialog
      variant="Surface"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={messageId}
      aria-describedby={messageId}
    >
      <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
        <Text id={messageId} size="T300">
          {t('featureUi.settings.devices.otherDevices.authenticationStepsToPerformThisActionAre')}
        </Text>
        {/* The stage names, so a report says what the server asked for. */}
        {stages.length > 0 && (
          <Text size="T200" priority="300" style={{ overflowWrap: 'anywhere' }}>
            <code>{stages.join(', ')}</code>
          </Text>
        )}
        <Button variant="Secondary" fill="Soft" onClick={onClose}>
          <Text size="B400">{t('featureUi.settings.devices.otherDevices.cancel')}</Text>
        </Button>
      </Box>
    </Dialog>
  );
}

/** Account actions that need the password or single sign-on again (deactivate, sign out). */
export function useAuthenticatedAction(): AuthenticatedAction {
  const [waiting, setWaiting] = useState<Waiting>();
  // What gives up each prompt still open when the component goes away (an account switch, a
  // navigation): its action would otherwise wait for an answer that can no longer come.
  const abandons = useRef<Set<() => void> | undefined>(new Set());

  useEffect(() => {
    // Mounted again (StrictMode): prompts open from here on are given up at the next unmount.
    const open = abandons.current ?? new Set<() => void>();
    abandons.current = open;
    return () => {
      abandons.current = undefined;
      open.forEach((abandon) => abandon());
    };
  }, []);

  const ask = useCallback(
    (authData: IAuthData) =>
      new Promise<AuthDict>((resolve, reject) => {
        const open = abandons.current;
        if (!open) {
          reject(new AuthenticationCancelled());
          return;
        }
        const abandon = () => reject(new AuthenticationCancelled());
        open.add(abandon);
        const entry: Waiting = {
          authData,
          answer: (auth) => {
            open.delete(abandon);
            setWaiting((current) => (current === entry ? undefined : current));
            resolve(auth);
          },
          cancel: () => {
            open.delete(abandon);
            setWaiting((current) => (current === entry ? undefined : current));
            abandon();
          },
        };
        setWaiting(entry);
      }),
    []
  );

  const run = useCallback(
    async <T,>(request: (auth?: AuthDict) => Promise<T>): Promise<T> => {
      let auth: AuthDict | undefined;
      for (;;) {
        try {
          // The loop retries strictly one stage at a time.
          // eslint-disable-next-line no-await-in-loop
          return await request(auth);
        } catch (error) {
          const authData = readAuthData(error);
          if (!authData) throw error;
          // eslint-disable-next-line no-await-in-loop
          auth = await ask(authData);
        }
      }
    },
    [ask]
  );

  const prompt = waiting ? (
    <SettingsOverlay onDismiss={waiting.cancel}>
      <ActionUIAFlowsLoader
        authData={waiting.authData}
        unsupported={() => (
          <UnsupportedStages
            stages={[...new Set((waiting.authData.flows ?? []).flatMap((flow) => flow.stages))]}
            onClose={waiting.cancel}
          />
        )}
      >
        {(flow) => (
          <ActionUIA
            authData={waiting.authData}
            ongoingFlow={flow}
            action={waiting.answer}
            onCancel={waiting.cancel}
          />
        )}
      </ActionUIAFlowsLoader>
    </SettingsOverlay>
  ) : null;

  return { run, prompt };
}
