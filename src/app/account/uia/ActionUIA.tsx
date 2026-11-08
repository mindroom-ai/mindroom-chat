import { FormEventHandler, ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthDict, AuthType, IAuthData, UIAFlow } from 'matrix-js-sdk';
import { Box, Button, Icon, IconButton, Icons, Input, Text, color, config } from 'folds';
import { Dialog, Header } from '../../ui/glass/GlassPrimitives';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { matchesEnum } from '../../lib/matchesEnum';

/** The unstable name of `m.oauth` (MSC4191), which servers built before spec v1.17 send. */
const OAUTH_UNSTABLE = 'org.matrix.cross_signing_reset';

const SUPPORTED_STAGES: ReadonlySet<string> = new Set([
  AuthType.Password,
  AuthType.Sso,
  AuthType.SsoUnstable,
  AuthType.Dummy,
  AuthType.OAuth,
  OAUTH_UNSTABLE,
]);

const isOAuthStage = (stage: string) =>
  matchesEnum(stage, AuthType.OAuth) || stage === OAUTH_UNSTABLE;

const isSsoStage = (stage: string) =>
  matchesEnum(stage, AuthType.Sso) || matchesEnum(stage, AuthType.SsoUnstable);

const isSingleStage = (flow: UIAFlow, test: (stage: string) => boolean) =>
  flow.stages.length === 1 && flow.stages.every(test);

/**
 * Chooses the flow to authenticate an action with: single sign-on first (accounts created
 * through SSO often have no password), then password, then whatever the server lists first.
 */
export const pickUIAFlow = (flows: UIAFlow[]): UIAFlow | undefined =>
  flows.find((flow) => isSingleStage(flow, isSsoStage)) ??
  flows.find((flow) => isSingleStage(flow, (stage) => matchesEnum(stage, AuthType.Password))) ??
  flows[0];

const isFlowSupported = (flow: UIAFlow) =>
  flow.stages.every((stage) => SUPPORTED_STAGES.has(stage));

type FlowsLoaderProps = {
  /** Rendered with the chosen flow. */
  children: (flow: UIAFlow) => ReactNode;
  /** Shown when no flow the server offers consists only of stages this client can do. */
  unsupported: () => ReactNode;
  authData: IAuthData;
};

/** Chooses the flow to authenticate with among those this client can complete. */
export function ActionUIAFlowsLoader({ authData, unsupported, children }: FlowsLoaderProps) {
  const flow = pickUIAFlow((authData.flows ?? []).filter(isFlowSupported));

  return <>{flow ? children(flow) : unsupported()}</>;
}

type StageProps = {
  session?: string;
  stage: string;
  action: (authDict: AuthDict) => void;
};

function PasswordStage({ session, action }: StageProps) {
  const mx = useMatrixClient();
  const { t } = useTranslation();

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get('passwordInput');
    if (typeof password !== 'string' || password === '') return;
    // Matrix spec, client-server API, "Password-based" authentication: the user identifier
    // and password, with the session of this interactive authentication.
    action({
      type: AuthType.Password,
      identifier: { type: 'm.id.user', user: mx.getUserId() ?? '' },
      password,
      session: session ?? '',
    });
  };

  return (
    <Box as="form" direction="Column" gap="400" onSubmit={handleSubmit}>
      <Text size="T300">
        {t('sharedUi.passwordStage.toPerformThisActionYouNeedToAuthenticateYourselfByEnteringYou')}
      </Text>
      <Box direction="Column" gap="100">
        <Text size="L400">{t('sharedUi.passwordStage.password')}</Text>
        <Input
          name="passwordInput"
          type="password"
          autoComplete="current-password"
          variant="Background"
          size="400"
          outlined
          required
          autoFocus
        />
      </Box>
      <Button variant="Primary" type="submit">
        <Text size="B400">{t('sharedUi.passwordStage.continue')}</Text>
      </Button>
    </Box>
  );
}

function SsoStage({ session, stage, action }: StageProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const [opened, setOpened] = useState(false);

  const openSso = () => {
    window.open(mx.getFallbackAuthUrl(stage, session ?? ''), '_blank', 'noopener');
    setOpened(true);
  };

  return (
    <Box direction="Column" gap="400">
      <Text size="T300">
        {t('sharedUi.sSOStage.toPerformThisActionYouNeedToAuthenticateYourselfBySsoLogin')}
      </Text>
      <Button variant={opened ? 'Secondary' : 'Primary'} onClick={openSso}>
        <Text size="B400">{t('sharedUi.sSOStage.continueWithSso')}</Text>
      </Button>
      {opened && (
        <Button variant="Primary" onClick={() => action({ session })}>
          <Text size="B400">{t('sharedUi.sSOStage.continue')}</Text>
        </Button>
      )}
    </Box>
  );
}

/**
 * The account page the server names for an `m.oauth` stage (spec: "OAuth authentication"), which
 * guards replacing the cross-signing keys of a session that signed in through OAuth.
 */
const oauthApprovalUrl = (authData: IAuthData, stage: string): string | undefined => {
  const url: unknown = authData.params?.[stage]?.url ?? authData.params?.[AuthType.OAuth]?.url;
  return typeof url === 'string' ? url : undefined;
};

/**
 * Sends the person to their account page to approve the action there, then completes the stage
 * with the session alone, as the spec asks. A server that names no page gets its fallback page.
 */
function OAuthStage({ session, stage, action, url }: StageProps & { url?: string }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const [opened, setOpened] = useState(false);

  const openAccountPage = () => {
    window.open(url ?? mx.getFallbackAuthUrl(stage, session ?? ''), '_blank', 'noopener');
    setOpened(true);
  };

  return (
    <Box direction="Column" gap="400">
      <Text size="T300">{t('sharedUi.oauthStage.description')}</Text>
      <Button variant={opened ? 'Secondary' : 'Primary'} onClick={openAccountPage}>
        <Text size="B400">{t('sharedUi.oauthStage.open')}</Text>
      </Button>
      {opened && (
        <Button variant="Primary" onClick={() => action({ session })}>
          <Text size="B400">{t('sharedUi.sSOStage.continue')}</Text>
        </Button>
      )}
    </Box>
  );
}

function DummyStage({ session, action }: StageProps) {
  useEffect(() => {
    action({ type: AuthType.Dummy, session });
  }, [action, session]);
  return null;
}

type ActionUIAProps = Pick<StageProps, 'action'> & {
  /** The flow chosen by `ActionUIAFlowsLoader`. */
  ongoingFlow: UIAFlow;
  authData: IAuthData;
  /** Closes the dialog without authenticating. */
  onCancel(): void;
};

/** A dialog for the first stage of `ongoingFlow` the server has not marked completed. */
export function ActionUIA(props: ActionUIAProps) {
  const { authData, ongoingFlow, action, onCancel } = props;
  const { t } = useTranslation();
  const { session, completed = [] } = authData;
  const stage = ongoingFlow.stages.find((candidate) => !completed.includes(candidate));

  let body: ReactNode;
  let title: string | undefined;
  if (stage === AuthType.Password) {
    title = t('sharedUi.passwordStage.accountPassword');
    body = <PasswordStage stage={stage} session={session} action={action} />;
  } else if (stage && isSsoStage(stage)) {
    title = t('sharedUi.sSOStage.ssoLogin');
    body = <SsoStage stage={stage} session={session} action={action} />;
  } else if (stage && isOAuthStage(stage)) {
    title = t('sharedUi.oauthStage.title');
    body = (
      <OAuthStage
        stage={stage}
        session={session}
        action={action}
        url={oauthApprovalUrl(authData, stage)}
      />
    );
  } else if (stage === AuthType.Dummy)
    body = <DummyStage stage={stage} session={session} action={action} />;
  else {
    body = (
      <Text size="T300" style={{ color: color.Critical.Main }}>
        {t(
          'sharedUi.deviceVerificationSetup.authenticationStepsToPerformThisActionAreNotSupportedByClient'
        )}
      </Text>
    );
  }

  return (
    <Dialog variant="Surface" role="dialog" aria-modal="true">
      <Header
        style={{ paddingBlock: 0, paddingInline: `${config.space.S400} ${config.space.S200}` }}
        size="500"
      >
        <Box grow="Yes">{title && <Text size="H4">{title}</Text>}</Box>
        <IconButton
          size="300"
          radii="300"
          onClick={onCancel}
          aria-label={t('sharedUi.dummyStage.cancel')}
        >
          <Icon src={Icons.Cross} />
        </IconButton>
      </Header>
      <Box direction="Column" style={{ padding: config.space.S400 }}>
        {body}
      </Box>
    </Dialog>
  );
}
