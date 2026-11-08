import { ChangeEvent, FormEvent, ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Icon, Icons, Spinner, Text, color } from 'folds';
import { ImportRoomKeyStage, type ImportRoomKeyProgressData } from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useAlive } from '../../lib/hooks/useAlive';
import { SettingTile } from '../../ui/SettingTile';
import { PasswordInput } from '../../ui/PasswordInput';
import {
  RoomKeyExportError,
  decryptRoomKeyExport,
  encryptRoomKeyExport,
} from '../encryption/roomKeyExport';
import { SettingsCard } from '../../ui/settings/SettingsCard';
import { saveFile } from '../../native/nativeFileSave';
import { describeError } from '../../lib/describeError';
import { ErrorDetail } from '../../ui/ErrorDetail';
import { isSecretPasswordLongEnough } from '../encryption/secretPassword';

const KEY = 'featureUi.settings.devices.localBackup';
const EXPORT_FILE_NAME = 'mindroom-room-keys.txt';

/** A failed outcome keeps the error it came from when its text cannot say all of it. */
type Outcome = { ok: true; text: string } | { ok: false; text: string; failure?: unknown };

function OutcomeLine({ outcome }: { outcome?: Outcome }) {
  if (!outcome) return null;
  return (
    <Box alignItems="Center" gap="100" role={outcome.ok ? 'status' : 'alert'}>
      <Icon
        size="50"
        src={outcome.ok ? Icons.Check : Icons.Warning}
        style={{ color: outcome.ok ? color.Success.Main : color.Critical.Main }}
      />
      <Text size="T200" style={outcome.ok ? undefined : { color: color.Critical.Main }}>
        {outcome.text}
        {!outcome.ok && <ErrorDetail error={outcome.failure} />}
      </Text>
    </Box>
  );
}

type ToggleTileProps = {
  /** The tile's setting in the settings registry. */
  focusId: string;
  title: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
};

/** A tile whose form unfolds under it, so the toggle keeps its place beside the title. */
function ToggleTile({ focusId, title, description, open, onToggle, children }: ToggleTileProps) {
  const { t } = useTranslation();
  const label = open ? t(`${KEY}.collapse`) : t(`${KEY}.expand`);
  return (
    <Box direction="Column" gap="300">
      <SettingTile
        focusId={focusId}
        title={title}
        description={description}
        after={
          <Button
            size="300"
            radii="300"
            variant="Secondary"
            fill="Soft"
            aria-expanded={open}
            aria-label={`${label} ${title}`}
            after={<Icon size="50" src={open ? Icons.ChevronTop : Icons.ChevronBottom} />}
            onClick={onToggle}
          >
            <Text size="B300">{label}</Text>
          </Button>
        }
      />
      {open && children}
    </Box>
  );
}

/** Saves every room key this session holds, encrypted with a new password, as a file. */
function ExportKeys() {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const mismatch = confirmation.length > 0 && confirmation !== password;
  const longEnough = isSecretPasswordLongEnough(password);
  const tooShort = password.length > 0 && !longEnough;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const crypto = client.getCrypto();
    if (busy || !longEnough || mismatch) return;
    setOutcome(undefined);
    if (!crypto) {
      setOutcome({ ok: false, text: t(`${KEY}.cryptoModuleNotFound`) });
      return;
    }
    setBusy(true);
    try {
      const file = await encryptRoomKeyExport(await crypto.exportRoomKeysAsJson(), password);
      // The iOS app has no downloads; there the platform's save sheet asks where to put it.
      const saved = await saveFile(
        new Blob([file], { type: 'text/plain;charset=us-ascii' }),
        EXPORT_FILE_NAME
      );
      if (!alive() || !saved) return;
      setPassword('');
      setConfirmation('');
      setOutcome({ ok: true, text: EXPORT_FILE_NAME });
    } catch (failure) {
      if (alive()) {
        setOutcome({ ok: false, text: describeError(t, failure), failure });
      }
    } finally {
      if (alive()) setBusy(false);
    }
  };

  return (
    <ToggleTile
      focusId="exportKeys"
      title={t(`${KEY}.exportMessagesData`)}
      description={t(`${KEY}.savePasswordProtectedCopyOfEncryptionData`)}
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      <Box
        as="form"
        direction="Column"
        gap="200"
        onSubmit={(event: FormEvent<HTMLFormElement>) => void submit(event)}
      >
        <Box gap="200" wrap="Wrap">
          <Box direction="Column" gap="100" grow="Yes">
            <Text size="L400">{t(`${KEY}.newPassword`)}</Text>
            <PasswordInput
              name="exportPassword"
              autoComplete="new-password"
              size="300"
              variant={tooShort ? 'Critical' : 'Background'}
              outlined
              required
              aria-invalid={tooShort}
              aria-describedby={tooShort ? 'exportPasswordTooShort' : undefined}
              value={password}
              disabled={busy}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
            />
            {tooShort && (
              <Text id="exportPasswordTooShort" size="T200" style={{ color: color.Critical.Main }}>
                {t(`${KEY}.passwordTooShort`)}
              </Text>
            )}
          </Box>
          <Box direction="Column" gap="100" grow="Yes">
            <Text size="L400">{t(`${KEY}.confirmPassword`)}</Text>
            <PasswordInput
              name="exportPasswordConfirmation"
              autoComplete="new-password"
              size="300"
              variant={mismatch ? 'Critical' : 'Background'}
              outlined
              required
              aria-invalid={mismatch}
              value={confirmation}
              disabled={busy}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setConfirmation(event.target.value)
              }
            />
          </Box>
        </Box>
        <Box gap="200" alignItems="Center">
          <Button
            type="submit"
            size="300"
            radii="300"
            variant="Primary"
            fill="Soft"
            disabled={busy || !longEnough || confirmation !== password}
            before={busy ? <Spinner size="50" variant="Primary" /> : undefined}
          >
            <Text size="B300">{t(`${KEY}.export`)}</Text>
          </Button>
          <OutcomeLine outcome={outcome} />
        </Box>
      </Box>
    </ToggleTile>
  );
}

const importPercent = (progress?: ImportRoomKeyProgressData): number =>
  progress?.stage === ImportRoomKeyStage.LoadKeys && progress.total > 0
    ? Math.floor(((progress.successes + progress.failures) / progress.total) * 100)
    : 0;

/** Reads a key file exported here or by another Matrix client and adds its keys to this session. */
function ImportKeys() {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [password, setPassword] = useState('');
  const [progress, setProgress] = useState<ImportRoomKeyProgressData | 'decrypting'>();
  const [outcome, setOutcome] = useState<Outcome>();
  const busy = progress !== undefined;

  const failed = (failure: unknown): Outcome => {
    if (failure instanceof RoomKeyExportError) {
      const text =
        failure.reason === 'passphrase'
          ? t('sharedUi.passwordStage.invalidPassword')
          : t('errors.notKeyExport');
      return { ok: false, text };
    }
    return { ok: false, text: describeError(t, failure), failure };
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const crypto = client.getCrypto();
    if (busy || !file || !password) return;
    setOutcome(undefined);
    if (!crypto) {
      setOutcome({ ok: false, text: t(`${KEY}.cryptoModuleNotFound`) });
      return;
    }
    setProgress('decrypting');
    try {
      const json = await decryptRoomKeyExport(await file.text(), password);
      let total = 0;
      await crypto.importRoomKeysAsJson(json, {
        progressCallback: (next) => {
          if (next.stage === ImportRoomKeyStage.LoadKeys) total = next.total;
          if (alive()) setProgress(next);
        },
      });
      if (!alive()) return;
      setPassword('');
      setOutcome({ ok: true, text: t('sharedUi.backupRestore.keys', { keyCount: total }) });
    } catch (failure) {
      if (alive()) setOutcome(failed(failure));
    } finally {
      if (alive()) setProgress(undefined);
    }
  };

  const percent = progress && progress !== 'decrypting' ? importPercent(progress) : 0;

  return (
    <ToggleTile
      focusId="importKeys"
      title={t(`${KEY}.importMessagesData`)}
      description={t(`${KEY}.loadPasswordProtectedCopyOfEncryptionData`)}
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      <Box
        as="form"
        direction="Column"
        gap="200"
        onSubmit={(event: FormEvent<HTMLFormElement>) => void submit(event)}
      >
        <input
          ref={fileInput}
          type="file"
          accept=".txt,text/plain"
          hidden
          onChange={(event) => {
            setFile(event.target.files?.[0]);
            setOutcome(undefined);
          }}
        />
        <Box>
          <Button
            type="button"
            size="300"
            radii="300"
            variant="Secondary"
            fill="Soft"
            disabled={busy}
            aria-label={`${t(`${KEY}.importMessagesData`)}: ${
              file?.name ?? t('featureUi.settings.emojisStickers.globalPacks.select')
            }`}
            before={<Icon size="50" src={Icons.File} />}
            onClick={() => fileInput.current?.click()}
          >
            <Text size="B300" truncate>
              {file?.name ?? t('featureUi.settings.emojisStickers.globalPacks.select')}
            </Text>
          </Button>
        </Box>
        <Box direction="Column" gap="100">
          <Text size="L400">{t(`${KEY}.password`)}</Text>
          <PasswordInput
            name="importPassword"
            autoComplete="off"
            size="300"
            variant="Background"
            outlined
            required
            value={password}
            disabled={busy}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
          />
        </Box>
        <Box gap="200" alignItems="Center">
          <Button
            type="submit"
            size="300"
            radii="300"
            variant="Primary"
            fill="Soft"
            disabled={busy || !file || !password}
            before={busy ? <Spinner size="50" variant="Primary" /> : undefined}
          >
            <Text size="B300">
              {progress && progress !== 'decrypting'
                ? t('sharedUi.backupRestore.restoring', { progress: percent })
                : t(`${KEY}.import`)}
            </Text>
          </Button>
          <OutcomeLine outcome={outcome} />
        </Box>
      </Box>
    </ToggleTile>
  );
}

/** Export and import of room keys as a password-protected file kept on the device. */
export function LocalKeyBackup() {
  const { t } = useTranslation();
  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {t(`${KEY}.localBackup`)}
      </Text>
      <SettingsCard>
        <ExportKeys />
        <ImportKeys />
      </SettingsCard>
    </Box>
  );
}
