import React from 'react';
import {
  Box,
  Text,
  IconButton,
  Icon,
  Icons,
  Scroll,
  Button,
  Spinner,
  Switch,
  config,
  toRem,
} from 'folds';
import { Page, PageContent, PageHeader } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { clearAllCacheAndReload } from '../../../../client/initMatrix';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useClientConfig } from '../../../hooks/useClientConfig';
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
  type DeepTraceRuntimeStatus,
} from '../../../mindroom/diagnostics/deepTrace';
import { buildDiagnosticsExport } from '../../../mindroom/diagnostics/diagnosticsExport';

type AboutProps = {
  requestClose: () => void;
};

type DeepTraceError = 'storage' | 'preference' | undefined;

const getDeepTraceDescription = ({
  runtimeStatus,
  enabled,
  error,
}: {
  runtimeStatus: DeepTraceRuntimeStatus;
  enabled: boolean;
  error: DeepTraceError;
}): string => {
  let description: string;

  if (runtimeStatus === 'unavailable') {
    description = enabled
      ? 'Enabled, but trace storage is currently unavailable.'
      : 'Trace storage unavailable.';
  } else if (error === 'storage') {
    description = 'Trace storage unavailable.';
  } else if (runtimeStatus === 'recording') {
    description =
      'Recording a bounded, privacy-safe performance and interaction trace on this device.';
  } else if (runtimeStatus === 'starting') {
    description =
      'Starting a bounded, privacy-safe performance and interaction trace on this device.';
  } else {
    description =
      'Off. Enable before reproducing a freeze to record performance, Matrix, network, lifecycle, and interaction timing.';
  }

  if (error === 'preference') {
    description +=
      ' Off for this session, but the preference could not be saved and may re-enable after restart.';
  }

  return description;
};

export function About({ requestClose }: AboutProps) {
  const mx = useMatrixClient();
  const clientConfig = useClientConfig();
  const { subtitle } = getMindroomWelcomePageContent(clientConfig.welcome);
  const [clearing, setClearing] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState(false);
  const [deepTracing, setDeepTracing] = React.useState(getDeepTraceEnabled);
  const [deepTraceRuntimeStatus, setDeepTraceRuntimeStatus] =
    React.useState(getDeepTraceRuntimeStatus);
  const [deepTraceError, setDeepTraceError] = React.useState<DeepTraceError>();
  const [deepTraceChanging, setDeepTraceChanging] = React.useState(false);
  const [clearingDeepTrace, setClearingDeepTrace] = React.useState(false);
  const deepTraceChangePending = React.useRef(false);
  const nativeIOS = isNativeIOS();
  const diagnosticsStatus = getFlightRecorderStatus();
  const diagnosticsDescription = {
    unexpected: 'Previous session ended unexpectedly; the cause is unknown.',
    none: 'No unexpected session retained.',
    unavailable: 'Diagnostics storage unavailable.',
  }[diagnosticsStatus];

  React.useEffect(
    () =>
      subscribeDeepTraceStatus((status) => {
        setDeepTraceRuntimeStatus(status);
        if (!deepTraceChangePending.current) {
          setDeepTraceChanging(status === 'starting');
        }
        if (status === 'unavailable') {
          setDeepTracing(getDeepTraceEnabled());
          setDeepTraceError('storage');
        } else if (status === 'starting') {
          setDeepTracing(true);
          setDeepTraceError(undefined);
        } else if (status === 'recording') {
          setDeepTracing(true);
          setDeepTraceError(undefined);
        } else {
          setDeepTracing(false);
        }
      }),
    []
  );

  const handleClearCache = async () => {
    if (clearing) return;

    setClearing(true);

    try {
      await clearAllCacheAndReload(mx);
    } catch {
      setClearing(false);
    }
  };

  const handleExportDiagnostics = async () => {
    if (exporting) return;

    setExporting(true);
    setExportError(false);

    try {
      const { blob, fileName } = await buildDiagnosticsExport();
      await saveFile(blob, fileName);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };

  const handleDeepTraceChange = async (enabled: boolean) => {
    if (deepTraceChangePending.current) return;
    deepTraceChangePending.current = true;
    setDeepTraceChanging(true);
    setDeepTracing(enabled);
    setDeepTraceError(undefined);
    let saved = false;
    try {
      saved = await setDeepTraceEnabled(enabled);
    } catch {
      saved = false;
    }
    if (!saved) {
      setDeepTraceError(enabled ? 'storage' : 'preference');
    }
    setDeepTracing(enabled ? getDeepTraceEnabled() : false);
    deepTraceChangePending.current = false;
    setDeepTraceChanging(false);
  };

  const handleClearDeepTrace = async () => {
    if (clearingDeepTrace) return;
    setClearingDeepTrace(true);
    setDeepTraceError(undefined);
    try {
      await clearDeepTrace();
    } catch {
      setDeepTraceError('storage');
    } finally {
      setClearingDeepTrace(false);
    }
  };

  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              About
            </Text>
          </Box>
          <Box shrink="No">
            <IconButton onClick={requestClose} variant="Surface">
              <Icon src={Icons.Cross} />
            </IconButton>
          </Box>
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <Box direction="Column" gap="700">
              <Box gap="400">
                <Box shrink="No">
                  <img
                    style={{ width: toRem(60), height: toRem(60) }}
                    src={MINDROOM_CLIENT_BRANDING.logoSrc}
                    alt={MINDROOM_CLIENT_BRANDING.logoAlt}
                  />
                </Box>
                <Box direction="Column" gap="300">
                  <Box direction="Column" gap="100">
                    <Box gap="100" alignItems="End">
                      <Text size="H3">{MINDROOM_CLIENT_BRANDING.appName}</Text>
                      <Text size="T200">v4.12.3</Text>
                    </Box>
                    <Text>{subtitle}</Text>
                  </Box>

                  <Box gap="200" wrap="Wrap">
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
                      <Text size="B300">Source Code</Text>
                    </Button>
                    <Button
                      as="a"
                      href="https://cinny.in/#sponsor"
                      rel="noreferrer noopener"
                      target="_blank"
                      variant="Critical"
                      fill="Soft"
                      size="300"
                      radii="300"
                      before={<Icon src={Icons.Heart} size="100" filled />}
                    >
                      <Text size="B300">Support</Text>
                    </Button>
                  </Box>
                </Box>
              </Box>
              <Box direction="Column" gap="100">
                <Text size="L400">Options</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                  gap="400"
                >
                  <SettingTile
                    title="Clear Cache & Reload"
                    description="Clears cached data and reloads. You will stay signed in."
                    after={
                      <Button
                        onClick={handleClearCache}
                        variant="Secondary"
                        fill="Soft"
                        size="300"
                        radii="300"
                        outlined
                        disabled={clearing}
                        before={clearing && <Spinner size="200" variant="Secondary" fill="Soft" />}
                      >
                        <Text size="B300">{clearing ? 'Clearing...' : 'Clear Cache'}</Text>
                      </Button>
                    }
                  />
                  {nativeIOS && (
                    <SettingTile
                      title="Deep diagnostic tracing"
                      description={getDeepTraceDescription({
                        runtimeStatus: deepTraceRuntimeStatus,
                        enabled: deepTracing,
                        error: deepTraceError,
                      })}
                      after={
                        <Box alignItems="Center" gap="200">
                          <Button
                            onClick={handleClearDeepTrace}
                            variant="Secondary"
                            fill="Soft"
                            size="300"
                            radii="300"
                            outlined
                            disabled={clearingDeepTrace || deepTraceChanging}
                            before={
                              clearingDeepTrace && (
                                <Spinner size="200" variant="Secondary" fill="Soft" />
                              )
                            }
                          >
                            <Text size="B300">
                              {clearingDeepTrace ? 'Clearing...' : 'Clear trace'}
                            </Text>
                          </Button>
                          <Switch
                            variant="Primary"
                            value={deepTracing}
                            onChange={handleDeepTraceChange}
                            disabled={deepTraceChanging}
                          />
                        </Box>
                      }
                    />
                  )}
                  {nativeIOS && (
                    <SettingTile
                      title="On-device diagnostics"
                      description={`${diagnosticsDescription}${
                        exportError && diagnosticsStatus !== 'unavailable'
                          ? ' Export failed. Try again.'
                          : ''
                      }`}
                      after={
                        <Button
                          onClick={handleExportDiagnostics}
                          variant="Secondary"
                          fill="Soft"
                          size="300"
                          radii="300"
                          outlined
                          disabled={exporting}
                          before={
                            exporting && <Spinner size="200" variant="Secondary" fill="Soft" />
                          }
                        >
                          <Text size="B300">
                            {exporting ? 'Exporting...' : 'Export diagnostics'}
                          </Text>
                        </Button>
                      }
                    />
                  )}
                </SequenceCard>
              </Box>
              <Box direction="Column" gap="100">
                <Text size="L400">Credits</Text>
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
                    style={{
                      margin: 0,
                      paddingLeft: config.space.S400,
                    }}
                  >
                    <li>
                      <Text size="T300">
                        The{' '}
                        <a
                          href="https://github.com/matrix-org/matrix-js-sdk"
                          rel="noreferrer noopener"
                          target="_blank"
                        >
                          matrix-js-sdk
                        </a>{' '}
                        is ©{' '}
                        <a
                          href="https://matrix.org/foundation"
                          rel="noreferrer noopener"
                          target="_blank"
                        >
                          The Matrix.org Foundation C.I.C
                        </a>{' '}
                        used under the terms of{' '}
                        <a
                          href="http://www.apache.org/licenses/LICENSE-2.0"
                          rel="noreferrer noopener"
                          target="_blank"
                        >
                          Apache 2.0
                        </a>
                        .
                      </Text>
                    </li>
                    <li>
                      <Text size="T300">
                        The{' '}
                        <a
                          href="https://github.com/mozilla/twemoji-colr"
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          twemoji-colr
                        </a>{' '}
                        font is ©{' '}
                        <a href="https://mozilla.org/" target="_blank" rel="noreferrer noopener">
                          Mozilla Foundation
                        </a>{' '}
                        used under the terms of{' '}
                        <a
                          href="http://www.apache.org/licenses/LICENSE-2.0"
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          Apache 2.0
                        </a>
                        .
                      </Text>
                    </li>
                    <li>
                      <Text size="T300">
                        The{' '}
                        <a
                          href="https://twemoji.twitter.com"
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          Twemoji
                        </a>{' '}
                        emoji art is ©{' '}
                        <a
                          href="https://twemoji.twitter.com"
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          Twitter, Inc and other contributors
                        </a>{' '}
                        used under the terms of{' '}
                        <a
                          href="https://creativecommons.org/licenses/by/4.0/"
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          CC-BY 4.0
                        </a>
                        .
                      </Text>
                    </li>
                    <li>
                      <Text size="T300">
                        The{' '}
                        <a
                          href="https://material.io/design/sound/sound-resources.html"
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          Material sound resources
                        </a>{' '}
                        are ©{' '}
                        <a href="https://google.com" target="_blank" rel="noreferrer noopener">
                          Google
                        </a>{' '}
                        used under the terms of{' '}
                        <a
                          href="https://creativecommons.org/licenses/by/4.0/"
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          CC-BY 4.0
                        </a>
                        .
                      </Text>
                    </li>
                  </Box>
                </SequenceCard>
              </Box>
            </Box>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
