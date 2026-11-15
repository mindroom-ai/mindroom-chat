import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box, Button, Icon, Icons, Text } from 'folds';
import { isRecord } from '../lib/isRecord';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import {
  effectiveSecretRequestStatus,
  secretRequestPath,
  type SecretRequest,
  type SecretRequestStatus,
} from '../matrix/protocol/secretRequest';
import { clientSessions, MindroomServerError } from '../computer/clientSessions';
import { useRoomMindroomServer } from '../computer/useRoomMindroomServer';
import { PasswordInput } from '../ui/PasswordInput';
import { useGlassHighlight } from '../ui/glass/liquid/useLiquidGlass';
import { IsolatedText, isolateInSentence, ownDirectionBlock } from '../ui/directional';
import { useApprovalRoom, userDisplayName } from './approvalPeople';
import * as cardCss from './ToolApprovalCard.css';
import * as sectionCss from './ThreadApprovals.css';
import * as css from './SecretRequestCard.css';

const MAX_TIMEOUT_DELAY = 2_147_483_647;
/** A refusal's detail is shown up to this many characters. */
const MAX_DETAIL_LENGTH = 300;

/** What the requester's answer did while the card still reads pending, until the agent edits it. */
type Answer = 'saved' | 'declined' | 'inactive';

type Chip = SecretRequestStatus | 'waitingForYou';

const CHIP_KEYS = {
  waitingForYou: 'mindroomUi.messages.secretRequestCard.status.waitingForYou',
  pending: 'mindroomUi.messages.secretRequestCard.status.pending',
  saved: 'mindroomUi.messages.secretRequestCard.status.saved',
  declined: 'mindroomUi.messages.secretRequestCard.status.declined',
  expired: 'mindroomUi.messages.secretRequestCard.status.expired',
} as const satisfies Record<Chip, string>;

const ANSWER_CHIPS = {
  saved: 'saved',
  declined: 'declined',
  inactive: 'expired',
} as const satisfies Record<Answer, Chip>;

const ANSWER_KEYS = {
  saved: 'mindroomUi.messages.secretRequestCard.savedWaiting',
  declined: 'mindroomUi.messages.secretRequestCard.declinedWaiting',
  inactive: 'mindroomUi.messages.secretRequestCard.noLongerActive',
} as const satisfies Record<Answer, string>;

/** The `detail` of a refusal, cut to a readable length; undefined when it carries none. */
const readDetail = async (response: Response): Promise<string | undefined> => {
  const body: unknown = await response.json().catch(() => undefined);
  const detail = isRecord(body) ? body.detail : undefined;
  return typeof detail === 'string' && detail.trim()
    ? detail.trim().slice(0, MAX_DETAIL_LENGTH)
    : undefined;
};

/**
 * The requester's masked field with Save and Decline. The key stays in this component's state
 * until it goes to the room's MindRoom server, never to an origin the card names, and is dropped
 * once the server took it or the request is gone.
 */
function SecretRequestAnswer({
  request,
  roomId,
  onAnswer,
}: {
  request: SecretRequest;
  roomId: string;
  onAnswer: (answer: Answer) => void;
}) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { apiUrl, pending } = useRoomMindroomServer(mx, roomId);
  const [secret, setSecret] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  // A second press before the first answer arrives sends nothing.
  const sendingRef = useRef(false);

  if (!pending && !apiUrl) {
    return <Text size="T200">{t('mindroomUi.messages.secretRequestCard.unavailable')}</Text>;
  }

  const ready = !pending && !!apiUrl && !sending;

  const send = async (decline: boolean) => {
    if (pending || !apiUrl || sendingRef.current) return;
    if (!decline && secret.trim() === '') return;
    sendingRef.current = true;
    setSending(true);
    setError(undefined);
    try {
      const response = await clientSessions(mx, apiUrl).send(
        secretRequestPath(roomId, request.requestId),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(decline ? { decline: true } : { secret }),
        }
      );
      if (response.ok || response.status === 404) {
        setSecret('');
        onAnswer(response.status === 404 ? 'inactive' : decline ? 'declined' : 'saved');
        return;
      }
      const detail =
        response.status === 403 || response.status === 422
          ? await readDetail(response)
          : undefined;
      setError(detail ?? t(response.status >= 500 ? 'errors.serverProblem' : 'errors.serverRefused'));
    } catch (caught) {
      // No answer may come next time; a refused sign-in (a homeserver that does not bind tokens
      // to this server, or a server that does not take them) will not.
      setError(
        caught instanceof MindroomServerError && caught.status === 0
          ? t('errors.noConnection')
          : t('mindroomUi.messages.secretRequestCard.unavailable')
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return (
    <>
      <form
        className={sectionCss.DenyRow}
        onSubmit={(event) => {
          event.preventDefault();
          void send(false);
        }}
      >
        <PasswordInput
          size="300"
          variant="Background"
          aria-label={t('mindroomUi.messages.secretRequestCard.title', {
            name: request.displayName,
          })}
          placeholder={t('mindroomUi.messages.secretRequestCard.placeholder')}
          autoComplete="off"
          spellCheck={false}
          value={secret}
          onChange={(event) => setSecret(event.currentTarget.value)}
        />
        <div className={sectionCss.Actions}>
          <Button
            type="submit"
            size="300"
            variant="Primary"
            fill="Soft"
            outlined
            radii="300"
            disabled={!ready || secret.trim() === ''}
          >
            <Text size="B300">{t('mindroomUi.messages.secretRequestCard.save')}</Text>
          </Button>
          <Button
            type="button"
            size="300"
            variant="Critical"
            fill="Soft"
            outlined
            radii="300"
            disabled={!ready}
            onClick={() => {
              void send(true);
            }}
          >
            <Text size="B300">{t('mindroomUi.messages.secretRequestCard.decline')}</Text>
          </Button>
        </div>
      </form>
      {error && (
        <Text as="p" size="T200" role="alert">
          {error}
        </Text>
      )}
    </>
  );
}

/**
 * An agent's request for a key (`io.mindroom.secret_request`): the service, the agent's reason
 * and the hosts the key may go to, with a field for the person asked while it is pending.
 */
export function SecretRequestCard({ request, roomId }: { request: SecretRequest; roomId: string }) {
  const { t } = useTranslation();
  const glassRef = useGlassHighlight<HTMLDivElement>();
  const viewerId = useMatrixClient().getUserId();
  const room = useApprovalRoom(roomId);
  const [answer, setAnswer] = useState<Answer>();
  const [clockTick, setClockTick] = useState(0);
  const status = effectiveSecretRequestStatus(request, Date.now());
  const isRequester = request.requesterId === viewerId;
  const open = status === 'pending' && answer === undefined;

  // A pending card turns expired at its deadline without another event to render it.
  useEffect(() => {
    if (request.status !== 'pending') return undefined;
    const delay = request.expiresAt - Date.now();
    if (delay <= 0) return undefined;
    const timer = setTimeout(
      () => setClockTick((tick) => tick + 1),
      Math.min(delay, MAX_TIMEOUT_DELAY)
    );
    return () => clearTimeout(timer);
  }, [request.status, request.expiresAt, clockTick]);

  let chip: Chip = status;
  if (status === 'pending') {
    if (answer) chip = ANSWER_CHIPS[answer];
    else if (isRequester) chip = 'waitingForYou';
  }

  return (
    <Box
      ref={glassRef}
      className={cardCss.Card}
      direction="Column"
      gap="200"
      aria-label={t('mindroomUi.messages.secretRequestCard.label')}
    >
      <div className={sectionCss.SectionHeader}>
        <span className={sectionCss.SectionIcon} aria-hidden>
          <Icon size="100" src={Icons.Lock} />
        </span>
        <span className={css.Title}>
          <IsolatedText
            text={t('mindroomUi.messages.secretRequestCard.title', {
              name: isolateInSentence(request.displayName),
            })}
          />
        </span>
        <span
          data-secret-request-status={chip}
          className={classNames(
            sectionCss.StatusChip,
            chip === 'waitingForYou' && sectionCss.StatusChipAttention,
            chip === 'saved' && sectionCss.StatusChipDone
          )}
        >
          {t(CHIP_KEYS[chip])}
        </span>
      </div>
      <div className={sectionCss.SectionBody}>
        {request.reason && (
          <Text size="T300" className={css.Reason} {...ownDirectionBlock}>
            {request.reason}
          </Text>
        )}
        {request.hosts.length > 0 && (
          <Text size="T200" className={sectionCss.SectionMeta}>
            <IsolatedText
              text={t('mindroomUi.messages.secretRequestCard.usedOnlyFor', {
                hosts: isolateInSentence(request.hosts.join(', ')),
              })}
            />
          </Text>
        )}
        {status === 'pending' && answer && (
          <Text size="T200" role="status">
            {t(ANSWER_KEYS[answer])}
          </Text>
        )}
        {open && !isRequester && (
          <Text size="T200">
            <IsolatedText
              text={t('mindroomUi.messages.secretRequestCard.waitingFor', {
                name: userDisplayName(room, request.requesterId),
              })}
            />
          </Text>
        )}
        {open && isRequester && (
          <SecretRequestAnswer request={request} roomId={roomId} onAnswer={setAnswer} />
        )}
      </div>
    </Box>
  );
}
