import { useCallback, useEffect, useRef, useState, ReactNode } from 'react';
import {
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Spinner,
  Switch,
  Text,
  color,
  config,
  toRem,
} from 'folds';
import { useSetAtom } from 'jotai';
import { Trans, useTranslation } from 'react-i18next';
import { ViewerOverlay } from '../../messages/content/FileContent';
import { SequenceCard } from '../../ui/SequenceCard';
import { SettingTile } from '../../ui/SettingTile';
import { TextViewer } from '../../messages/viewers/TextViewer';
import { useClientConfig } from '../../config/useClientConfig';
import { appUrl } from '../../lib/basePath';
import { copyToClipboard } from '../../lib/dom';
import { CheckIcon, CopyIcon } from '../../rich-text/code/CodeBlockIcons';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { tourAtom, type TourLevel } from '../../navigation/tourState';
import { MINDROOM_CLIENT_BRANDING, getWelcomePageContent } from '../../ui/branding/clientBranding';
import { isNativeIOS } from '../../native/nativeSso';
import { MacAppIcon } from '../../native/MacAppIcon';
import {
  MAC_APP_BREW_COMMAND,
  useMacAppDownloadUrl,
  useOffersMacApp,
} from '../../native/macApp';
import { saveFile } from '../../native/nativeFileSave';
import { getFlightRecorderStatus } from '../../diagnostics/flightRecorder';
import {
  clearDeepTrace,
  getDeepTraceEnabled,
  getDeepTraceRuntimeStatus,
  setDeepTraceEnabled,
  subscribeDeepTraceStatus,
} from '../../diagnostics/deepTrace';
import { buildDiagnosticsExport } from '../../diagnostics/diagnosticsExport';
import { getDebugModeEnabled, setDebugModeEnabled } from '../../diagnostics/debugMode';
import { APP_RELEASE_VERSION } from '../../config/appVersion';
import { parseDsn } from '../../bug-reports/error-reporting/errorReporting';
import { SettingSwitchTile } from '../../ui/settings/SettingSwitchTile';
import { SettingsPageFrame } from '../../ui/settings/SettingsPageFrame';
import { SequenceCardStyle } from '../../ui/settings/styles.css';

type TraceNotice = 'storage-unavailable' | 'restart-may-reenable' | undefined;

function DiagnosticsExport() {
  const { t } = useTranslation();
  const [status] = useState(() => getFlightRecorderStatus());
  const [exporting, setExporting] = useState(false);
  const [failed, setFailed] = useState(false);
  const exportingRef = useRef(false);

  const statusText =
    status === 'unexpected'
      ? t('featureUi.settings.about.diagnosticsUnexpected')
      : status === 'unavailable'
      ? t('featureUi.settings.about.diagnosticsUnavailable')
      : t('featureUi.settings.about.diagnosticsNone');

  const handleExport = async () => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    setFailed(false);
    try {
      const { blob, fileName } = await buildDiagnosticsExport();
      await saveFile(blob, fileName);
    } catch {
      // Unreadable storage is already what the status says; anything else is an export failure.
      if (status !== 'unavailable') setFailed(true);
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  };

  const description = failed
    ? t('featureUi.settings.about.diagnosticsExportFailed', { description: statusText })
    : statusText;

  return (
    <SettingTile
      focusId="diagnosticsExport"
      title={t('featureUi.settings.about.onDeviceDiagnostics')}
      description={description}
      after={
        <Button
          size="300"
          variant="Secondary"
          fill="Soft"
          radii="300"
          outlined
          disabled={exporting}
          onClick={() => void handleExport()}
          before={exporting ? <Spinner size="100" /> : undefined}
        >
          <Text size="B300">{t('featureUi.settings.about.exportDiagnostics')}</Text>
        </Button>
      }
    />
  );
}

function DeepTraceSetting() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(() => getDeepTraceEnabled());
  const [runtimeStatus, setRuntimeStatus] = useState(() => getDeepTraceRuntimeStatus());
  const [notice, setNotice] = useState<TraceNotice>();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  useEffect(() => subscribeDeepTraceStatus((status) => setRuntimeStatus(status)), []);

  const handleToggle = useCallback(async (next: boolean) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setNotice(undefined);
    let saved = false;
    try {
      saved = await setDeepTraceEnabled(next);
    } catch {
      saved = false;
    }
    if (saved) {
      setEnabled(next);
    } else if (next) {
      // The intent may be saved even though the recorder could not start.
      const savedIntent = getDeepTraceEnabled();
      setEnabled(savedIntent);
      if (!savedIntent) setNotice('storage-unavailable');
    } else {
      // Tracing stopped for this session, but the saved preference did not change.
      setEnabled(false);
      setNotice('restart-may-reenable');
    }
    pendingRef.current = false;
    setPending(false);
  }, []);

  const handleClear = async () => {
    try {
      await clearDeepTrace();
    } finally {
      setRuntimeStatus(getDeepTraceRuntimeStatus());
    }
  };

  let description: string;
  if (notice === 'storage-unavailable') {
    description = t('featureUi.settings.about.traceStorageUnavailable');
  } else if (notice === 'restart-may-reenable') {
    description = t('featureUi.settings.about.deepTracePreferenceSaveFailed', {
      description: t('featureUi.settings.about.deepTraceOff'),
    });
  } else if (!enabled) {
    description = t('featureUi.settings.about.deepTraceOff');
  } else if (runtimeStatus === 'recording') {
    description = t('featureUi.settings.about.deepTraceRecording');
  } else if (runtimeStatus === 'memory-only') {
    description = t('featureUi.settings.about.deepTraceMemoryOnly');
  } else if (runtimeStatus === 'unavailable') {
    description = t('featureUi.settings.about.deepTraceEnabledStorageUnavailable');
  } else {
    // Enabled and not recording yet.
    description = t('featureUi.settings.about.deepTraceStarting');
  }

  return (
    <SettingTile
      focusId="deepTrace"
      title={t('featureUi.settings.about.deepDiagnosticTracing')}
      description={description}
      after={
        <Box alignItems="Center" gap="200">
          <Button
            size="300"
            variant="Secondary"
            fill="Soft"
            radii="300"
            outlined
            disabled={pending}
            onClick={() => void handleClear()}
          >
            <Text size="B300">{t('featureUi.settings.about.clearTrace')}</Text>
          </Button>
          <Switch
            variant="Primary"
            value={enabled}
            onChange={(next) => void handleToggle(next)}
            disabled={pending}
          />
        </Box>
      }
    />
  );
}

/**
 * Debug mode, on every platform: on, the composer offers "Attach app logs". In a browser, where the
 * iOS app's diagnostics are off until it is turned on, it also shows the diagnostics export and the
 * deep tracing switch; the iOS app keeps its recorders (`keepRecorders`) whatever it says.
 */
function DebugModeSetting({
  enabled,
  keepRecorders,
  onChange,
}: {
  enabled: boolean;
  keepRecorders: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);

  const handleToggle = async (next: boolean) => {
    setPending(true);
    try {
      await setDebugModeEnabled(next, { keepRecorders });
    } catch {
      // The switch shows the saved choice again below.
    } finally {
      setPending(false);
      onChange(getDebugModeEnabled());
    }
  };

  return (
    <SettingTile
      focusId="debugMode"
      title={t('featureUi.settings.about.debugMode')}
      description={t('featureUi.settings.about.debugModeDescription')}
      after={
        <Switch
          variant="Primary"
          value={enabled}
          onChange={(next) => void handleToggle(next)}
          disabled={pending}
        />
      }
    />
  );
}

/** Whether this device sends error reports to the collector the deployment names (`host`). */
function ErrorReportsSetting({ host }: { host: string }) {
  const { t } = useTranslation();
  const description = t('featureUi.settings.errorReports.description');
  const collector = t('featureUi.settings.errorReports.collector', { host });
  return (
    <SettingSwitchTile
      focusId="errorReports"
      setting="sendErrorReports"
      title={t('featureUi.settings.errorReports.title')}
      description={`${description} ${collector}`}
    />
  );
}

/**
 * Starts the interface tour in either of its levels. `onStart` closes Settings, so that the tour
 * shows.
 */
function TourSetting({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation();
  const setTour = useSetAtom(tourAtom);
  const phone = useScreenSizeContext() === ScreenSize.Mobile;

  const start = (level: TourLevel) => {
    setTour({ level });
    onStart();
  };

  const buttons = (
    <Box wrap="Wrap" gap="200">
      <Button size="300" radii="300" variant="Primary" fill="Soft" onClick={() => start('quick')}>
        <Text size="B300">{t('tour.offer.quick')}</Text>
      </Button>
      <Button size="300" radii="300" variant="Secondary" fill="Soft" onClick={() => start('full')}>
        <Text size="B300">{t('tour.offer.full')}</Text>
      </Button>
    </Box>
  );

  // The trailing slot keeps its content's width, and the two buttons side by side leave a phone's
  // tile no room for its text: there they go under the description, where they can wrap.
  return (
    <SettingTile
      focusId="tour"
      title={t('tour.entries.settingsTitle')}
      description={t('tour.entries.settingsDescription')}
      after={phone ? undefined : buttons}
    >
      {phone ? buttons : null}
    </SettingTile>
  );
}

/**
 * The Mac app, in a browser on a Mac: its disk image, and the Homebrew command that installs it,
 * with a button that copies it. A phone's tile has no room beside its text for the download, which
 * goes under the command there.
 */
function MacAppSetting() {
  const { t } = useTranslation();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const downloadUrl = useMacAppDownloadUrl();
  // Undefined until a copy was tried; copyToClipboard resolves false when every clipboard failed.
  const [copied, setCopied] = useState<boolean>();
  const copyStatus =
    copied === undefined
      ? ''
      : copied
      ? t('messageCodeBlock.copied')
      : t('featureUi.macApp.copyFailed');
  const copy = () => {
    // Emptied first, so the live region announces a second copy's outcome again.
    setCopied(undefined);
    void copyToClipboard(MAC_APP_BREW_COMMAND).then(setCopied);
  };

  const download = (
    <Button
      as="a"
      href={downloadUrl}
      target="_blank"
      rel="noreferrer noopener"
      size="300"
      radii="300"
      variant="Primary"
      fill="Solid"
      before={<Icon size="100" src={Icons.Download} />}
      data-mac-app-download="about"
    >
      <Text size="B300">{t('featureUi.macApp.downloadDmg')}</Text>
    </Button>
  );

  return (
    <SettingTile
      focusId="macApp"
      before={<Icon size="200" src={MacAppIcon} />}
      title={t('featureUi.macApp.title')}
      description={t('featureUi.macApp.text')}
      after={phone ? undefined : download}
    >
      <Box direction="Column" alignItems="Start" gap="200">
        <Box
          alignItems="Center"
          gap="200"
          style={{
            maxWidth: '100%',
            paddingInlineStart: config.space.S300,
            paddingInlineEnd: config.space.S100,
            paddingBlock: config.space.S100,
            borderRadius: config.radii.R300,
            backgroundColor: color.Background.Container,
          }}
        >
          <Text
            as="code"
            size="T200"
            className="selectable"
            style={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}
          >
            {MAC_APP_BREW_COMMAND}
          </Text>
          <IconButton
            size="300"
            radii="300"
            variant="Background"
            fill="None"
            aria-label={t('featureUi.macApp.copyCommand')}
            data-mac-app-copy-brew=""
            onClick={copy}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </IconButton>
          {/* Always there, so a screen reader hears what a copy did; empty until one is tried. */}
          <Text
            as="span"
            size="T200"
            aria-live="polite"
            data-mac-app-copy-status=""
            style={copied === false ? { color: color.Critical.Main } : undefined}
          >
            {copyStatus}
          </Text>
        </Box>
        {phone ? download : null}
      </Box>
    </SettingTile>
  );
}

type AboutProps = {
  requestClose: () => void;
  /**
   * Closes the whole Settings dialog where `requestClose` only leaves the page, as on a phone,
   * whose pages close back to the menu. A tour starts through it, or else through `requestClose`.
   */
  closeDialog?: () => void;
};

/**
 * Third-party work the client ships, in display order. Each translation names
 * the project in its own tag (`project`), the copyright holder in `<owner>`,
 * and the license in `<license>`. Third-party notices lists the rest. Emoji come
 * from the system's fonts, so no emoji art or font is credited.
 */
const CREDITS = [
  {
    i18nKey: 'featureUi.settings.about.matrixSdkCredit',
    tag: 'sdk',
    project: 'https://github.com/matrix-org/matrix-js-sdk',
    license: 'https://github.com/matrix-org/matrix-js-sdk/blob/develop/LICENSE',
  },
] as const;

/** A credit's link; `Trans` fills in the linked text. */
function CreditLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a target="_blank" rel="noreferrer noopener" href={href}>
      {children}
    </a>
  );
}

function CreditsList() {
  const { t } = useTranslation();
  // The card gives each row an inline padding of S400, where the other rows' text starts; the
  // items start 1.25em further in, so their bullets hang inside the card, not on its border.
  return (
    <Box
      as="ul"
      direction="Column"
      gap="200"
      style={{ margin: 0, paddingInlineStart: `calc(${config.space.S400} + 1.25em)` }}
    >
      {CREDITS.map(({ i18nKey, tag, project, license }) => {
        const components = {
          [tag]: <CreditLink href={project} />,
          owner: <span />,
          license: <CreditLink href={license} />,
        };
        return (
          <li key={i18nKey}>
            <Text size="T300">
              <Trans i18nKey={i18nKey} components={components} />
            </Text>
          </li>
        );
      })}
      {/* public/sound/notification.ogg and invite.ogg: sine tones made for this client. */}
      <li>
        <Text size="T300">{t('featureUi.settings.about.soundsCredit')}</Text>
      </li>
    </Box>
  );
}

/** The npm dependencies' licenses and notices, written into the build by scripts/third-party-notices.mjs. */
const THIRD_PARTY_NOTICES = 'public/licenses/THIRD_PARTY_NOTICES.txt';

/**
 * Opens the bundled third-party notices in the text viewer. A link would not do: the iOS app's web
 * view hands new-window links to the system, which cannot open the app's own files.
 */
function ThirdPartyNotices() {
  const { t } = useTranslation();
  const [text, setText] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const close = useCallback(() => setText(undefined), []);
  const title = t('featureUi.settings.about.thirdPartyNotices');

  const open = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch(appUrl(THIRD_PARTY_NOTICES));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setText(await response.text());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box direction="Column" alignItems="Start" gap="200">
      {text !== undefined && (
        <ViewerOverlay label={title} onClose={close}>
          <TextViewer name={title} langName="text" text={text} requestClose={close} />
        </ViewerOverlay>
      )}
      <Button
        size="300"
        radii="300"
        variant="Secondary"
        fill="Soft"
        disabled={loading}
        onClick={() => void open()}
        before={loading ? <Spinner size="100" /> : <Icon size="100" src={Icons.File} />}
      >
        <Text size="B300">{title}</Text>
      </Button>
      {failed && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {t('errors.noConnection')}
        </Text>
      )}
    </Box>
  );
}

/** A titled group of setting tiles. */
function AboutSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {title}
      </Text>
      <SequenceCard
        variant="SurfaceVariant"
        className={SequenceCardStyle}
        direction="Column"
        gap="400"
      >
        {children}
      </SequenceCard>
    </Box>
  );
}

/** Logo, app name, release version, tagline and the source code link. */
function AppIdentity() {
  const { t } = useTranslation();
  const { welcome } = useClientConfig();
  const { subtitle } = getWelcomePageContent(welcome as never, t);
  const { appName, logoAlt, logoSrc, sourceUrl } = MINDROOM_CLIENT_BRANDING;
  const logoSize = toRem(60);

  return (
    <Box alignItems="Center" gap="400">
      <img src={logoSrc} alt={logoAlt} style={{ height: logoSize, width: logoSize }} />
      <Box direction="Column" gap="100">
        <Box alignItems="End" gap="100">
          <Text size="H3">{appName}</Text>
          <Text size="T200">{APP_RELEASE_VERSION}</Text>
        </Box>
        <Text size="T300">{subtitle}</Text>
        <Box wrap="Wrap" gap="200" style={{ paddingTop: config.space.S400 }}>
          <Button
            as="a"
            href={sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            size="300"
            radii="300"
            variant="Secondary"
            fill="Soft"
            before={<Icon size="100" src={Icons.Code} filled />}
          >
            <Text size="B300">{t('featureUi.settings.about.sourceCode')}</Text>
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * App version, debug mode, diagnostics tools (always in the iOS app, behind debug mode elsewhere),
 * error reports when configured, the interface tour, and credits.
 */
export function About({ requestClose, closeDialog }: AboutProps) {
  const { t } = useTranslation();
  const nativeDiagnostics = isNativeIOS();
  const [debugMode, setDebugMode] = useState(() => getDebugModeEnabled());
  const diagnostics = nativeDiagnostics || debugMode;
  const collectorHost = parseDsn(useClientConfig().errorReporting?.dsn)?.host;
  const macApp = useOffersMacApp();

  return (
    <SettingsPageFrame title={t('settings.nav.about')} requestClose={requestClose}>
      <AppIdentity />
      <AboutSection title={t('featureUi.settings.about.options')}>
        {macApp && <MacAppSetting />}
        <DebugModeSetting
          enabled={debugMode}
          keepRecorders={nativeDiagnostics}
          onChange={setDebugMode}
        />
        {diagnostics && <DiagnosticsExport />}
        {diagnostics && <DeepTraceSetting />}
        {collectorHost && <ErrorReportsSetting host={collectorHost} />}
      </AboutSection>
      <AboutSection title={t('tour.entries.settingsSection')}>
        <TourSetting onStart={closeDialog ?? requestClose} />
      </AboutSection>
      <AboutSection title={t('featureUi.settings.about.credits')}>
        <CreditsList />
        <ThirdPartyNotices />
      </AboutSection>
    </SettingsPageFrame>
  );
}
