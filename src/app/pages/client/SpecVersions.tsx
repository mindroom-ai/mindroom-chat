import React, { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Spinner, Text, config } from 'folds';
import { Dialog } from '../../components/glass/GlassPrimitives';
import { useTranslation } from 'react-i18next';
import { SpecVersionsLoader } from '../../components/SpecVersionsLoader';
import { MindRoomSplashScreen, SplashScreen } from '../../components/splash-screen';
import { SpecVersionsProvider } from '../../hooks/useSpecVersions';
import { useActiveSession } from '../../hooks/useSessionStore';
import { specVersions, type SpecVersions as ServerSpecVersions } from '../../cs-api';
import { readCachedSpecVersions, writeCachedSpecVersions } from '../../state/cachedSpecVersions';
import { clearAllCacheAndReload, removeSessionAndReload } from '../../../client/initMatrix';

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

function ConnectingSplash({ onCancel }: { onCancel?: () => void }) {
  const { t } = useTranslation();
  return (
    <MindRoomSplashScreen>
      <Box direction="Column" grow="Yes" alignItems="Center" justifyContent="Center" gap="400">
        <Spinner variant="Secondary" size="600" />
        <Text>{t('featureUi.client.specVersions.connecting')}</Text>
        {onCancel && (
          <Button variant="Secondary" fill="Soft" size="300" radii="300" onClick={onCancel}>
            <Text size="B300">{t('featureUi.client.specVersions.cancel')}</Text>
          </Button>
        )}
      </Box>
    </MindRoomSplashScreen>
  );
}

function ConnectionError({
  baseUrl,
  retry,
  ignore,
}: {
  baseUrl: string;




  const [clearing, setClearing] = useState(false);

  const handleClearCache = () => {
    if (clearing) return;
    setClearing(true);
    clearAllCacheAndReload().catch(() => setClearing(false));
  };







            <Button variant="Critical" onClick={retry}>
              <Text as="span" size="B400">
                {t('featureUi.client.specVersions.retry')}
              </Text>
            </Button>
            <Button variant="Secondary" fill="Soft" onClick={ignore}>
              <Text as="span" size="B400">
                {t('featureUi.client.specVersions.continue')}
              </Text>
            </Button>
            <Button
              variant="Secondary"
              fill="Soft"
              onClick={handleClearCache}
              disabled={clearing}
              before={clearing ? <Spinner size="100" variant="Secondary" /> : undefined}
            >
              <Text as="span" size="B400">
                {clearing
                  ? t('featureUi.client.specVersions.clearing')
                  : t('featureUi.client.specVersions.clearCache')}
              </Text>
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
        <ConnectionError baseUrl={baseUrl} retry={retry} ignore={ignore} />
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
