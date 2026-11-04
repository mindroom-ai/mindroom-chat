import React, { Fragment, ReactNode, useEffect, useState } from 'react';
import { Box, Button, Icon, Icons, Text, config, toRem } from 'folds';
import type { IconSrc } from 'folds';
import { useSetAtom } from 'jotai';
import { Trans, useTranslation } from 'react-i18next';
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
import { KeyBackupNudge } from '../../mindroom/onboarding/KeyBackupNudge';
import { UnverifiedDeviceCard } from '../../components/device-verification/UnverifiedDeviceCard';
import type { MindroomPoweredByLink } from '../../mindroom/branding/branding';
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
      <Text size="H4">{t('sharedUi.welcomePage.setUpLocalMindroom')}</Text>
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
          <Text size="B300">{t('sharedUi.welcomePage.enterPairCode')}</Text>
        </Button>
      </Box>
    </Box>
  );
}

/** The welcome column's width in home.png: links, cards and credits all share it. */
const WELCOME_COLUMN_WIDTH = toRem(360);

type WelcomeLinkProps = { href: string; icon: IconSrc; children: ReactNode };

/** A full-width link button of the welcome column, opened in a new tab. */
function WelcomeLink({ href, icon, children }: WelcomeLinkProps) {
  return (
    <Button
      as="a"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      size="400"
      radii="300"
      variant="Primary"
      fill="Soft"
      outlined
      before={<Icon size="100" src={icon} />}
      style={{ textDecoration: 'none' }}
    >
      <Text size="B400">{children}</Text>
    </Button>
  );
}

/** Credit links in the theme's link colour (src/index.css), without underlines. */
const CREDIT_LINK_STYLE = { color: 'var(--mr-link-color)', textDecoration: 'none' } as const;

/** "Powered by A • B": the credited projects, each linked. */
function PoweredByLine({ links }: { links: readonly MindroomPoweredByLink[] }) {
  if (links.length === 0) return null;
  const linked = links.map((link, index) => (
    <Fragment key={link.url}>
      {index > 0 && ' • '}
      <a href={link.url} target="_blank" rel="noreferrer noopener" style={CREDIT_LINK_STYLE}>
        {link.label}
      </a>
    </Fragment>
  ));
  return (
    <Text size="T300" align="Center">
      <Trans i18nKey="sharedUi.welcomePage.poweredBy" components={{ links: <>{linked}</> }} />
    </Text>
  );
}

/** Shown when no room is open: the app's name, links to source and docs, backup and setup help. */
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
              direction="Column"
              gap="300"
              style={{ width: '100%', maxWidth: WELCOME_COLUMN_WIDTH, marginInline: 'auto' }}
            >
              {content.sourceUrl && (
                <WelcomeLink href={content.sourceUrl} icon={Icons.Code}>
                  {content.sourceLabel}
                </WelcomeLink>
              )}
              {content.docsUrl && (
                <WelcomeLink href={content.docsUrl} icon={Icons.Info}>
                  {content.docsLabel}
                </WelcomeLink>
              )}
              <UnverifiedDeviceCard />
              <KeyBackupNudge />
              {Array.isArray(content.poweredBy) && <PoweredByLine links={content.poweredBy} />}
            </Box>
          </PageHero>
        </PageHeroSection>
        {showSetup && <LocalMindroomSetup />}
      </Box>
    </Page>
  );
}
