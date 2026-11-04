import { type ReactNode, useMemo, useRef, useState } from 'react';
import { Box, Button, Icon, Icons, Text, config, toRem } from 'folds';
import { useTranslation } from 'react-i18next';
import { Dialog, Header, IconButton } from '../../components/glass/GlassPrimitives';
import { ModalLayer } from '../../components/ModalLayer';
import { useClientConfig } from '../../hooks/useClientConfig';
import {
  isDeploymentServer,
  signInHost,
  SsoStartCheckProvider,
  type SsoStartCheck,
} from './unlistedServer';

const HEADING_ID = 'unlisted-server-heading';
const DESCRIPTION_ID = 'unlisted-server-description';
const HOST_ID = 'unlisted-server-host';

type UnlistedServerPromptProps = {
  host: string;
  onCancel: () => void;
  onContinue: () => void;
};

/** Names the server a single sign-on would send the login to, and asks before going there. */
export function UnlistedServerPrompt({ host, onCancel, onContinue }: UnlistedServerPromptProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <ModalLayer onClose={onCancel} focus={{ initialFocus: () => cancelRef.current ?? false }}>
      <Dialog
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={HEADING_ID}
        aria-describedby={DESCRIPTION_ID}
        style={{ width: `min(calc(100vw - 2 * ${config.space.S400}), ${toRem(420)})` }}
      >
        <Header size="500" style={{ paddingInline: `${config.space.S400} ${config.space.S200}` }}>
          <Text id={HEADING_ID} size="H4" style={{ flexGrow: 1 }}>
            {t('sharedUi.unlistedServer.title')}
          </Text>
          <IconButton
            aria-label={t('sharedUi.unlistedServer.cancel')}
            size="300"
            radii="300"
            onClick={onCancel}
          >
            <Icon src={Icons.Cross} size="200" />
          </IconButton>
        </Header>
        <Box
          id={DESCRIPTION_ID}
          direction="Column"
          gap="300"
          style={{ padding: `${config.space.S200} ${config.space.S400} ${config.space.S400}` }}
        >
          <Text size="T300" priority="400">
            {t('sharedUi.unlistedServer.sendsLogin')}
          </Text>
          <Text id={HOST_ID} size="H3" style={{ overflowWrap: 'anywhere' }} dir="ltr">
            {host}
          </Text>
          <Text size="T300" priority="400">
            {t('sharedUi.unlistedServer.onlyIfTrusted', { server: host })}
          </Text>
        </Box>
        <Box
          gap="200"
          justifyContent="End"
          wrap="Wrap"
          style={{ padding: `0 ${config.space.S400} ${config.space.S400}` }}
        >
          <Button
            ref={cancelRef}
            variant="Secondary"
            fill="Soft"
            outlined
            size="400"
            radii="300"
            onClick={onCancel}
          >
            <Text size="B400">{t('sharedUi.unlistedServer.cancel')}</Text>
          </Button>
          <Button variant="Critical" fill="Solid" size="400" radii="300" onClick={onContinue}>
            <Text size="B400">{t('sharedUi.unlistedServer.continue')}</Text>
          </Button>
        </Box>
      </Dialog>
    </ModalLayer>
  );
}

type UnlistedServerCheckProps = {
  /** The server on screen, as the address or the picker names it. */
  server: string;
  /** Its discovered homeserver URL, where single sign-on goes and the token is exchanged. */
  baseUrl: string;
  children: ReactNode;
};

/**
 * Lets the sign-in buttons below start at once on a server the deployment offers, and makes them
 * ask first on any other: such a server receives the login, and through the nonce in its
 * redirect it can obtain the login token of the person's real homeserver.
 */
export function UnlistedServerCheck({ server, baseUrl, children }: UnlistedServerCheckProps) {
  const clientConfig = useClientConfig();
  const listed = isDeploymentServer(clientConfig, server);
  const [pendingStart, setPendingStart] = useState<{ start: () => void }>();
  const check = useMemo<SsoStartCheck | undefined>(
    () => (listed ? undefined : (start) => setPendingStart({ start })),
    [listed]
  );

  const proceed = () => {
    const pending = pendingStart;
    setPendingStart(undefined);
    pending?.start();
  };

  return (
    <SsoStartCheckProvider value={check}>
      {children}
      {pendingStart && !listed && (
        <UnlistedServerPrompt
          host={signInHost(baseUrl)}
          onCancel={() => setPendingStart(undefined)}
          onContinue={proceed}
        />
      )}
    </SsoStartCheckProvider>
  );
}
