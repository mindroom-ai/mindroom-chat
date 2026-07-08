import React from 'react';
import { Box, Button, Icon, Icons, Text, config, toRem } from 'folds';
import { useSetAtom } from 'jotai';
import { Page, PageHero, PageHeroSection } from '../../components/page';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  getMindroomWelcomePageContent,
  MINDROOM_CLIENT_BRANDING,
} from '../../mindroom/branding/clientBranding';
import { getLocalMindroomConnections } from '../../mindroom/local-mindroom/api';
import {
  getWelcomeSetupFirstSeenStorageKey,
  isConnectionRevoked,
  resolveMindroomProvisioningRequest,
  shouldShowWelcomeSetupPrompt,
} from '../../mindroom/local-mindroom/mindroom';
import { LOCAL_MINDROOM_SETTINGS_PAGE } from '../../mindroom/local-mindroom/settingsPage';
import { KeyBackupNudge } from '../../mindroom/onboarding/KeyBackupNudge';
import { settingsModalAtom } from '../../state/settingsModal';

const safeIcon = (icon?: (filled?: boolean) => JSX.Element) => icon ?? Icons.Info;

const WELCOME_SETUP_INITIAL_STEPS = [
  '1. Run uvx mindroom config init --provider <anthropic|codex|llama.cpp|ollama|openai|openrouter|vertexai_claude>',
  '2. Add model credentials in ~/.mindroom/.env, or run codex login',
];

const WELCOME_SETUP_FINAL_STEPS = [
  '4. Run uvx mindroom connect --pair-code ABCD-EFGH',
  '5. Start it with uvx mindroom run',
];

const getWelcomeSetupStorage = (): Storage | undefined => {
  try {
    if (typeof globalThis.localStorage === 'undefined') return undefined;
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

const readFirstSeenAtMs = (storageKey: string): number | undefined => {
  const storage = getWelcomeSetupStorage();
  if (typeof storage?.getItem !== 'function') return undefined;

  let stored: string | null;
  try {
    stored = storage.getItem(storageKey);
  } catch {
    return undefined;
  }
  if (!stored) return undefined;

  const firstSeenAtMs = Number(stored);
  return Number.isFinite(firstSeenAtMs) ? firstSeenAtMs : undefined;
};

const getOrCreateFirstSeenAtMs = (storageKey: string, nowMs: number): number | undefined => {
  const firstSeenAtMs = readFirstSeenAtMs(storageKey);
  if (firstSeenAtMs !== undefined) return firstSeenAtMs;
  const storage = getWelcomeSetupStorage();
  if (typeof storage?.setItem !== 'function') return undefined;

  try {
    storage.setItem(storageKey, nowMs.toString());
  } catch {
    return undefined;
  }
  return nowMs;
};

const clearFirstSeenAtMs = (storageKey: string) => {
  const storage = getWelcomeSetupStorage();
  if (typeof storage?.removeItem !== 'function') return;

  try {
    storage.removeItem(storageKey);
  } catch {
    // Fail closed if localStorage is unavailable or blocked.
  }
};

type WelcomeSetupInstructionsProps = {
  onOpenLocalMindroomSettings: () => void;
};

function WelcomeSetupInstructions({ onOpenLocalMindroomSettings }: WelcomeSetupInstructionsProps) {
  return (
    <Box
      direction="Column"
      gap="200"
      style={{
        border: '1px solid rgba(125, 125, 125, 0.28)',
        borderRadius: '8px',
        padding: '12px',
        textAlign: 'left',
      }}
    >
      <Text as="span" size="L400">
        Set up Local MindRoom
      </Text>
      {WELCOME_SETUP_INITIAL_STEPS.map((step) => (
        <Text key={step} as="span" size="T200" priority="300" style={{ overflowWrap: 'anywhere' }}>
          {step}
        </Text>
      ))}
      <Button
        aria-label="Open Local MindRoom settings"
        fill="Soft"
        onClick={onOpenLocalMindroomSettings}
        before={<Icon size="200" src={safeIcon(Icons.Link)} />}
        style={{ justifyContent: 'flex-start' }}
      >
        <Text as="span" size="B300" style={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
          3. Click here to open Local MindRoom and generate a pair code
        </Text>
      </Button>
      {WELCOME_SETUP_FINAL_STEPS.map((step) => (
        <Text key={step} as="span" size="T200" priority="300" style={{ overflowWrap: 'anywhere' }}>
          {step}
        </Text>
      ))}
    </Box>
  );
}

export function WelcomePage() {
  const mx = useMatrixClient();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const { sidebar, welcome } = useClientConfig();
  const userId = mx.getSafeUserId();
  const sessionHomeserverUrl = mx.getHomeserverUrl();
  const sessionAccessToken = mx.getAccessToken() ?? undefined;
  const provisioningRequest = React.useMemo(
    () =>
      resolveMindroomProvisioningRequest({
        sessionHomeserverUrl,
        provisioningOverrideUrl: sidebar?.mindRoomProvisioningUrl,
        accessToken: sessionAccessToken,
      }),
    [sessionAccessToken, sessionHomeserverUrl, sidebar?.mindRoomProvisioningUrl]
  );
  const [showSetupInstructions, setShowSetupInstructions] = React.useState(false);
  const { docsLabel, docsUrl, poweredBy, sourceLabel, sourceUrl, subtitle, title } =
    getMindroomWelcomePageContent(welcome);
  const openLocalMindroomSettings = React.useCallback(() => {
    setSettingsModal({ initialPage: LOCAL_MINDROOM_SETTINGS_PAGE });
  }, [setSettingsModal]);

  React.useEffect(() => {
    let cancelled = false;
    const nowMs = Date.now();
    const storageKey = getWelcomeSetupFirstSeenStorageKey(userId);

    getLocalMindroomConnections(
      provisioningRequest.accessToken,
      provisioningRequest.provisioningBaseUrl
    )
      .then((result) => {
        if (cancelled) return;
        const activeConnectionCount = result.connections.filter(
          (connection) => !isConnectionRevoked(connection)
        ).length;
        if (activeConnectionCount > 0) {
          clearFirstSeenAtMs(storageKey);
          setShowSetupInstructions(false);
          return;
        }

        const firstSeenAtMs = getOrCreateFirstSeenAtMs(storageKey, nowMs);
        setShowSetupInstructions(
          shouldShowWelcomeSetupPrompt({
            activeConnectionCount,
            firstSeenAtMs,
            nowMs,
          })
        );
      })
      .catch(() => {
        if (!cancelled) setShowSetupInstructions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [provisioningRequest.accessToken, provisioningRequest.provisioningBaseUrl, userId]);

  return (
    <Page>
      <Box
        grow="Yes"
        style={{ padding: config.space.S400, paddingBottom: config.space.S700 }}
        alignItems="Center"
        justifyContent="Center"
      >
        <PageHeroSection>
          <PageHero
            icon={
              <img
                width="70"
                height="70"
                src={MINDROOM_CLIENT_BRANDING.logoSrc}
                alt={MINDROOM_CLIENT_BRANDING.logoAlt}
              />
            }
            title={title}
            subTitle={<span>{subtitle}</span>}
          >
            <Box justifyContent="Center">
              <Box grow="Yes" style={{ maxWidth: toRem(360) }} direction="Column" gap="300">
                {sourceUrl && (
                  <Button
                    as="a"
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    before={<Icon size="200" src={safeIcon(Icons.Code)} />}
                  >
                    <Text as="span" size="B400" truncate>
                      {sourceLabel}
                    </Text>
                  </Button>
                )}
                {docsUrl && (
                  <Button
                    as="a"
                    href={docsUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    fill="Soft"
                    before={<Icon size="200" src={safeIcon(Icons.Info)} />}
                  >
                    <Text as="span" size="B400" truncate>
                      {docsLabel}
                    </Text>
                  </Button>
                )}
                {showSetupInstructions && (
                  <WelcomeSetupInstructions
                    onOpenLocalMindroomSettings={openLocalMindroomSettings}
                  />
                )}
                <KeyBackupNudge />
                {poweredBy.length > 0 && (
                  <Text size="T300" align="Center">
                    Powered by{' '}
                    {poweredBy.map((item, index) => (
                      <React.Fragment key={item.url}>
                        <a href={item.url} target="_blank" rel="noreferrer noopener">
                          {item.label}
                        </a>
                        {index < poweredBy.length - 1 && ' \u2022 '}
                      </React.Fragment>
                    ))}
                  </Text>
                )}
              </Box>
            </Box>
          </PageHero>
        </PageHeroSection>
      </Box>
    </Page>
  );
}
