import { CSSProperties, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Box, Button, Icon, Icons, Spinner, Text, color, config } from 'folds';
import type { VerificationRequest } from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useAlive } from '../../lib/hooks/useAlive';
import { RecoveryUnlock } from '../encryption/RecoveryUnlock';
import { describeKey } from '../encryption/recoveryState';
import { useDefaultSecretStorageKey } from '../encryption/useDefaultSecretStorageKey';
import { ContainerColor } from '../../ui/styles/ContainerColor.css';
import { describeError } from '../../lib/describeError';
import { ErrorDetail } from '../../ui/ErrorDetail';

const KEY = 'featureUi.settings.devices.verification';

const EMPHASIS = { strong: <strong /> };

/** A button that reads as a link inside a sentence: no box, the sentence's own type and color. */
const INLINE_BUTTON: CSSProperties = {
  appearance: 'none',
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'inherit',
  font: 'inherit',
  textDecoration: 'underline',
  cursor: 'pointer',
};

type StepsProps = {
  /** Opens the recovery password form; missing when the account has no secret storage. */
  onManual?: () => void;
};

/** How to start the verification from a session that is already verified. */
function StepsFromOtherDevice({ onManual }: StepsProps) {
  const { t } = useTranslation();
  return (
    <Box direction="Column" gap="100">
      <Text size="T200">
        <b>{t(`${KEY}.stepsFromOtherDevice`)}</b>
      </Text>
      <Box
        as="ol"
        direction="Column"
        gap="100"
        style={{ margin: 0, paddingInlineStart: config.space.S500 }}
      >
        <Text as="li" size="T200">
          {t(`${KEY}.openVerifiedDevice`)}
        </Text>
        <Text as="li" size="T200">
          <Trans i18nKey={`${KEY}.openSettings`} components={{ settings: <strong /> }} />
        </Text>
        <Text as="li" size="T200">
          <Trans i18nKey={`${KEY}.findDevice`} components={{ section: <strong /> }} />
        </Text>
        <Text as="li" size="T200">
          {t(`${KEY}.initiateVerification`)}
        </Text>
      </Box>
      {onManual && (
        <Text size="T200">
          <Trans
            i18nKey={'sharedUi.recoveryPassword.manualHint'}
            components={{
              action: (
                <Text
                  as="button"
                  type="button"
                  size="T200"
                  onClick={onManual}
                  style={{ ...INLINE_BUTTON, fontWeight: 'bold' }}
                />
              ),
            }}
          />
        </Text>
      )}
    </Box>
  );
}

const PANEL_STYLE = {
  padding: config.space.S300,
  borderRadius: config.radii.R400,
};

type ThisDeviceVerificationProps = {
  /** Opens the verification dialog for a request this session sent to its other sessions. */
  onRequest: (request: VerificationRequest) => void;
  /** Called when an unlock with the recovery password or key starts. */
  onUnlockStarted?: () => void;
  /** Called when that unlock fails. */
  onUnlockFailed?: () => void;
};

/**
 * Shown under this session while the account's cross-signing does not vouch for it: asks the
 * account's other sessions to verify it, or unlocks secret storage with the recovery password or key, which
 * signs it with the account's own keys.
 */
export function ThisDeviceVerification({
  onRequest,
  onUnlockStarted,
  onUnlockFailed,
}: ThisDeviceVerificationProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const secretStorageKey = useDefaultSecretStorageKey();
  const [learnMore, setLearnMore] = useState(false);
  const [manual, setManual] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<{ failure: unknown }>();

  const requestVerification = () => {
    const crypto = client.getCrypto();
    if (!crypto || requesting) return;
    setRequesting(true);
    setError(undefined);
    crypto
      .requestOwnUserVerification()
      .then((request) => alive() && onRequest(request))
      .catch((failure: unknown) => {
        if (alive()) setError({ failure });
      })
      .finally(() => alive() && setRequesting(false));
  };

  const openManual = secretStorageKey ? () => setManual(true) : undefined;
  const helpKey = learnMore
    ? 'sharedUi.recoveryPassword.currentDeviceHelpLess'
    : 'sharedUi.recoveryPassword.currentDeviceHelpMore';

  return (
    <Box
      direction="Column"
      gap="300"
      className={ContainerColor({ variant: 'Warning' })}
      style={PANEL_STYLE}
    >
      {!unlocked && (
        <Box gap="300" alignItems="Start">
          <Icon src={Icons.ShieldUser} style={{ color: color.Warning.Main, flexShrink: 0 }} />
          <Box direction="Column" gap="200" grow="Yes" style={{ minWidth: 0 }}>
            <Text size="T300">{t(`${KEY}.verifyDeviceDescription`)}</Text>
            <Text size="T200">
              <Trans
                i18nKey={helpKey}
                components={{
                  ...EMPHASIS,
                  toggle: (
                    <Text
                      as="button"
                      type="button"
                      size="T200"
                      aria-expanded={learnMore}
                      onClick={() => setLearnMore((open) => !open)}
                      style={INLINE_BUTTON}
                    />
                  ),
                }}
              />
            </Text>
            {learnMore && <StepsFromOtherDevice onManual={openManual} />}
            {/* Under the text rather than beside it, so a phone keeps the sentence readable. */}
            <Box gap="200" alignItems="Center" wrap="Wrap">
              <Button
                size="300"
                radii="300"
                variant="Warning"
                fill="Solid"
                disabled={requesting}
                before={
                  requesting ? <Spinner size="50" variant="Warning" fill="Solid" /> : undefined
                }
                onClick={requestVerification}
              >
                <Text size="B300">{t(`${KEY}.verify`)}</Text>
              </Button>
              {openManual && !manual && (
                <Button size="300" radii="300" variant="Warning" fill="Soft" onClick={openManual}>
                  <Text size="B300">{t('sharedUi.recoveryPassword.useRecoveryPassword')}</Text>
                </Button>
              )}
            </Box>
            {error && (
              <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
                {describeError(t, error.failure)}
                <ErrorDetail error={error.failure} />
              </Text>
            )}
          </Box>
        </Box>
      )}
      {manual && secretStorageKey && (
        <RecoveryUnlock
          secretStorageKey={describeKey(secretStorageKey)}
          onUnlockStarted={onUnlockStarted}
          onUnlockFailed={onUnlockFailed}
          onUnlocked={() => setUnlocked(true)}
        />
      )}
    </Box>
  );
}
