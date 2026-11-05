import { MouseEventHandler, ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { Box, Chip, Icon, Icons, RectCords, Spinner, Text, color, config } from 'folds';
import { PopOut } from '../../ui/directional';
import { Menu, MenuItem } from '../../ui/glass/GlassPrimitives';
import { SettingTile } from '../../ui/setting-tile/SettingTile';
import {
  SecretStorageKeyContent,
  SecretStorageRecoveryKey,
  SecretStorageRecoveryPassphrase,
} from '../encryption/SecretStorage';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../lib/hooks/useAsyncCallback';
import {
  CRYPTO_NOT_FOUND,
  NO_CROSS_SIGNING_KEYS_IN_SECRET_STORAGE,
  unlockWithRecoveryKey,
} from '../encryption/unlockWithRecoveryKey';
import { errorMessage } from '../../lib/errorMessage';
import { describeKnownError } from '../../lib/describeError';
import { ErrorDetail } from '../../ui/ErrorDetail';

const INTERNAL_ERRORS: ReadonlySet<string> = new Set([CRYPTO_NOT_FOUND]);

enum VerificationMethod {
  RecoveryKey = 'recovery-key',
  RecoveryPassphrase = 'recovery-passphrase',
}

/** Escape closes only the menu, not a dialog the tile sits in. */
const keepEscapeInsideMenu = (evt: KeyboardEvent) => {
  evt.stopPropagation();
  return true;
};

const menuTrapOptions = (close: () => void): FocusTrap.Props['focusTrapOptions'] => ({
  initialFocus: false,
  clickOutsideDeactivates: true,
  escapeDeactivates: keepEscapeInsideMenu,
  onDeactivate: close,
});

type MethodSwitcherProps = {
  value: VerificationMethod;
  hasPassphrase: boolean;
  onChange: (method: VerificationMethod) => void;
};

function ManualVerificationMethodSwitcher({ value, hasPassphrase, onChange }: MethodSwitcherProps) {
  const { t } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const label = (method: VerificationMethod) =>
    method === VerificationMethod.RecoveryKey
      ? t('sharedUi.manualVerification.recoveryKey')
      : t('sharedUi.manualVerification.recoveryPassphrase');

  const handleOpen: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuAnchor(evt.currentTarget.getBoundingClientRect());
  };
  const handleSelect = (method: VerificationMethod) => {
    onChange(method);
    setMenuAnchor(undefined);
  };

  const methods = hasPassphrase
    ? [VerificationMethod.RecoveryKey, VerificationMethod.RecoveryPassphrase]
    : [VerificationMethod.RecoveryKey];

  return (
    <>
      <Chip
        variant="Secondary"
        radii="Pill"
        after={<Icon src={Icons.ChevronBottom} size="100" />}
        onClick={handleOpen}
        aria-haspopup="menu"
        aria-expanded={!!menuAnchor}
      >
        <Text size="B300">{label(value)}</Text>
      </Chip>
      <PopOut
        anchor={menuAnchor}
        position="Bottom"
        align="End"
        offset={4}
        content={
          <FocusTrap focusTrapOptions={menuTrapOptions(() => setMenuAnchor(undefined))}>
            <Menu role="menu">
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                {methods.map((method) => (
                  <MenuItem
                    key={method}
                    size="300"
                    radii="300"
                    role="menuitemradio"
                    aria-checked={method === value}
                    onClick={() => handleSelect(method)}
                  >
                    <Text size="T300">{label(method)}</Text>
                  </MenuItem>
                ))}
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}

type VerificationStatusProps = {
  tone: 'Success' | 'Critical';
  children: ReactNode;
  /** An error whose own text goes under the status, smaller. */
  detailOf?: unknown;
};

function VerificationStatus({ tone, children, detailOf }: VerificationStatusProps) {
  return (
    <Text size="T200" style={{ color: color[tone].Main }}>
      <b>{children}</b>
      <ErrorDetail error={detailOf} />
    </Text>
  );
}

type TileProps = {
  secretStorageKeyId: string;
  secretStorageKeyContent: SecretStorageKeyContent;
};

/** Verifies this device by unlocking secret storage with the recovery key or passphrase. */
export function ManualVerificationTile(props: TileProps) {
  const { secretStorageKeyId: keyId, secretStorageKeyContent: keyContent } = props;
  const { t } = useTranslation();
  const client = useMatrixClient();
  const passphraseContent = keyContent.passphrase;
  const [method, setMethod] = useState(VerificationMethod.RecoveryKey);

  const [verifyState, verify] = useAsyncCallback(
    useCallback(
      (recoveryKey: Uint8Array) => unlockWithRecoveryKey(client, keyId, recoveryKey),
      [client, keyId]
    )
  );

  const handleDecodedRecoveryKey = (recoveryKey: Uint8Array) => {
    verify(recoveryKey).catch(() => undefined);
  };

  /**
   * The unlock's own failures and the ones `describeKnownError` recognizes in words (the latter
   * with the error's text beside them); any other error as it was thrown, which the ported
   * tests expect.
   */
  const describeFailure = (error: unknown): { text: string; detailOf?: unknown } => {
    const message = errorMessage(error);
    if (message === NO_CROSS_SIGNING_KEYS_IN_SECRET_STORAGE) {
      return { text: t('sharedUi.manualVerification.noCrossSigningKeys') };
    }
    if (INTERNAL_ERRORS.has(message)) {
      return { text: t('sharedUi.deviceVerificationSetup.unexpectedError') };
    }
    const known = describeKnownError(t, error);
    return known === undefined ? { text: message } : { text: known, detailOf: error };
  };
  const failure =
    verifyState.status === AsyncStatus.Error ? describeFailure(verifyState.error) : undefined;

  const passphraseChosen = method === VerificationMethod.RecoveryPassphrase && !!passphraseContent;

  return (
    <Box direction="Column" gap="200">
      <SettingTile
        title={t('sharedUi.manualVerification.verifyManually')}
        description={
          passphraseContent
            ? t('sharedUi.manualVerification.selectAVerificationMethod')
            : t('sharedUi.manualVerification.provideRecoveryKey')
        }
        after={
          <ManualVerificationMethodSwitcher
            value={method}
            hasPassphrase={!!passphraseContent}
            onChange={setMethod}
          />
        }
      />
      {verifyState.status === AsyncStatus.Success ? (
        <VerificationStatus tone="Success">
          {t('sharedUi.manualVerification.deviceVerified')}
        </VerificationStatus>
      ) : (
        <>
          {passphraseChosen && passphraseContent ? (
            <SecretStorageRecoveryPassphrase
              keyContent={keyContent}
              passphraseContent={passphraseContent}
              onDecodedRecoveryKey={handleDecodedRecoveryKey}
            />
          ) : (
            <SecretStorageRecoveryKey
              keyContent={keyContent}
              onDecodedRecoveryKey={handleDecodedRecoveryKey}
            />
          )}
          {verifyState.status === AsyncStatus.Loading && (
            <Box alignItems="Center" gap="200">
              <Spinner size="100" variant="Secondary" />
            </Box>
          )}
          {failure && (
            <VerificationStatus tone="Critical" detailOf={failure.detailOf}>
              {failure.text}
            </VerificationStatus>
          )}
        </>
      )}
    </Box>
  );
}
