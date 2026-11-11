import {
  FormEventHandler,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Box, Button, Input, Scroll, Spinner, Text, color } from 'folds';
import { Header, Surface } from '../../ui/glass/GlassPrimitives';
import { glassOverBackdrop } from '../../ui/styles/Glass.css';
import {
  ParticleBackgroundSurface,
  usePersistentParticleBackground,
} from '../../ui/particle-background/PersistentParticleBackground';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { AutoDiscoveryAction, autoDiscovery, type AutoDiscoveryInfo } from '../../matrix/cs-api';
import { AutoDiscoveryInfoProvider } from '../../matrix/hooks/useAutoDiscoveryInfo';
import { AuthServerProvider } from './useAuthServer';
import { useClientConfig } from '../../config/useClientConfig';
import { useActiveSession } from '../../matrix/session/useSessionStore';
import { useDeploymentBranding } from '../../ui/branding/deploymentBranding';
import { BrandLogo } from './BrandLogo';
import { createMatrixFetchFn } from '../../matrix/client/matrixClientFactory';
import { decodeRouteParam } from '../../routes/pathUtils';
import { resolveAuthRouteRedirect } from '../../navigation/routeSessionGuards';
import { resolveAddAccountReturnPath } from '../../navigation/addAccount';
import { buildAuthRoutePath, isServerChoiceLocked, resolveAuthServer } from './authRouteUtils';
import { AuthFooter } from './AuthFooter';
import { deploymentDefaultServer } from './unlistedServer';
import { UnlistedServerCheck } from './UnlistedServerCheck';
import { openAfterSignIn } from './completeSession';
import * as css from './styles.css';

/** The configured servers, offered as suggestions in the free-text server field. */
const SERVER_LIST_ID = 'auth-server-list';

type DiscoveryState =
  | { status: 'loading' }
  | { status: 'ready'; info: AutoDiscoveryInfo }
  | { status: 'error'; server: string; action: AutoDiscoveryAction };

const useDefaultServer = (): string => deploymentDefaultServer(useClientConfig());

const useServerLocked = (): boolean => isServerChoiceLocked(useClientConfig());

/** The server's well-known answer; `retry` asks again after a failure. */
const useServerDiscovery = (server: string): [DiscoveryState, () => void] => {
  const [state, setState] = useState<DiscoveryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    void autoDiscovery(createMatrixFetchFn(fetch), server).then(([error, info]) => {
      if (cancelled) return;
      if (info && !error) setState({ status: 'ready', info });
      else
        setState({
          status: 'error',
          server,
          action: error?.action ?? AutoDiscoveryAction.FAIL_PROMPT,
        });
    });
    return () => {
      cancelled = true;
    };
  }, [server, attempt]);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return [state, retry];
};

type DiscoveryFailureProps = { failure: AutoDiscoveryAction; retry: () => void };

/** Why the server could not be used, and a way to try it again. */
function DiscoveryFailure(props: DiscoveryFailureProps) {
  const { t } = useTranslation();
  const insecure = props.failure === AutoDiscoveryAction.FAIL_INSECURE;
  return (
    <Box direction="Column" alignItems="Start" gap="200" role="alert">
      <Text style={{ color: color.Critical.Main }} size="T300">
        {insecure
          ? t('sharedUi.authLayout.onlyHttpsServersAreAllowedHttpIsSupportedForLocalNetworkServers')
          : t('sharedUi.authLayout.failedToConnectEitherServerIsUnavailableAtThisMomentOrDoes')}
      </Text>
      {!insecure && (
        <Button variant="Secondary" fill="Soft" size="300" radii="300" onClick={props.retry}>
          <Text as="span" size="B300">
            {t('sharedUi.authFlowsLoader.retry')}
          </Text>
        </Button>
      )}
    </Box>
  );
}

function ServerPicker({
  server,
  onChange,
}: {
  server: string;
  onChange: (server: string) => void;
}) {
  const { t } = useTranslation();
  const { homeserverList } = useClientConfig();
  const locked = useServerLocked();

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const target = event.target as HTMLFormElement & { serverInput: HTMLInputElement };
    const value = target.serverInput.value.trim();
    if (value && value !== server) onChange(value);
  };

  if (locked && (homeserverList?.length ?? 0) <= 1) return null;

  return (
    <Box as="form" onSubmit={handleSubmit} direction="Column" gap="100">
      <Text as="label" size="L400" priority="300">
        {t('sharedUi.serverPicker.server')}
      </Text>
      {locked && homeserverList && homeserverList.length > 0 ? (
        <select
          aria-label={t('sharedUi.serverPicker.server')}
          value={server}
          onChange={(event) => onChange(event.target.value)}
        >
          {homeserverList.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      ) : (
        <>
          <Input
            key={server}
            name="serverInput"
            defaultValue={server}
            aria-label={t('sharedUi.serverPicker.server')}
            list={homeserverList && homeserverList.length > 1 ? SERVER_LIST_ID : undefined}
            autoComplete="off"
            variant="Background"
            size="500"
            outlined
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              if (value && value !== server) onChange(value);
            }}
          />
          {homeserverList && homeserverList.length > 1 && (
            <datalist id={SERVER_LIST_ID} aria-label={t('sharedUi.serverPicker.serverList')}>
              {homeserverList.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          )}
        </>
      )}
    </Box>
  );
}

/** Room kept between a form's submit button and the keyboard, and above the focused field. */
const KEYBOARD_REVEAL_GAP = 16;

/**
 * On a phone the keyboard makes the page shorter: the iOS app's web view shrinks, and so does
 * Safari's visual viewport, which useMobileKeyboardViewportFix hands on to the app. The browser
 * brings only the focused field into view, which left the form's submit button under the keyboard.
 * While a field of a form has the focus, the page scrolls the button into view too, as far as the
 * field stays in view.
 */
const useSubmitAboveKeyboard = (scrollRef: RefObject<HTMLElement>) => {
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return undefined;
    const reveal = () => {
      const field = document.activeElement;
      if (!(field instanceof HTMLElement) || !scroller.contains(field)) return;
      const submit = field.closest('form')?.querySelector('[type="submit"]');
      if (!submit) return;
      const view = scroller.getBoundingClientRect();
      const hidden = submit.getBoundingClientRect().bottom + KEYBOARD_REVEAL_GAP - view.bottom;
      const spare = field.getBoundingClientRect().top - KEYBOARD_REVEAL_GAP - view.top;
      const by = Math.min(hidden, spare);
      if (by > 0) scroller.scrollTop += by;
    };
    // The keyboard resizes the scroller, and the focus can move to another field while it is up.
    const resizeObserver = new ResizeObserver(reveal);
    resizeObserver.observe(scroller);
    scroller.addEventListener('focusin', reveal);
    return () => {
      resizeObserver.disconnect();
      scroller.removeEventListener('focusin', reveal);
    };
  }, [scrollRef]);
};

/** The full-height scrolling page the sign-in card sits on, above the particle background. */
function AuthFrame({ children }: { children: ReactNode }) {
  const persistentParticle = usePersistentParticleBackground();
  const scrollRef = useRef<HTMLDivElement>(null);
  useSubmitAboveKeyboard(scrollRef);
  const layoutClassName = classNames(
    css.AuthLayout,
    persistentParticle && css.AuthLayoutPersistentParticle
  );

  return (
    <Scroll
      ref={scrollRef}
      className={css.AuthScroll}
      hideTrack
      size="300"
      variant="Background"
      visibility="Hover"
    >
      <Box className={layoutClassName}>
        <ParticleBackgroundSurface />
        {children}
      </Box>
    </Scroll>
  );
}

/** The sign-in card around login, registration and password reset, with the homeserver choice. */
export function AuthLayout() {
  const { t } = useTranslation();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const { server: encodedServer } = useParams();
  const defaultServer = useDefaultServer();
  const locked = useServerLocked();
  const { auth, homeserverList } = useClientConfig();
  const branding = useDeploymentBranding();
  const requestedServer = encodedServer ? decodeRouteParam(encodedServer) : undefined;
  const server = resolveAuthServer(requestedServer, defaultServer, locked, homeserverList);
  const [discovery, retryDiscovery] = useServerDiscovery(server);
  const activeSession = useActiveSession();
  // Adding an account can be abandoned: back to where the signed-in account was.
  const returnPath = resolveAddAccountReturnPath(search, activeSession);

  const homeRedirect =
    typeof window !== 'undefined' ? resolveAuthRouteRedirect(window.location.href) : null;
  // An active session leaves these pages for the page asked for before sign-in, or Home. A
  // sign-in on them leaves its navigation to this redirect (useCompleteSession).
  useEffect(() => {
    if (homeRedirect) openAfterSignIn(navigate);
  }, [homeRedirect, navigate]);

  const registrationAllowed = auth?.allowRegistration !== false;
  const showServer = (nextServer: string) =>
    navigate(
      buildAuthRoutePath({ pathname, search, hash, registrationAllowed, server: nextServer }),
      { replace: true }
    );

  // The address always names the server the card shows: `/login` becomes `/login/<default>`,
  // and a server a locked deployment does not offer is replaced by the one it falls back to.
  const urlNamesServer = requestedServer?.trim() === server;
  useEffect(() => {
    if (!homeRedirect && !urlNamesServer) showServer(server);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeRedirect, urlNamesServer, server]);

  const handleServerChange = (nextServer: string) => {
    if (resolveAuthServer(nextServer, defaultServer, locked, homeserverList) !== nextServer) return;
    showServer(nextServer);
  };

  return (
    <AuthFrame>
      {/* Glass over the particles, which show through it blurred. The dark field behind it
          takes the lighter tint of glass over a dimmed page, as a modal's does. */}
      <Surface as="main" className={classNames(css.AuthCard, glassOverBackdrop)}>
        <Header className={css.AuthHeader} size="600" variant="Surface">
          <Box grow="Yes" alignItems="Center" gap="300">
            {/* The page's one heading; each page's own title is a paragraph under the server. An
                empty title leaves the logo alone as the heading, named by its alt text. */}
            {branding.showTitle ? (
              <>
                <BrandLogo className={css.AuthLogo} />
                <Text as="h1" size="H3" truncate>
                  {branding.title}
                </Text>
              </>
            ) : (
              <h1 className={css.AuthLogoHeading}>
                <BrandLogo className={css.AuthLogo} />
              </h1>
            )}
          </Box>
        </Header>
        <Box className={css.AuthCardContent} direction="Column" gap="500">
          <ServerPicker server={server} onChange={handleServerChange} />
          {discovery.status === 'loading' && (
            <Box justifyContent="Center" alignItems="Center" gap="200">
              <Spinner variant="Secondary" size="200" />
              <Text size="T300">{t('sharedUi.authLayout.lookingForServer')}</Text>
            </Box>
          )}
          {discovery.status === 'error' && (
            <DiscoveryFailure failure={discovery.action} retry={retryDiscovery} />
          )}
          {discovery.status === 'ready' && (
            <AuthServerProvider value={server}>
              <AutoDiscoveryInfoProvider value={discovery.info}>
                <UnlistedServerCheck
                  server={server}
                  baseUrl={discovery.info['m.homeserver'].base_url}
                >
                  <Outlet context={{ server }} />
                </UnlistedServerCheck>
              </AutoDiscoveryInfoProvider>
            </AuthServerProvider>
          )}
          {returnPath && (
            <Text align="Center" size="T300">
              <Link to={returnPath}>{t('sharedUi.authLayout.backToCurrentAccount')}</Link>
            </Text>
          )}
        </Box>
      </Surface>
      <AuthFooter />
    </AuthFrame>
  );
}
