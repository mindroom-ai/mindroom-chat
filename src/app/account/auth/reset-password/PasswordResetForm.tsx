import { FormEvent, useCallback, useMemo, useState } from 'react';
import { Box, Button, Input, Spinner, Text } from 'folds';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import type { IIdentityProvider, MatrixClient, MatrixError } from 'matrix-js-sdk';
import { createMatrixClient } from '../../../matrix/client/matrixClientFactory';
import { useAutoDiscoveryInfo } from '../../../matrix/hooks/useAutoDiscoveryInfo';
import { useAuthServer } from '../useAuthServer';
import { AsyncStatus, useAsyncCallback } from '../../../lib/hooks/useAsyncCallback';
import { FieldError } from '../FiledError';
import { AuthField } from '../AuthField';
import { getSsoProviderNames } from '../ssoProviders';

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

/** Answers of a server that resets no passwords by email: Tuwunel without email, or no endpoint. */
const EMAIL_RESET_UNAVAILABLE = new Set(['M_THREEPID_DENIED', 'M_UNRECOGNIZED']);

/** The names of the server's single sign-on; undefined when it offers none or the flows fail. */
async function fetchSsoProviderNames(
  mx: Pick<MatrixClient, 'loginFlows'>
): Promise<string | undefined> {
  const flows = await mx.loginFlows().catch(() => undefined);
  const sso = flows?.flows.find((flow) => flow.type === 'm.login.sso') as
    | { identity_providers?: IIdentityProvider[] }
    | undefined;
  return sso ? getSsoProviderNames(sso.identity_providers) : undefined;
}

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
  // Named once the server answers that it resets no passwords by email.
  const [ssoProviderNames, setSsoProviderNames] = useState<string>();

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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
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
    } catch (failure) {
      // The state shows the error; an account made by single sign-on is pointed back to it.
      if (EMAIL_RESET_UNAVAILABLE.has((failure as Partial<MatrixError>).errcode ?? '')) {
        setSsoProviderNames(await fetchSsoProviderNames(mx));
      }
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
    <Box
      as="form"
      direction="Inherit"
      gap="400"
      onSubmit={(event: FormEvent<HTMLFormElement>) => void handleSubmit(event)}
    >
      <Text size="T300" priority="400">
        <Trans
          i18nKey="sharedUi.passwordResetForm.resetEmailDescription"
          components={{ strong: <strong /> }}
          values={{ server: serverName }}
        />
      </Text>
      <AuthField caption={t('sharedUi.passwordResetForm.email')}>
        <Input
          name="emailInput"
          type="email"
          defaultValue={defaultEmail}
          outlined
          required
          size="500"
          variant="Background"
        />
      </AuthField>
      <AuthField caption={t('sharedUi.passwordResetForm.newPassword')}>
        <Input
          name="passwordInput"
          type="password"
          outlined
          required
          size="500"
          variant="Background"
        />
      </AuthField>
      <AuthField caption={t('sharedUi.passwordResetForm.confirmPassword')}>
        <Input
          name="confirmPasswordInput"
          type="password"
          aria-invalid={mismatch || undefined}
          outlined
          required
          size="500"
          variant={mismatch ? 'Critical' : 'Background'}
        />
      </AuthField>
      {error && EMAIL_RESET_UNAVAILABLE.has(error.errcode ?? '') && (
        <Text role="alert" size="T300">
          {ssoProviderNames ? (
            <Trans
              i18nKey="sharedUi.passwordResetForm.emailResetUnavailableSso"
              values={{ provider: ssoProviderNames }}
              components={{ authLink: loginLink ? <Link to={loginLink} /> : <span /> }}
            />
          ) : (
            t('sharedUi.passwordResetForm.emailResetUnavailable')
          )}
        </Text>
      )}
      {error && !EMAIL_RESET_UNAVAILABLE.has(error.errcode ?? '') && (
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
