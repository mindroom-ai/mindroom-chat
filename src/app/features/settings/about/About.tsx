import React, { useCallback, useEffect, useRef, useState, ReactNode } from 'react';
import { Box, Button, Icon, IconButton, Icons, Spinner, Switch, Text, config, toRem } from 'folds';
import { Trans, useTranslation } from 'react-i18next';
import { Page, PageContent, PageHeader, PageScroll } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { clearAllCacheAndReload } from '../../../../client/initMatrix';
import {
  MINDROOM_CLIENT_BRANDING,
  getMindroomWelcomePageContent,
} from '../../../mindroom/branding/clientBranding';
import { isNativeIOS } from '../../../mindroom/native/nativeSso';
import { saveFile } from '../../../mindroom/native/nativeFileSave';
import { getFlightRecorderStatus } from '../../../mindroom/diagnostics/flightRecorder';
import {
  clearDeepTrace,
  getDeepTraceEnabled,
  getDeepTraceRuntimeStatus,
  setDeepTraceEnabled,
  subscribeDeepTraceStatus,
} from '../../../mindroom/diagnostics/deepTrace';
import { buildDiagnosticsExport } from '../../../mindroom/diagnostics/diagnosticsExport';
import { APP_RELEASE_VERSION } from '../../../../appVersion';
import { SequenceCardStyle } from '../styles.css';

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
          onClick={handleExport}
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
            onClick={handleClear}
          >
            <Text size="B300">{t('featureUi.settings.about.clearTrace')}</Text>
          </Button>
          <Switch variant="Primary" value={enabled} onChange={handleToggle} disabled={pending} />
        </Box>
      }
    />
  );
}

type AboutProps = {
  requestClose: () => void;
};

const CC_BY_4 = 'https://creativecommons.org/licenses/by/4.0/';

/**
 * Third-party work the client ships, in display order. Each translation names
 * the project in its own tag (`project`), the copyright holder in `<owner>`,
 * and the license in `<license>`.
 */
const CREDITS = [
  {
    i18nKey: 'featureUi.settings.about.matrixSdkCredit',
    tag: 'sdk',
    project: 'https://github.com/matrix-org/matrix-js-sdk',
    license: 'https://github.com/matrix-org/matrix-js-sdk/blob/develop/LICENSE',
  },
  {
    i18nKey: 'featureUi.settings.about.emojiArtCredit',
    tag: 'art',
    project: 'https://github.com/jdecked/twemoji',
    license: CC_BY_4,
  },
  {
    i18nKey: 'featureUi.settings.about.emojiFontCredit',
    tag: 'font',
    project: 'https://github.com/mozilla/twemoji-colr',
    license: 'https://www.apache.org/licenses/LICENSE-2.0',
  },
  {
    i18nKey: 'featureUi.settings.about.soundResourcesCredit',
    tag: 'resources',
    project: 'https://material.io/design/sound/sound-resources.html',
    license: CC_BY_4,
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
  return (
    <Box
      as="ul"
      direction="Column"
      gap="200"
      style={{ margin: 0, paddingInlineStart: config.space.S400 }}
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
    </Box>
  );
}

/** A titled group of setting tiles. */
function AboutSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{title}</Text>
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
  const { subtitle } = getMindroomWelcomePageContent(welcome as never, t);
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

/** App version, cache and diagnostics tools, and credits. */



  const nativeDiagnostics = isNativeIOS();

  const header = (
    <PageHeader outlined={false}>
      <Box grow="Yes" gap="200">
        <Box grow="Yes" alignItems="Center" gap="200">
          <Text size="H3" truncate>
            {t('settings.nav.about')}
          </Text>
        </Box>
        <Box shrink="No">
          <IconButton
            variant="Surface"
            aria-label={t('featureUi.settings.emojisStickers.globalPacks.close')}
            onClick={requestClose}
          >
            <Icon src={Icons.Cross} />
          </IconButton>
        </Box>
      </Box>
    </PageHeader>
  );

  const clearCacheButton = (
    <Button
      size="300"
      radii="300"
      variant="Secondary"
      fill="Soft"
      outlined
      onClick={() => clearAllCacheAndReload(mx)}
    >
      <Text size="B300">{t('featureUi.settings.about.clearCache')}</Text>
    </Button>
  );

  return (
    <Page>
      <PageScroll header={header}>
        <PageContent>
          <Box direction="Column" gap="700">
            <AppIdentity />
            <AboutSection title={t('featureUi.settings.about.options')}>
              <SettingTile
                title={t('featureUi.settings.about.clearCacheAndReload')}
                description={t('featureUi.settings.about.clearCacheDescription')}
                after={clearCacheButton}
              />
              {nativeDiagnostics ? (
                <>
                  <DiagnosticsExport />
                  <DeepTraceSetting />
                </>
              ) : null}
            </AboutSection>
            <AboutSection title={t('featureUi.settings.about.credits')}>
              <CreditsList />
            </AboutSection>
          </Box>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
