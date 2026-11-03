import React, { FormEventHandler, useCallback, useMemo, useState } from 'react';
import { Box, Button, Input, Spinner, Text } from 'folds';
import { Trans, useTranslation } from 'react-i18next';
import type { MatrixError } from 'matrix-js-sdk';
import { createMatrixClient } from '../../../mindroom/matrix/matrixClientFactory';
import { useAutoDiscoveryInfo } from '../../../hooks/useAutoDiscoveryInfo';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { FieldError } from '../FiledError';

type PasswordResetFormProps = {
  defaultEmail?: string;
};

type EmailToken = {
  email: string;
  password: string;
  clientSecret: string;
  sid: string;
};

/**
 * Resets the password through the account's email: the server sends a link,
 * and once it is opened the new password is set.
 */




  const mx = useMemo(() => createMatrixClient({ baseUrl }), [baseUrl]);
  const serverName = useMemo(() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl;
    }
  }, [baseUrl]);
  const [mismatch, setMismatch] = useState(false);
  const [emailToken, setEmailToken] = useState<EmailToken>();
  const [done, setDone] = useState(false);

  const [requestState, requestEmail] = useAsyncCallback(
    useCallback(
      async (email: string, password: string): Promise<EmailToken> => {
        const clientSecret = mx.generateClientSecret();
        const { sid } = await mx.requestPasswordEmailToken(email, clientSecret, 1);
        return { email, password, clientSecret, sid };
      },
      [mx]
    )
  );

  const [resetState, resetPassword] = useAsyncCallback(
    useCallback(
      async (token: EmailToken) => {
        await mx.setPassword(
          {
            type: 'm.login.email.identity',
            threepid_creds: { sid: token.sid, client_secret: token.clientSecret },
            threepidCreds: { sid: token.sid, client_secret: token.clientSecret },
          } as never,
          token.password,
          true
        );
        setDone(true);
      },
      [mx]
    )
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    const target = event.target as HTMLFormElement & {



    };
    const email = target.emailInput.value.trim();
    const password = target.passwordInput.value;
    if (password !== target.confirmPasswordInput.value) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    if (!email || !password) return;
    try {
      setEmailToken(await requestEmail(email, password));
    } catch {
      // The state shows the error.
    }
  };

  const error =
    requestState.status === AsyncStatus.Error
      ? (requestState.error as Partial<MatrixError>)
      : resetState.status === AsyncStatus.Error
      ? (resetState.error as Partial<MatrixError>)
      : undefined;
  const busy =
    requestState.status === AsyncStatus.Loading || resetState.status === AsyncStatus.Loading;

  if (done) {
    return (
      <Box direction="Column" gap="400">
        <Text>
          {t(
            'sharedUi.passwordResetForm.passwordHasBeenResetSuccessfullyPleaseLoginWithYourNewPassword'
          )}
        </Text>
      </Box>
    );
  }

  return (
    <Box as="form" onSubmit={handleSubmit} direction="Inherit" gap="400">
      <Text size="T300" priority="400">
        <Trans
          i18nKey="sharedUi.passwordResetForm.resetEmailDescription"
          values={{ server: serverName }}
          components={{ strong: <strong /> }}
        />





































          size="500"
          required
          outlined
        />
      </Box>
      {error && (
        <FieldError
          message={`${error.errcode ?? 'M_UNKNOWN'}: ${t(
            'sharedUi.passwordResetForm.failedToResetPassword'
          )}`}
        />
      )}
      {emailToken ? (
        <Box direction="Column" gap="200">
          <Text size="T300">
            {t('sharedUi.emailStage.pleaseCheckYourEmailValue1AndValidateBeforeContinuingFurther', {
              value1: emailToken.email,
            })}
          </Text>
          <Button
            type="button"
            variant="Primary"
            size="500"
            disabled={busy}
            before={busy ? <Spinner variant="Primary" fill="Solid" size="200" /> : undefined}
            onClick={() => void resetPassword(emailToken).catch(() => undefined)}
          >
            <Text as="span" size="B500">
              {t('sharedUi.emailStage.continue')}
            </Text>
          </Button>
        </Box>
      ) : (
        <Button
          type="submit"
          variant="Primary"
          size="500"
          disabled={busy}
          before={busy ? <Spinner variant="Primary" fill="Solid" size="200" /> : undefined}
        >
          <Text as="span" size="B500">
            {t('sharedUi.passwordResetForm.resetPassword')}
          </Text>
        </Button>
      )}
    </Box>
  );
}
