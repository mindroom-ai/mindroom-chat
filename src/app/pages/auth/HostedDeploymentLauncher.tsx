import { Browser } from '@capacitor/browser';
import React, { FormEvent, useRef, useState } from 'react';
import { Box, Button, Input, Text, color } from 'folds';

import { isNativeIOS } from '../../mindroom/auth/authUi';

export const HOSTED_DEPLOYMENT_URL_KEY = 'mindroom_hosted_deployment_url';

const readStoredDeploymentUrl = (): string => {
  try {
    return globalThis.localStorage?.getItem(HOSTED_DEPLOYMENT_URL_KEY) ?? '';
  } catch {
    return '';
  }
};

const storeDeploymentUrl = (value: string): void => {
  try {
    globalThis.localStorage?.setItem(HOSTED_DEPLOYMENT_URL_KEY, value);
  } catch {
    // Storage can be unavailable without preventing the deployment from opening.
  }
};

const forgetDeploymentUrl = (): void => {
  try {
    globalThis.localStorage?.removeItem(HOSTED_DEPLOYMENT_URL_KEY);
  } catch {
    // Treat storage cleanup as best effort.
  }
};

export const normalizeHostedDeploymentUrl = (value: string): string => {
  const trimmedValue = value.trim();
  if (!trimmedValue) throw new Error('invalid deployment URL');

  const hasAuthorityScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmedValue);
  const parsedUrl = new URL(hasAuthorityScheme ? trimmedValue : `https://${trimmedValue}`);

  if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname) {
    throw new Error('invalid deployment URL');
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('deployment URL must not contain credentials');
  }

  parsedUrl.search = '';
  parsedUrl.hash = '';

  return parsedUrl.toString();
};

function HostedDeploymentForm({ onBack }: { onBack: () => void }) {
  const [deploymentUrl, setDeploymentUrl] = useState(readStoredDeploymentUrl);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string>();
  const openingRef = useRef(false);

  const handleOpen = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (openingRef.current) return;

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeHostedDeploymentUrl(deploymentUrl);
    } catch {
      setError('Enter a valid HTTPS deployment URL without embedded credentials.');
      return;
    }

    openingRef.current = true;
    setOpening(true);
    setError(undefined);
    try {
      await Browser.open({ url: normalizedUrl, presentationStyle: 'fullscreen' });
      setDeploymentUrl(normalizedUrl);
      storeDeploymentUrl(normalizedUrl);
    } catch {
      setError('Unable to open this deployment.');
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  };

  const handleForget = (): void => {
    forgetDeploymentUrl();
    setDeploymentUrl('');
    setError(undefined);
  };

  return (
    <Box
      as="form"
      onSubmit={handleOpen}
      direction="Column"
      gap="200"
      data-testid="hosted-deployment-form"
    >
      <Box direction="Column" gap="100">
        <Box alignItems="Center" justifyContent="SpaceBetween" gap="200">
          <Text as="label" htmlFor="hostedDeploymentUrl" size="L400" priority="300">
            Organization deployment
          </Text>
          <Button
            type="button"
            size="300"
            variant="Secondary"
            fill="None"
            aria-label="Back to server sign-in"
            onClick={onBack}
            disabled={opening}
          >
            <Text size="B300">Back</Text>
          </Button>
        </Box>
        <Input
          id="hostedDeploymentUrl"
          aria-label="Organization deployment URL"
          name="hostedDeploymentUrl"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://chat.example.com"
          value={deploymentUrl}
          onChange={(event) => setDeploymentUrl(event.currentTarget.value)}
          variant="Background"
          outlined
          size="500"
          disabled={opening}
        />
        <Text size="T200" priority="300">
          Enter the secure app URL supplied by your organization.
        </Text>
      </Box>
      {error && (
        <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
          {error}
        </Text>
      )}
      <Box gap="200">
        <Button type="submit" variant="Primary" disabled={opening} style={{ flexGrow: 1 }}>
          <Text size="B400">{opening ? 'Opening...' : 'Open deployment'}</Text>
        </Button>
        {deploymentUrl && (
          <Button
            type="button"
            variant="Secondary"
            fill="Soft"
            onClick={handleForget}
            disabled={opening}
          >
            <Text size="B400">Clear URL</Text>
          </Button>
        )}
      </Box>
    </Box>
  );
}

export function HostedDeploymentButton({ onClick }: { onClick: () => void }) {
  if (!isNativeIOS()) return null;

  return (
    <Button
      type="button"
      size="300"
      variant="Secondary"
      fill="None"
      aria-label="Use organization deployment"
      onClick={onClick}
    >
      <Text size="B300">Organization</Text>
    </Button>
  );
}

export function HostedDeploymentLauncher({ onBack }: { onBack: () => void }) {
  if (!isNativeIOS()) return null;

  return <HostedDeploymentForm onBack={onBack} />;
}
