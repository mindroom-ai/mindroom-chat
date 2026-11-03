import React, { useEffect, useState } from 'react';
import { Box, Button, Icon, Icons, Text, config, toRem } from 'folds';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Page, PageHero, PageHeroSection } from '../../components/page';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  MINDROOM_CLIENT_BRANDING,
  getMindroomWelcomePageContent,
} from '../../mindroom/branding/clientBranding';
import { getLocalMindroomConnections } from '../../mindroom/local-mindroom/api';
import {
  getWelcomeSetupFirstSeenStorageKey,
  isConnectionRevoked,
  resolveMindroomProvisioningRequest,
  shouldShowWelcomeSetupPrompt,
} from '../../mindroom/local-mindroom/mindroom';
import { LOCAL_MINDROOM_SETTINGS_PAGE } from '../../mindroom/local-mindroom/settingsPage';
import { settingsModalAtom } from '../../state/settingsModal';

const SETUP_COMMAND =
  'uvx mindroom config init --provider <anthropic|codex|llama.cpp|ollama|openai|openrouter|vertexai_claude>';
const ENV_FILE = '~/.mindroom/.env';
const CREDENTIALS_COMMAND = 'codex login';
const RUN_COMMAND = 'uvx mindroom run';

const readFirstSeen = (key: string): number | undefined => {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
};

const writeFirstSeen = (key: string, value: number | undefined): void => {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {
    // Without storage the prompt simply waits for the next start.
  }
};

/**
 * Whether to show the Local MindRoom setup steps: an account on a homeserver
 * with provisioning, a day after the welcome page was first seen, while no
 * Local MindRoom device is connected.
 */
const useWelcomeSetupPrompt = (): boolean => {
  const mx = useMatrixClient();
  const { sidebar } = useClientConfig();
  const [show, setShow] = useState(false);
  const userId = mx.getSafeUserId();
  const { provisioningBaseUrl, canAuthenticate } = resolveMindroomProvisioningRequest({
    sessionHomeserverUrl: mx.getHomeserverUrl(),
    provisioningOverrideUrl: sidebar?.mindRoomProvisioningUrl,
    accessToken: mx.getAccessToken() ?? undefined,
  });

  useEffect(() => {
    if (!canAuthenticate) return undefined;
    const storageKey = getWelcomeSetupFirstSeenStorageKey(userId);
    let firstSeen = readFirstSeen(storageKey);
    if (firstSeen === undefined) {
      firstSeen = Date.now();
      writeFirstSeen(storageKey, firstSeen);
    }
    let cancelled = false;
    (async () => {
      try {
        const { access_token: openIdToken } = await mx.getOpenIdToken();
        const { connections } = await getLocalMindroomConnections(openIdToken, provisioningBaseUrl);
        if (cancelled) return;
        const active = (connections ?? []).filter((connection) => !isConnectionRevoked(connection));
        if (active.length > 0) {
          writeFirstSeen(storageKey, undefined);
          setShow(false);
          return;
        }
        setShow(
          shouldShowWelcomeSetupPrompt({ activeConnectionCount: 0, firstSeenAtMs: firstSeen })
        );
      } catch {
        if (!cancelled) setShow(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mx, userId, canAuthenticate, provisioningBaseUrl]);

  return show;
};

function LocalMindroomSetup() {
  const { t } = useTranslation();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  return (
    <Box direction="Column" gap="200" style={{ maxWidth: toRem(560), margin: '0 auto' }}>
      <Text size="H4">{t('sharedUi.welcomePage.setupTitle')}</Text>
      <Text size="T300">{t('sharedUi.welcomePage.setupStep1', { command: SETUP_COMMAND })}</Text>
      <Text size="T300">
        {t('sharedUi.welcomePage.setupStep2', { envFile: ENV_FILE, command: CREDENTIALS_COMMAND })}
      </Text>
      <Text size="T300">{t('sharedUi.welcomePage.setupStep3', { command: RUN_COMMAND })}</Text>
      <Box>
        <Button
          variant="Secondary"
          fill="Soft"
          size="300"
          radii="300"
          aria-label={t('sharedUi.welcomePage.openLocalMindroomSettings')}
          onClick={() => setSettingsModal({ initialPage: LOCAL_MINDROOM_SETTINGS_PAGE })}
        >
          <Text size="B300">{t('sharedUi.welcomePage.haveCode')}</Text>
        </Button>
      </Box>
    </Box>
  );
}

/** Shown when no room is open: the app's name, links to docs and source, and setup help. */
export function WelcomePage() {
  const { t } = useTranslation();
  const { welcome } = useClientConfig();
  const content = getMindroomWelcomePageContent(welcome as never, t);
  const showSetup = useWelcomeSetupPrompt();

  return (
    <Page>
      <Box
        grow="Yes"
        direction="Column"
        justifyContent="Center"
        style={{ padding: config.space.S700 }}
      >
        <PageHeroSection>
          <PageHero
            icon={
              <img
                width={70}
                height={70}
                src={MINDROOM_CLIENT_BRANDING.logoSrc}
                alt={MINDROOM_CLIENT_BRANDING.logoAlt}
              />
            }
            title={content.title}
            subTitle={content.subtitle}
          >
            <Box
              justifyContent="Center"
              gap="200"
              wrap="Wrap"
              style={{ paddingTop: config.space.S400 }}
            >
              {content.docsUrl && (
                <Button
                  as="a"
                  href={content.docsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  size="300"
                  radii="300"
                  variant="Secondary"
                  fill="Soft"
                  before={<Icon size="200" src={Icons.Info} />}
                >
                  <Text size="B300">{content.docsLabel}</Text>
                </Button>
              )}
              {content.sourceUrl && (
                <Button
                  as="a"
                  href={content.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  size="300"
                  radii="300"
                  variant="Secondary"
                  fill="Soft"
                  before={<Icon size="200" src={Icons.Code} />}
                >
                  <Text size="B300">{content.sourceLabel}</Text>
                </Button>
              )}
            </Box>
          </PageHero>
        </PageHeroSection>
        {showSetup && <LocalMindroomSetup />}
      </Box>
    </Page>
  );
}
