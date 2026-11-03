import React, { FormEventHandler, ReactNode, useCallback, useMemo, useState } from 'react';
import { Box, Button, Input, Spinner, Text } from 'folds';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { MatrixError } from 'matrix-js-sdk';
import { createMatrixClient } from '../../../mindroom/matrix/matrixClientFactory';
import { useAutoDiscoveryInfo } from '../../../hooks/useAutoDiscoveryInfo';
import { useAuthServer } from '../../../hooks/useAuthServer';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { FieldError } from '../FiledError';

/** One form row: the caption above its input. */
function LabeledField({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <Box direction="Column" gap="100">
      <Text as="label" size="L400" priority="300">
        {caption}
      </Text>
      {children}
    </Box>
  );
}

type PasswordResetFormProps = {
  defaultEmail?: string;
  /** Where the Login button goes once the new password is set. */
  loginLink?: string;
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
export function PasswordResetForm({ defaultEmail, loginLink }: PasswordResetFormProps) {
  const baseUrl = useAutoDiscoveryInfo()['m.homeserver'].base_url;
  // Named the way the user entered it in the server field.
  const serverName = useAuthServer();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mx = useMemo(() => createMatrixClient({ baseUrl }), [baseUrl]);
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
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get('emailInput') ?? '').trim();
    const password = String(fields.get('passwordInput') ?? '');
    if (password !== String(fields.get('confirmPasswordInput') ?? '')) {
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
        <Text role="status">
          {t(
            'sharedUi.passwordResetForm.passwordHasBeenResetSuccessfullyPleaseLoginWithYourNewPassword'
          )}
        </Text>
        {loginLink && (
          <Button variant="Primary" size="500" onClick={() => navigate(loginLink)}>
            <Text as="span" size="B500">
              {t('sharedUi.passwordResetForm.login')}
            </Text>
          </Button>
        )}
      </Box>
    );
  }

  return (
    <Box as="form" direction="Inherit" gap="400" onSubmit={handleSubmit}>
      <Text size="T300" priority="400">
        <Trans
          i18nKey="sharedUi.passwordResetForm.resetEmailDescription"
          components={{ strong: <strong /> }}
          values={{ server: serverName }}
        />
      </Text>
      <LabeledField caption={t('sharedUi.passwordResetForm.email')}>
        <Input
          name="emailInput"
          type="email"
          defaultValue={defaultEmail}
          outlined
          required
          size="500"
          variant="Background"
        />
      </LabeledField>
      <LabeledField caption={t('sharedUi.passwordResetForm.newPassword')}>
        <Input
          name="passwordInput"
          type="password"
          outlined
          required
          size="500"
          variant="Background"
        />
      </LabeledField>
      <LabeledField caption={t('sharedUi.passwordResetForm.confirmPassword')}>
        <Input
          name="confirmPasswordInput"
          type="password"
          aria-invalid={mismatch || undefined}
          outlined
          required
          size="500"
          variant={mismatch ? 'Critical' : 'Background'}
        />
      </LabeledField>
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
