import { Fragment, ReactNode, useEffect, useState } from 'react';
import { Box, Button, Text, color, toRem } from 'folds';
import { useSetAtom } from 'jotai';
import { Trans, useTranslation } from 'react-i18next';
import { Page } from '../ui/page/Page';
import { useClientConfig } from '../config/useClientConfig';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { getMxIdLocalPart } from '../matrix/matrix';
import { useUserProfile } from '../members/useUserProfile';
import { getWelcomePageContent } from '../ui/branding/clientBranding';
import { IsolatedText, isolateInSentence } from '../ui/directional';
import { getLocalMindroomConnections } from '../local-mindroom/api';
import { getWelcomeSetupFirstSeenStorageKey } from '../preferences/accountStorageKeys';
import {
  isConnectionRevoked,
  resolveProvisioningRequest,
  shouldShowWelcomeSetupPrompt,
} from '../local-mindroom/provisioning';
import { LOCAL_MINDROOM_SETTINGS_PAGE } from '../local-mindroom/settingsPage';
import { useShowLocalMindroom } from '../local-mindroom/useShowLocalMindroom';
import { KeyBackupNudge } from '../account/onboarding/KeyBackupNudge';
import { UnverifiedDeviceCard } from '../account/verification/UnverifiedDeviceCard';
import type { PoweredByLink } from '../ui/branding/branding';
import { settingsModalAtom } from '../navigation/settingsModal';
import { tourAtom } from '../navigation/tourState';
import { HomeAsk } from './HomeAsk';
import { HomeRecentThreads } from './HomeRecentThreads';
import { useHomeAgents } from './homeAgents';
import * as css from './Home.css';

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
 * Whether to show the Local MindRoom setup steps: for an account that has Local
 * MindRoom (the deployment offers it and the account can sign in to provisioning,
 * as for the rail tab), a day after the welcome page was first seen, while no
 * Local MindRoom device is connected.
 */
const useWelcomeSetupPrompt = (): boolean => {
  const mx = useMatrixClient();
  const { sidebar } = useClientConfig();
  const offered = useShowLocalMindroom();
  const [show, setShow] = useState(false);
  const userId = mx.getSafeUserId();
  const { provisioningBaseUrl } = resolveProvisioningRequest({
    sessionHomeserverUrl: mx.getHomeserverUrl(),
    provisioningOverrideUrl: sidebar?.mindRoomProvisioningUrl,
    accessToken: mx.getAccessToken() ?? undefined,
  });

  useEffect(() => {
    if (!offered) return undefined;
    const storageKey = getWelcomeSetupFirstSeenStorageKey(userId);
    let firstSeen = readFirstSeen(storageKey);
    if (firstSeen === undefined) {
      firstSeen = Date.now();
      writeFirstSeen(storageKey, firstSeen);
    }
    let cancelled = false;
    void (async () => {
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
  }, [mx, userId, offered, provisioningBaseUrl]);

  return offered && show;
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

/** How a footer link looks: small, quiet, in a row with the others. */
const footerLink = {
  size: '300',
  radii: '300',
  variant: 'Secondary',
  fill: 'None',
} as const;

type FooterLinkProps = { children: ReactNode } & ({ href: string } | { onClick: () => void });

/** A link of the page's footer: with `href` opened in a new tab, with `onClick` an action here. */
function FooterLink({ children, ...target }: FooterLinkProps) {
  const label = (
    <Text size="T200" priority="300">
      {children}
    </Text>
  );
  if ('onClick' in target) {
    return (
      <Button type="button" onClick={target.onClick} {...footerLink}>
        {label}
      </Button>
    );
  }
  return (
    <Button
      as="a"
      href={target.href}
      target="_blank"
      rel="noreferrer noopener"
      style={{ textDecoration: 'none' }}
      {...footerLink}
    >
      {label}
    </Button>
  );
}

/** Credit links in the theme's primary colour, without underlines. */
const CREDIT_LINK_STYLE = { color: color.Primary.Main, textDecoration: 'none' } as const;

/** "Powered by A • B": the credited projects, each linked. */
function PoweredByLine({ links }: { links: readonly PoweredByLink[] }) {
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
    <Text size="T200" priority="300" align="Center" style={{ width: '100%' }}>
      <Trans i18nKey="sharedUi.welcomePage.poweredBy" components={{ links: <>{linked}</> }} />
    </Text>
  );
}

/** Morning until noon, afternoon until six, evening after. */
export const greetingKey = (hour: number) => {
  if (hour >= 5 && hour < 12) return 'home.greeting.morning' as const;
  if (hour >= 12 && hour < 18) return 'home.greeting.afternoon' as const;
  return 'home.greeting.evening' as const;
};

/** "Good afternoon, Robin", by the device's clock and the account's display name. */
function Greeting() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const { displayName } = useUserProfile(userId);
  const name = displayName || getMxIdLocalPart(userId) || userId;
  return (
    <Text as="h1" size="H2" align="Center">
      <IsolatedText
        text={t(greetingKey(new Date().getHours()), { name: isolateInSentence(name) })}
      />
    </Text>
  );
}

/**
 * Shown when no room is open: a greeting, a field that asks one of the rooms' agents a question as
 * a new thread, the newest threads, quiet notices for recovery and this device's verification,
 * and links to docs, the interface tour and the source. An account without agents gets the
 * deployment's welcome heading in place of the greeting, and of the field only what is left of
 * a question on its way.
 */
export function WelcomePage() {
  const { t } = useTranslation();
  const { welcome } = useClientConfig();
  const content = getWelcomePageContent(welcome, t);
  const showSetup = useWelcomeSetupPrompt();
  const setTour = useSetAtom(tourAtom);
  const agents = useHomeAgents();

  return (
    <Page>
      <div className={css.Scroll}>
        <div className={css.Column}>
          {agents.length > 0 ? (
            <Greeting />
          ) : (
            <Box direction="Column" alignItems="Center" gap="200">
              <Text as="h1" size="H2" align="Center">
                {content.title}
              </Text>
              <Text priority="400" align="Center">
                {content.subtitle}
              </Text>
            </Box>
          )}
          <HomeAsk agents={agents} />
          <HomeRecentThreads />
          <UnverifiedDeviceCard />
          <KeyBackupNudge />
          {showSetup && <LocalMindroomSetup />}
        </div>
        <footer className={css.Footer}>
          {content.docsUrl && <FooterLink href={content.docsUrl}>{content.docsLabel}</FooterLink>}
          <FooterLink onClick={() => setTour({ level: 'quick' })}>
            {t('tour.entries.howThreadsWork')}
          </FooterLink>
          {content.sourceUrl && (
            <FooterLink href={content.sourceUrl}>{content.sourceLabel}</FooterLink>
          )}
          {Array.isArray(content.poweredBy) && <PoweredByLine links={content.poweredBy} />}
        </footer>
      </div>
    </Page>
  );
}
