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

/** A credit's link; `Trans` fills in the linked text. */
function CreditLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}




  const { welcome } = useClientConfig();
  const { subtitle } = getMindroomWelcomePageContent(welcome as never, t);
  const showDiagnostics = isNativeIOS();

  return (
    <Page>
      <PageScroll
        header={
          <PageHeader outlined={false}>
            <Box grow="Yes" gap="200">
              <Box grow="Yes" alignItems="Center" gap="200">
                <Text size="H3" truncate>
                  {t('settings.nav.about')}
                </Text>
              </Box>
              <Box shrink="No">
                <IconButton
                  onClick={requestClose}
                  variant="Surface"
                  aria-label={t('featureUi.settings.emojisStickers.globalPacks.close')}
                >
                  <Icon src={Icons.Cross} />
                </IconButton>
              </Box>
            </Box>
          </PageHeader>
        }
      >
        <PageContent>
          <Box direction="Column" gap="700">
            <Box gap="400" alignItems="Center">
              <img
                style={{ width: toRem(60), height: toRem(60) }}
                src={MINDROOM_CLIENT_BRANDING.logoSrc}
                alt={MINDROOM_CLIENT_BRANDING.logoAlt}
              />
              <Box direction="Column" gap="100">
                <Box gap="100" alignItems="End">
                  <Text size="H3">{MINDROOM_CLIENT_BRANDING.appName}</Text>
                  <Text size="T200">{APP_RELEASE_VERSION}</Text>
                </Box>
                <Text size="T300">{subtitle}</Text>
                <Box gap="200" wrap="Wrap" style={{ paddingTop: config.space.S400 }}>
                  <Button
                    as="a"
                    href={MINDROOM_CLIENT_BRANDING.sourceUrl}
                    rel="noreferrer noopener"
                    target="_blank"
                    variant="Secondary"
                    fill="Soft"
                    size="300"
                    radii="300"
                    before={<Icon src={Icons.Code} size="100" filled />}
                  >
                    <Text size="B300">{t('featureUi.settings.about.sourceCode')}</Text>
                  </Button>
                </Box>
              </Box>
            </Box>

            <Box direction="Column" gap="100">
              <Text size="L400">{t('featureUi.settings.about.options')}</Text>
              <SequenceCard
                className={SequenceCardStyle}
                variant="SurfaceVariant"
                direction="Column"
                gap="400"
              >
                <SettingTile
                  title={t('featureUi.settings.about.clearCacheAndReload')}
                  description={t('featureUi.settings.about.clearCacheDescription')}
                  after={
                    <Button
                      onClick={() => clearAllCacheAndReload(mx)}
                      variant="Secondary"
                      fill="Soft"
                      size="300"
                      radii="300"
                      outlined
                    >
                      <Text size="B300">{t('featureUi.settings.about.clearCache')}</Text>
                    </Button>
                  }
                />
                {showDiagnostics && <DiagnosticsExport />}
                {showDiagnostics && <DeepTraceSetting />}
              </SequenceCard>
            </Box>

            <Box direction="Column" gap="100">
              <Text size="L400">{t('featureUi.settings.about.credits')}</Text>
              <SequenceCard
                className={SequenceCardStyle}
                variant="SurfaceVariant"
                direction="Column"
                gap="400"
              >
                <Box
                  as="ul"
                  direction="Column"
                  gap="200"
                  style={{ margin: 0, paddingInlineStart: config.space.S400 }}
                >
                  <li>
                    <Text size="T300">
                      <Trans
                        i18nKey="featureUi.settings.about.matrixSdkCredit"
                        components={{
                          sdk: <CreditLink href="https://github.com/matrix-org/matrix-js-sdk" />,
                          owner: <span />,
                          license: (
                            <CreditLink href="https://github.com/matrix-org/matrix-js-sdk/blob/develop/LICENSE" />
                          ),
                        }}
                      />
                    </Text>
                  </li>
                  <li>
                    <Text size="T300">
                      <Trans
                        i18nKey="featureUi.settings.about.emojiArtCredit"
                        components={{
                          art: <CreditLink href="https://github.com/jdecked/twemoji" />,
                          owner: <span />,
                          license: (
                            <CreditLink href="https://creativecommons.org/licenses/by/4.0/" />
                          ),
                        }}
                      />
                    </Text>
                  </li>
                  <li>
                    <Text size="T300">
                      <Trans
                        i18nKey="featureUi.settings.about.emojiFontCredit"
                        components={{
                          font: <CreditLink href="https://github.com/mozilla/twemoji-colr" />,
                          owner: <span />,
                          license: (
                            <CreditLink href="https://www.apache.org/licenses/LICENSE-2.0" />
                          ),
                        }}
                      />
                    </Text>
                  </li>
                  <li>
                    <Text size="T300">
                      <Trans
                        i18nKey="featureUi.settings.about.soundResourcesCredit"
                        components={{
                          resources: (
                            <CreditLink href="https://material.io/design/sound/sound-resources.html" />
                          ),
                          owner: <span />,
                          license: (
                            <CreditLink href="https://creativecommons.org/licenses/by/4.0/" />
                          ),
                        }}
                      />
                    </Text>
                  </li>
                </Box>
              </SequenceCard>
            </Box>
          </Box>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
