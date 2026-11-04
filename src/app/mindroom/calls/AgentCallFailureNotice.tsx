import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom } from 'jotai';
import { Box, Icon, IconButton, Icons, Text, color } from 'folds';
import { Surface } from '../../components/glass/GlassPrimitives';
import { AGENT_CALL_ERROR_KEYS, agentCallFailureAtom } from './agentCaller';
import * as css from '../../features/calls/IncomingCalls.css';

/** How long the notice stays when nobody closes it. */
const SHOWN_MS = 12_000;

/**
 * Why an agent call from the header or the phone room menu did not start: the browser cannot
 * call, the deployment has no call service, another call is on, or starting it failed. It shows
 * where rings show, until closed or for a few seconds.
 */
export function AgentCallFailureNotice() {
  const { t } = useTranslation();
  const [failure, setFailure] = useAtom(agentCallFailureAtom);

  useEffect(() => {
    if (!failure) return undefined;
    const timer = window.setTimeout(
      () => setFailure((current) => (current?.id === failure.id ? undefined : current)),
      SHOWN_MS
    );
    return () => window.clearTimeout(timer);
  }, [failure, setFailure]);

  if (!failure) return null;
  const title = t('featureUi.call.callView.voiceCallError');
  return (
    <Surface
      className={css.Card}
      role="alert"
      aria-label={title}
      data-agent-call-failure={failure.error}
    >
      <Box alignItems="Start" gap="300">
        <Icon size="300" src={Icons.Warning} style={{ color: color.Critical.Main }} />
        <Box direction="Column" grow="Yes" style={{ minWidth: 0 }}>
          <Text size="L400" priority="300">
            {title}
          </Text>
          <Text size="T300">{t(AGENT_CALL_ERROR_KEYS[failure.error])}</Text>
        </Box>
        <IconButton
          size="300"
          radii="300"
          variant="Surface"
          aria-label={t('featureUi.call.callView.dismissVoiceCallError')}
          onClick={() => setFailure(undefined)}
        >
          <Icon size="100" src={Icons.Cross} />
        </IconButton>
      </Box>
    </Surface>
  );
}
