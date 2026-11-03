import React, { FormEventHandler, useMemo, useState } from 'react';
import { Box, Button, Input, Spinner, Text } from 'folds';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useAutoDiscoveryInfo } from '../../../hooks/useAutoDiscoveryInfo';
import { createMatrixClient } from '../../../mindroom/matrix/matrixClientFactory';
import { getLoginPath } from '../../pathUtils';
import { isAddAccountSearch, withAddAccountSearchIf } from '../addAccount';
import { FieldError } from '../FiledError';
import { CustomRegisterResponse, register, useRegisterComplete } from './registerUtil';

const isDummyOnly = (stages: string[]): boolean =>
  stages.every((stage) => stage === 'm.login.dummy');

/** Creates an account with a username and password; dummy auth stages are answered directly. */
export function Register() {
  const { t } = useTranslation();
  const { server } = useOutletContext<{ server: string }>();
  const baseUrl = useAutoDiscoveryInfo()['m.homeserver'].base_url;
  const mx = useMemo(() => createMatrixClient({ baseUrl }), [baseUrl]);
  const [searchParams] = useSearchParams();
  const addAccount = isAddAccountSearch(searchParams);
  const [result, setResult] = useState<CustomRegisterResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const storeFailed = useRegisterComplete(result);

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    const target = event.target as HTMLFormElement & {



    };
    const username = target.usernameInput.value.trim();
    const password = target.passwordInput.value;
    if (password !== target.confirmPasswordInput.value) {
      setError(t('featureUi.auth.register.passwordsDoNotMatch'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const data = { username, password, initial_device_display_name: 'MindRoom Client' };
      let attempt = await register(mx, data);
      if (attempt.kind === 'uia') {
        const flow = attempt.authData.flows?.find((item) => isDummyOnly(item.stages));
        if (!flow) {
          setError(t('featureUi.auth.register.unsupportedStages'));
          return;
        }
        attempt = await register(mx, {
          ...data,
          auth: { type: 'm.login.dummy', session: attempt.authData.session },
        });
      }
      if (attempt.kind === 'success') setResult({ baseUrl, response: attempt.response });
      else if (attempt.kind === 'error') setError(attempt.message ?? attempt.error);
      else setError(t('featureUi.auth.register.unsupportedStages'));
    } finally {
      setBusy(false);
    }






      </Text>
      {storeFailed && <FieldError message={t('featureUi.auth.storeFailed')} />}
      <Box as="form" onSubmit={handleSubmit} direction="Column" gap="400">
        <Box direction="Column" gap="100">
          <Text as="label" size="L400" priority="300">
            {t('featureUi.auth.login.username')}
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
            {t('featureUi.auth.login.password')}
          </Text>
          <Input
            name="passwordInput"
            type="password"
            variant="Background"
            size="500"
            required
            outlined
            autoComplete="new-password"
          />
        </Box>
        <Box direction="Column" gap="100">
          <Text as="label" size="L400" priority="300">
            {t('featureUi.auth.register.confirmPassword')}
          </Text>
          <Input
            name="confirmPasswordInput"
            type="password"
            variant="Background"
            size="500"
            required
            outlined
            autoComplete="new-password"
          />
        </Box>
        {error && <FieldError message={error} />}
        <Button
          type="submit"
          variant="Primary"
          size="500"
          disabled={busy}
          before={busy ? <Spinner variant="Primary" fill="Solid" size="200" /> : undefined}
        >
          <Text as="span" size="B500">
            {t('featureUi.auth.register.submit')}
          </Text>
        </Button>
      </Box>
      <Text align="Center">
        <Trans
          i18nKey="sharedUi.register.accountLink"
          components={{
            authLink: <Link to={withAddAccountSearchIf(getLoginPath(server), addAccount)} />,
          }}
        />
      </Text>
    </Box>
  );
}
