import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box, Button, Icon, IconButton, Icons, Input, Text } from 'folds';
import { isKeyboardFocus } from '../lib/dom';
import { isRecord } from '../lib/isRecord';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import {
  effectiveSecretRequestStatus,
  secretRequestPath,
  type SecretRequest,
  type SecretRequestStatus,
} from '../matrix/protocol/secretRequest';
import { clientSessions, MindroomServerError } from '../computer/clientSessions';
import { useAgentMindroomServer } from '../computer/useAgentMindroomServer';
import { useGlassHighlight } from '../ui/glass/liquid/useLiquidGlass';
import { IsolatedText, isolateInSentence, ownDirectionBlock } from '../ui/directional';
import { useApprovalRoom, userDisplayName } from './approvalPeople';
import { formatTimeUntil } from './approvalScheduleText';
import * as cardCss from './ToolApprovalCard.css';
import * as sectionCss from './ThreadApprovals.css';
import * as css from './SecretRequestCard.css';

const MINUTE_MS = 60_000;
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

const ANSWER_STATUSES = {
  saved: 'saved',
  declined: 'declined',
  inactive: 'expired',
} as const satisfies Record<Answer, SecretRequestStatus>;

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
 * until it goes to the asking agent's own MindRoom server, never to an origin the card or another
 * agent names, and is dropped once the server took it or the request is gone.
 */
function SecretRequestAnswer({
  request,
  roomId,
  agentUserId,
  onAnswer,
}: {
  request: SecretRequest;
  roomId: string;
  agentUserId: string;
  /** `keyboardFocus`: whether the form, which unmounts with the answer, held keyboard focus. */
  onAnswer: (answer: Answer, keyboardFocus: boolean) => void;
}) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { apiUrl, pending } = useAgentMindroomServer(mx, roomId, agentUserId);
  const [secret, setSecret] = useState('');
  const [visible, setVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const form = useRef<HTMLFormElement>(null);
  // A second press before the first answer arrives sends nothing.
  const sendingRef = useRef(false);
  // Whether a pointer pressed Save or Decline. Enter in the field clicks Save too, with no pointer
  // (`detail` 0), as a key on a focused button does.
  const pointerAnswer = useRef(false);
  const notePointer = (event: { detail: number }) => {
    pointerAnswer.current = event.detail > 0;
  };

  if (!pending && !apiUrl) {
    return <Text size="T200">{t('mindroomUi.messages.secretRequestCard.unavailable')}</Text>;
  }

  const ready = !pending && !!apiUrl && !sending;

  const send = async (decline: boolean) => {
    if (pending || !apiUrl || sendingRef.current) return;
    if (!decline && secret.trim() === '') return;
    const byPointer = pointerAnswer.current;
    pointerAnswer.current = false;
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
          // A redirect would replay the body, the key, to wherever it points; it fails instead,
          // as a request with no answer does, and the key stays for a retry.
          redirect: 'error',
        }
      );
      if (response.ok || response.status === 404) {
        const focused = document.activeElement;
        setSecret('');
        onAnswer(
          response.status === 404 ? 'inactive' : decline ? 'declined' : 'saved',
          !byPointer && !!form.current?.contains(focused) && isKeyboardFocus(focused)
        );
        return;
      }
      const detail =
        response.status === 403 || response.status === 422 ? await readDetail(response) : undefined;
      setError(
        detail ?? t(response.status >= 500 ? 'errors.serverProblem' : 'errors.serverRefused')
      );
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
        ref={form}
        className={sectionCss.DenyRow}
        onSubmit={(event) => {
          event.preventDefault();
          void send(false);
        }}
      >
        <Input
          className={visible ? undefined : css.Masked}
          type="text"
          size="300"
          variant="Background"
          aria-label={t('mindroomUi.messages.secretRequestCard.title', {
            name: request.displayName,
          })}
          placeholder={t('mindroomUi.messages.secretRequestCard.placeholder')}
          value={secret}
          onChange={(event) => setSecret(event.currentTarget.value)}
          // Not a sign-in field: browsers and password managers neither fill nor save it.
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          data-form-type="other"
          after={
            <IconButton
              type="button"
              variant="Background"
              size="300"
              radii="300"
              aria-label={
                visible
                  ? t('mindroomUi.messages.secretRequestCard.hideKey')
                  : t('mindroomUi.messages.secretRequestCard.showKey')
              }
              aria-pressed={visible}
              onClick={() => setVisible((current) => !current)}
            >
              <Icon size="100" src={visible ? Icons.EyeBlind : Icons.Eye} />
            </IconButton>
          }
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
            onClick={notePointer}
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
            onClick={(event) => {
              notePointer(event);
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
 * `agentUserId` is the card's sender, whose own MindRoom server takes the answer.
 */
export function SecretRequestCard({
  request,
  roomId,
  agentUserId,
}: {
  request: SecretRequest;
  roomId: string;
  agentUserId: string;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const card = useRef<HTMLDivElement>(null);
  const glassRef = useGlassHighlight<HTMLDivElement>(card);
  const viewerId = useMatrixClient().getUserId();
  const room = useApprovalRoom(roomId);
  const [answer, setAnswer] = useState<Answer>();
  const [clockTick, setClockTick] = useState(0);
  const focusCard = useRef(false);
  const now = Date.now();
  const isRequester = request.requesterId === viewerId;
  // The agent's edit decides; until it comes, an answer the server took holds whatever the clock says.
  const waitingForEdit = request.status === 'pending';
  const status: SecretRequestStatus =
    waitingForEdit && answer ? ANSWER_STATUSES[answer] : effectiveSecretRequestStatus(request, now);
  const open = status === 'pending';
  const chip: Chip = open && isRequester ? 'waitingForYou' : status;
  const timeLeft = open ? formatTimeUntil(request.expiresAt, now, language) : undefined;

  // Each minute while open, for the time left, and at the deadline, when the card turns expired.
  useEffect(() => {
    if (!open) return undefined;
    const remaining = request.expiresAt - Date.now();
    if (remaining <= 0) return undefined;
    const timer = setTimeout(
      () => setClockTick((tick) => tick + 1),
      remaining % MINUTE_MS || MINUTE_MS
    );
    return () => clearTimeout(timer);
  }, [open, request.expiresAt, clockTick]);

  // The answer took away the control that held keyboard focus; the card, which stays through the
  // agent's edit, takes it. After a pointer answer focus moves nowhere: focus put in the row there
  // would show the row's toolbar as if it came from the keyboard.
  useEffect(() => {
    if (!answer || !focusCard.current) return;
    focusCard.current = false;
    card.current?.focus({ preventScroll: true });
  }, [answer]);

  const onAnswer = (value: Answer, keyboardFocus: boolean) => {
    focusCard.current = keyboardFocus;
    setAnswer(value);
  };

  return (
    <Box
      ref={glassRef}
      className={cardCss.Card}
      direction="Column"
      gap="200"
      role="group"
      tabIndex={-1}
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
        {(request.hosts.length > 0 || timeLeft) && (
          <Text size="T200" className={sectionCss.SectionMeta}>
            {request.hosts.length > 0 && (
              <IsolatedText
                text={t('mindroomUi.messages.secretRequestCard.usedOnlyFor', {
                  hosts: isolateInSentence(request.hosts.join(', ')),
                })}
              />
            )}
            {request.hosts.length > 0 && timeLeft && ' · '}
            {timeLeft &&
              t('mindroomUi.messages.threadApprovalControls.expires', { time: timeLeft })}
          </Text>
        )}
        {isRequester && waitingForEdit && (open || answer) && (
          <div role="status" className={css.Status}>
            {answer && <Text size="T200">{t(ANSWER_KEYS[answer])}</Text>}
          </div>
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
          <SecretRequestAnswer
            request={request}
            roomId={roomId}
            agentUserId={agentUserId}
            onAnswer={onAnswer}
          />
        )}
      </div>
    </Box>
  );
}
