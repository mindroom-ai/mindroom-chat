import React, { FormEventHandler, useMemo, useState } from 'react';
import { Box, Button, Input, Spinner, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { IAuthData } from 'matrix-js-sdk';
import { PasswordInput } from '../../../components/password-input';
import { MINDROOM_AUTH_BRANDING } from '../../../mindroom/auth/authUi';
import { createMatrixClient } from '../../../mindroom/matrix/matrixClientFactory';
import { FieldError } from '../FiledError';
import {
  CustomRegisterResponse,
  RegisterError,
  register,
  useRegisterComplete,
} from './registerUtil';

const REGISTER_ERROR_KEYS = {
  [RegisterError.UserTaken]: 'sharedUi.passwordRegisterForm.thisUsernameIsAlreadyTaken',
  [RegisterError.UserInvalid]:
    'sharedUi.passwordRegisterForm.thisUsernameContainsInvalidCharacters',
  [RegisterError.UserExclusive]: 'sharedUi.passwordRegisterForm.thisUsernameIsReserved',
  [RegisterError.PasswordWeak]:
    'sharedUi.passwordRegisterForm.weakPasswordPasswordRejectedByServerPleaseChoosingMoreStrongPassword',
  [RegisterError.PasswordShort]:
    'sharedUi.passwordRegisterForm.shortPasswordPasswordRejectedByServerPleaseChoosingMoreLongPassword',
  [RegisterError.InvalidRequest]: 'sharedUi.passwordRegisterForm.failedToRegisterInvalidRequest',
  [RegisterError.Forbidden]:
    'sharedUi.passwordRegisterForm.failedToRegisterTheHomeserverDoesNotPermitRegistration',
  [RegisterError.RateLimited]:
    'sharedUi.passwordRegisterForm.failedToRegisterYourRegisterRequestHasBeenRateLimitedByServer',
  [RegisterError.Unknown]: 'sharedUi.passwordRegisterForm.failedToRegisterUnknownReason',
} as const;

const isDummyOnly = (stages: string[]): boolean =>
  stages.every((stage) => stage === 'm.login.dummy');

/** Whether this form can complete one of the server's sign-up flows. */
export const canRegisterWithPassword = (authData: IAuthData): boolean =>
  authData.flows?.some((flow) => isDummyOnly(flow.stages)) ?? false;

type PasswordRegisterFormProps = {
  baseUrl: string;
};

/** Username and password sign-up; dummy auth stages are answered directly. */
export function PasswordRegisterForm({ baseUrl }: PasswordRegisterFormProps) {
  const { t } = useTranslation();
  const mx = useMemo(() => createMatrixClient({ baseUrl }), [baseUrl]);
  const [result, setResult] = useState<CustomRegisterResponse>();
  const [error, setError] = useState<RegisterError>();
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const storeFailed = useRegisterComplete(result);

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    const target = event.target as HTMLFormElement & {



    };
    const username = target.usernameInput.value.trim();
    const password = target.passwordInput.value;
    setError(undefined);
    setMismatch(password !== target.confirmPasswordInput.value);
    if (password !== target.confirmPasswordInput.value) return;
    setBusy(true);
    try {
      const data = {
        username,
        password,
        initial_device_display_name: MINDROOM_AUTH_BRANDING.deviceDisplayName,
      };
      let attempt = await register(mx, data);
      if (attempt.kind === 'uia') {
        if (!canRegisterWithPassword(attempt.authData)) {
          setError(RegisterError.InvalidRequest);
          return;
        }
        attempt = await register(mx, {
          ...data,
          auth: { type: 'm.login.dummy', session: attempt.authData.session },
        });
      }
      if (attempt.kind === 'success') setResult({ baseUrl, response: attempt.response });
      else setError(attempt.kind === 'error' ? attempt.error : RegisterError.Unknown);
    } finally {
      setBusy(false);
    }







        </Text>
        <Input
          name="usernameInput"
          variant="Background"
          size="500"
          required
          outlined
          autoComplete="username"
        />
      </Box>
      <Box direction="Column" gap="100">
        <Text as="label" size="L400" priority="300">
          {t('sharedUi.passwordRegisterForm.password')}
        </Text>
        <PasswordInput
          name="passwordInput"
          variant="Background"
          size="500"
          required
          outlined
          autoComplete="new-password"
        />
      </Box>
      <Box direction="Column" gap="100">
        <Text as="label" size="L400" priority="300">
          {t('sharedUi.passwordRegisterForm.confirmPassword')}
        </Text>
        <PasswordInput
          name="confirmPasswordInput"
          variant="Background"
          size="500"
          required
          outlined
          autoComplete="new-password"
          aria-invalid={mismatch || undefined}
        />
      </Box>
      {error && <FieldError message={t(REGISTER_ERROR_KEYS[error])} />}
      {storeFailed && (
        <FieldError
          message={t(
            'sharedUi.passwordRegisterForm.registrationSucceededButThisBrowserCouldNotSaveTheAccountCheckStorage'
          )}
        />
      )}
      <Button
        type="submit"
        variant="Primary"
        size="500"
        disabled={busy}
        before={busy ? <Spinner variant="Primary" fill="Solid" size="200" /> : undefined}
      >
        <Text as="span" size="B500">
          {t('sharedUi.passwordRegisterForm.register')}
        </Text>
      </Button>
    </Box>
  );
}
