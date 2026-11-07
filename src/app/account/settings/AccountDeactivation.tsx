import { useState } from 'react';
import { Box, Button, Icon, Icons, Spinner, Switch, Text, color, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { Dialog, Header, IconButton } from '../../ui/glass/GlassPrimitives';
import { SettingTile } from '../../ui/SettingTile';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useAlive } from '../../lib/hooks/useAlive';
import { getAccountManagementUrl } from '../useAccountManagement';
import { useServerConfigs } from '../../matrix/ServerConfigsLoader';
import { getActiveSession } from '../../matrix/session/sessions';
import { removeCurrentClientSessionAndReload } from '../lifecycle/sessionLifecycle';
import { SettingsCard } from '../../ui/settings/SettingsCard';
import { AuthenticationCancelled, useAuthenticatedAction } from '../uia/useAuthenticatedAction';
import { SettingsOverlay } from '../../ui/settings/SettingsOverlay';
import { describeKnownError } from '../../lib/describeError';
import { ErrorDetail } from '../../ui/ErrorDetail';

const KEY = 'featureUi.settings.account.accountDeactivation';

/** The provider's deactivation page when the homeserver delegates accounts (MSC2965, MSC4191). */
const useProviderDeactivationUrl = (): string | undefined => {
  const metadata = useServerConfigs().authMetadata;
  return metadata && getAccountManagementUrl(metadata, { action: 'org.matrix.account_deactivate' });
};

type ConfirmProps = {
  busy: boolean;
  error?: { failure: unknown };
  onCancel: () => void;
  onConfirm: (erase: boolean) => void;
};

/** Spells out what deactivation does and offers to erase the account data with it. */
function ConfirmDeactivation({ busy, error, onCancel, onConfirm }: ConfirmProps) {
  const { t } = useTranslation();
  const [erase, setErase] = useState(false);
  const eraseLabel = t(`${KEY}.eraseAccountDataIfSupported`);

  return (
    <Dialog variant="Surface" role="dialog" aria-modal="true" aria-labelledby="deactivate-title">
      <Header
        size="500"
        style={{ paddingBlock: 0, paddingInline: `${config.space.S400} ${config.space.S200}` }}
      >
        <Box grow="Yes">
          <Text id="deactivate-title" size="H4">
            {t(`${KEY}.deleteDeactivateAccount`)}
          </Text>
        </Box>
        <IconButton size="300" radii="300" onClick={onCancel} aria-label={t(`${KEY}.cancel`)}>
          <Icon src={Icons.Cross} />
        </IconButton>
      </Header>
      <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
        <Text size="T300">{t(`${KEY}.thisWillRequestAccountDeactivationOnYour`)}</Text>
        <SettingTile
          title={eraseLabel}
          description={t(`${KEY}.ifEnabledTheHomeserverMayPermanentlyErase`)}
          after={
            <Switch
              variant="Critical"
              aria-label={eraseLabel}
              value={erase}
              onChange={setErase}
              disabled={busy}
            />
          }
        />
        {error && (
          <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
            {t(`${KEY}.deactivationFailed`, { error: describeKnownError(t, error.failure) ?? '' })}
            <ErrorDetail error={error.failure} />
          </Text>
        )}
        <Box gap="200" justifyContent="End">
          <Button variant="Secondary" fill="Soft" size="400" disabled={busy} onClick={onCancel}>
            <Text size="B400">{t(`${KEY}.cancel`)}</Text>
          </Button>
          <Button
            variant="Critical"
            size="400"
            disabled={busy}
            before={busy ? <Spinner size="100" variant="Critical" fill="Solid" /> : undefined}
            onClick={() => onConfirm(erase)}
          >
            <Text size="B400">{t(`${KEY}.deleteDeactivate`)}</Text>
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}

/**
 * Deactivates the signed-in account on its homeserver, asking for the password or single
 * sign-on again; then this device forgets the account and another stored one takes over.
 */
export function AccountDeactivation() {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const providerUrl = useProviderDeactivationUrl();
  const { run, prompt } = useAuthenticatedAction();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ failure: unknown }>();

  const deactivate = (erase: boolean) => {
    setBusy(true);
    setError(undefined);
    run((auth) => client.deactivateAccount(auth, erase))
      .then(() => removeCurrentClientSessionAndReload(client, getActiveSession()))
      .catch((failure: unknown) => {
        if (!alive()) return;
        setBusy(false);
        if (failure instanceof AuthenticationCancelled) return;
        setError({ failure });
      });
  };

  const close = () => {
    if (busy) return;
    setConfirming(false);
    setError(undefined);
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {t(`${KEY}.accountManagement`)}
      </Text>
      <SettingsCard>
        <SettingTile
          focusId="deactivateAccount"
          title={t(`${KEY}.deleteDeactivateAccount`)}
          description={t(
            providerUrl ? `${KEY}.descriptionWithProvider` : `${KEY}.descriptionWithoutProvider`
          )}
          after={
            <Box gap="200" wrap="Wrap" justifyContent="End">
              {providerUrl && (
                <Button
                  as="a"
                  href={providerUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  size="300"
                  radii="300"
                  variant="Secondary"
                  fill="Soft"
                >
                  <Text size="B300">{t(`${KEY}.openProviderPortal`)}</Text>
                </Button>
              )}
              <Button
                size="300"
                radii="300"
                variant="Critical"
                fill="Soft"
                onClick={() => setConfirming(true)}
              >
                <Text size="B300">{t(`${KEY}.deleteDeactivate`)}</Text>
              </Button>
            </Box>
          }
        />
      </SettingsCard>
      {confirming && (
        <SettingsOverlay onDismiss={close}>
          <ConfirmDeactivation busy={busy} error={error} onCancel={close} onConfirm={deactivate} />
        </SettingsOverlay>
      )}
      {prompt}
    </Box>
  );
}
