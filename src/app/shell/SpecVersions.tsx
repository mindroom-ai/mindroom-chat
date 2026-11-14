import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Spinner, Text, config } from 'folds';
import { Dialog } from '../ui/glass/GlassPrimitives';
import { useTranslation } from 'react-i18next';
import { SpecVersionsLoader } from '../matrix/SpecVersionsLoader';
import { SplashScreen } from '../ui/splash/SplashScreen';
import { MindRoomSplashScreen } from '../ui/splash/BrandedSplashScreen';
import { SpecVersionsProvider } from '../matrix/hooks/useSpecVersions';
import { useActiveSession } from '../matrix/session/useSessionStore';
import { specVersions, type SpecVersions as ServerSpecVersions } from '../matrix/cs-api';
import { readCachedSpecVersions, writeCachedSpecVersions } from '../matrix/cachedSpecVersions';
import {
  clearAllCacheAndReload,
  removeSessionAndReload,
} from '../account/lifecycle/sessionLifecycle';

const EMPTY_SPEC_VERSIONS: ServerSpecVersions = { versions: [] };

type SpecVersionsProps = {
  baseUrl: string;
  /**
   * Whether the client may show cached rooms before the server answered. On a
   * cache miss the children then render without capabilities until it does.
   */
  allowCachedContent?: boolean;
  children?: ReactNode;
};

/** Fetches with the active session's access token, so servers that require auth for /versions answer. */
const useSessionRequest = (accessToken: string | undefined): typeof fetch =>
  useCallback<typeof fetch>(
    (input, init) =>
      fetch(input, {
        ...init,
        headers: accessToken
          ? {
              ...(init?.headers as Record<string, string> | undefined),
              Authorization: `Bearer ${accessToken}`,
            }
          : init?.headers,
      }),
    [accessToken]
  );

/** The branded splash says what it waits for; its column already holds the one spinner. */
function ConnectingSplash({ onCancel }: { onCancel?: () => void }) {
  const { t } = useTranslation();
  return (
    <MindRoomSplashScreen message={t('sharedUi.specVersions.connectingToServer')}>
      {onCancel && (
        <Button variant="Secondary" fill="Soft" size="300" radii="300" onClick={onCancel}>
          <Text size="B300">{t('sharedUi.specVersions.cancelAndReturnToSignIn')}</Text>
        </Button>
      )}
    </MindRoomSplashScreen>
  );
}

/** The label inside a recovery button. */
const RecoveryLabel = ({ children }: { children: string }) => (
  <Text as="span" size="B400">
    {children}
  </Text>
);

type ConnectionErrorProps = {
  baseUrl: string;
  onRetry: () => void;
  onContinue: () => void;
};

/** The homeserver did not answer `/versions`: retry, go on without it, or start from scratch. */
function ConnectionError({ baseUrl, onRetry, onContinue }: ConnectionErrorProps) {
  const { t } = useTranslation();
  const [clearing, setClearing] = useState(false);

  const clearCacheOnce = () => {
    if (clearing) return;
    setClearing(true);
    clearAllCacheAndReload().catch(() => setClearing(false));
  };
  const clearLabel = clearing
    ? t('sharedUi.specVersions.clearing')
    : t('sharedUi.specVersions.clearCacheAndReload');
  const problem = t(
    'sharedUi.specVersions.unableToConnectToTheHomeserverTheHomeserverOrYourInternetConnection',
    { server: baseUrl }
  );

  return (
    <SplashScreen>
      <Box direction="Column" justifyContent="Center" alignItems="Center" gap="400" grow="Yes">
        <Dialog>
          <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
            <Text>{problem}</Text>
            <Button variant="Critical" onClick={onRetry}>
              <RecoveryLabel>{t('sharedUi.specVersions.retry')}</RecoveryLabel>
            </Button>
            <Button variant="Secondary" fill="Soft" onClick={onContinue}>
              <RecoveryLabel>{t('sharedUi.specVersions.continue')}</RecoveryLabel>
            </Button>
            <Button
              variant="Secondary"
              fill="Soft"
              disabled={clearing}
              before={clearing ? <Spinner size="100" variant="Secondary" /> : undefined}
              onClick={clearCacheOnce}
            >
              <RecoveryLabel>{clearLabel}</RecoveryLabel>
            </Button>
          </Box>
        </Dialog>
      </Box>
    </SplashScreen>
  );
}

/** Records versions the loader fetched, so a cold start skips the wait next time. */
function LoadedVersions({
  versions,
  onLoaded,
  children,
}: {
  versions: ServerSpecVersions;
  onLoaded: (versions: ServerSpecVersions) => void;
  children: ReactNode;
}) {
  useEffect(() => {
    onLoaded(versions);
  }, [versions, onLoaded]);
  return <SpecVersionsProvider value={versions}>{children}</SpecVersionsProvider>;
}

/**
 * Provides the homeserver's `/_matrix/client/versions` to the client. With a
 * cached answer for this account the client renders at once and the cache
 * refreshes in the background; otherwise it waits for the server, unless
 * cached rooms may already show.
 */
export function SpecVersions({ baseUrl, allowCachedContent = false, children }: SpecVersionsProps) {
  const session = useActiveSession();
  const userId = session?.userId;
  const request = useSessionRequest(session?.accessToken);

  const cachedVersions = useMemo(
    () => (userId ? readCachedSpecVersions(baseUrl, userId) : undefined),
    [baseUrl, userId]
  );
  const [refreshedVersions, setRefreshedVersions] = useState<ServerSpecVersions>();
  const loadedVersionsRef = useRef<ServerSpecVersions>();
  const refreshedKeyRef = useRef<string>();

  const showWithoutLoader = cachedVersions !== undefined || allowCachedContent;

  useEffect(() => {
    if (!showWithoutLoader || !userId) return undefined;
    const key = `${baseUrl}::${userId}`;
    if (refreshedKeyRef.current === key) return undefined;
    refreshedKeyRef.current = key;
    let cancelled = false;
    specVersions(request, baseUrl)
      .then((versions) => {
        if (cancelled || versions.versions.length === 0) return;
        writeCachedSpecVersions(baseUrl, userId, versions);
        // Cached capabilities stay as they are until the next start; empty ones update now.
        if (!cachedVersions && !loadedVersionsRef.current) setRefreshedVersions(versions);
      })
      .catch(() => {
        // Keep showing what the client has; the next start tries again.
      });
    return () => {
      cancelled = true;
    };
  }, [showWithoutLoader, baseUrl, userId, request, cachedVersions]);

  const handleLoaded = useCallback(
    (versions: ServerSpecVersions) => {
      loadedVersionsRef.current = versions;
      if (userId && versions.versions.length > 0) {
        writeCachedSpecVersions(baseUrl, userId, versions);
      }
    },
    [baseUrl, userId]
  );

  const handleCancel = session ? () => void removeSessionAndReload(session) : undefined;

  if (showWithoutLoader) {
    const versions =
      cachedVersions ?? refreshedVersions ?? loadedVersionsRef.current ?? EMPTY_SPEC_VERSIONS;
    return <SpecVersionsProvider value={versions}>{children}</SpecVersionsProvider>;
  }

  return (
    <SpecVersionsLoader
      baseUrl={baseUrl}
      fetchFn={request}
      fallback={() => <ConnectingSplash onCancel={handleCancel} />}
      error={(_error: unknown, retry: () => void, ignore: () => void) => (
        <ConnectionError baseUrl={baseUrl} onRetry={retry} onContinue={ignore} />
      )}
    >
      {(versions: ServerSpecVersions) => (
        <LoadedVersions versions={versions} onLoaded={handleLoaded}>
          {children}
        </LoadedVersions>
      )}
    </SpecVersionsLoader>
  );
}
