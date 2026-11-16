import { useEffect, useId, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box, Button, Icon, IconButton, Icons, Input, Text } from 'folds';
import { isRecord } from '../lib/isRecord';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { formatLifetime } from '../lib/time';
import {
  effectiveSecretRequestStatus,
  secretRequestPath,
  type SecretKeep,
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

/** The keeps a temporary secret's card offers, the one that stores nothing first. */
const KEEPS: readonly SecretKeep[] = ['memory', 'disk'];

const KEEP_KEYS = {
  memory: 'mindroomUi.messages.secretRequestCard.temporary.keep.memory',
  disk: 'mindroomUi.messages.secretRequestCard.temporary.keep.disk',
} as const satisfies Record<SecretKeep, string>;

const KEPT_KEYS = {
  memory: 'mindroomUi.messages.secretRequestCard.temporary.kept.memory',
  disk: 'mindroomUi.messages.secretRequestCard.temporary.kept.disk',
} as const satisfies Record<SecretKeep, string>;

/** The `detail` of a refusal, cut to a readable length; undefined when it carries none. */
const readDetail = async (response: Response): Promise<string | undefined> => {
  const body: unknown = await response.json().catch(() => undefined);
  const detail = isRecord(body) ? body.detail : undefined;
  return typeof detail === 'string' && detail.trim()
    ? detail.trim().slice(0, MAX_DETAIL_LENGTH)
    : undefined;
};

/**
 * The requester's masked field with Save and Decline, and for a temporary secret the choice of how
 * long MindRoom keeps it. The key stays in the field, uncontrolled, so that neither React's state
 * nor the field's `value` attribute holds it, until it goes to the origin `useAgentMindroomServer`
 * allows for the asking agent; it is cleared once the server took it or the request is gone.
 */
function SecretRequestAnswer({
  request,
  roomId,
  agentUserId,
  keyboardAnswer,
  onAnswer,
}: {
  request: SecretRequest;
  roomId: string;
  agentUserId: string;
  /**
   * Whether an answer from the keyboard is on its way or was taken; the card then takes the focus
   * when the form goes away.
   */
  keyboardAnswer: MutableRefObject<boolean>;
  onAnswer: (answer: Answer) => void;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const mx = useMatrixClient();
  const { apiUrl, pending } = useAgentMindroomServer(mx, roomId, agentUserId);
  const temporary = request.kind === 'temporary' ? request : undefined;
  const keeps = temporary ? KEEPS.filter((name) => temporary.keep[name] !== undefined) : [];
  // Memory unless the person chooses the file, or the card offers only the file.
  const [keep, setKeep] = useState(keeps[0]);
  const keepGroup = useId();
  const field = useRef<HTMLInputElement>(null);
  const [hasKey, setHasKey] = useState(false);
  const [visible, setVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const errorId = useId();
  const area = useRef<HTMLDivElement>(null);
  // A second press before the first answer arrives sends nothing, on a busy button too.
  const sendingRef = useRef(false);
  // Whether a pointer pressed Save or Decline for the answer about to start; where focus sits says
  // nothing, as Safari and iOS leave it in the field after a tap on Save. Enter in the field clicks
  // Save with no pointer (`detail` 0), as a key on a focused button does.
  const pointerPress = useRef(false);
  const notePress = (event: { detail: number }) => {
    pointerPress.current = event.detail > 0;
  };

  // Gone without an answer from the keyboard (after a pointer answer, at the deadline, or with the
  // agent's edit): focus left in the form or the choice above it goes before they do, since
  // removing the focused element fires no blur. Left there, it would keep the row's toolbar and a
  // phone's keyboard up.
  useLayoutEffect(() => {
    const element = area.current;
    return () => {
      const focused = document.activeElement;
      if (!keyboardAnswer.current && focused instanceof HTMLElement && element?.contains(focused)) {
        focused.blur();
      }
    };
  }, [keyboardAnswer]);

  if (!pending && !apiUrl) {
    // Never the published host: a person who trusts their own MindRoom server names it in Settings.
    return (
      <>
        <Text size="T200">{t('mindroomUi.messages.secretRequestCard.unavailable')}</Text>
        <Text size="T200" className={sectionCss.SectionMeta}>
          {t('mindroomUi.messages.secretRequestCard.unavailableHint', {
            page: t('settings.general.computers.sectionTitle'),
            field: t('settings.general.computers.apiUrl'),
          })}
        </Text>
      </>
    );
  }

  const ready = !pending && !!apiUrl;
  let saveLabel = t('mindroomUi.messages.secretRequestCard.save');
  if (temporary) saveLabel = t('mindroomUi.messages.secretRequestCard.temporary.send');
  else if (request.kind === 'key' && request.replaces) {
    saveLabel = t('mindroomUi.messages.secretRequestCard.replaceKey');
  }
  const showLabel = temporary
    ? t('mindroomUi.messages.secretRequestCard.temporary.show')
    : t('mindroomUi.messages.secretRequestCard.showKey');
  const hideLabel = temporary
    ? t('mindroomUi.messages.secretRequestCard.temporary.hide')
    : t('mindroomUi.messages.secretRequestCard.hideKey');

  const send = async (decline: boolean) => {
    const secret = field.current?.value ?? '';
    const byPointer = pointerPress.current;
    pointerPress.current = false;
    if (pending || !apiUrl || sendingRef.current) return;
    if (!decline && secret.trim() === '') return;
    sendingRef.current = true;
    keyboardAnswer.current = !byPointer;
    let answered = false;
    setSending(true);
    setError(undefined);
    try {
      const response = await clientSessions(mx, apiUrl).send(
        secretRequestPath(roomId, request.requestId),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            // Only a temporary secret has a keep to choose.
            decline ? { decline: true } : keep ? { secret, keep } : { secret }
          ),
          // A redirect would replay the body, the key, to wherever it points; it fails instead,
          // as a request with no answer does, and the key stays for a retry.
          redirect: 'error',
        }
      );
      if (response.ok || response.status === 404) {
        answered = true;
        if (field.current) field.current.value = '';
        onAnswer(response.status === 404 ? 'inactive' : decline ? 'declined' : 'saved');
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
      // The form stays for a retry; nothing is on its way any more.
      if (!answered) keyboardAnswer.current = false;
      setSending(false);
    }
  };

  return (
    <div ref={area} className={css.Answer}>
      {temporary && (
        <fieldset className={css.Keep}>
          <Text as="legend" size="T200" className={sectionCss.SectionMeta}>
            {t('mindroomUi.messages.secretRequestCard.temporary.keepFor')}
          </Text>
          {keeps.map((name) => (
            <label key={name} className={css.KeepOption}>
              <input
                type="radio"
                name={keepGroup}
                value={name}
                checked={keep === name}
                onChange={() => setKeep(name)}
              />
              <Text as="span" size="T200">
                {t(KEEP_KEYS[name], {
                  duration: formatLifetime(temporary.keep[name] ?? 0, language),
                })}
              </Text>
            </label>
          ))}
        </fieldset>
      )}
      <form
        className={sectionCss.DenyRow}
        onSubmit={(event) => {
          event.preventDefault();
          void send(false);
        }}
      >
        <Input
          ref={field}
          className={visible ? undefined : css.Masked}
          type="text"
          size="300"
          variant="Background"
          aria-label={
            request.kind === 'temporary'
              ? t('mindroomUi.messages.secretRequestCard.temporary.field', {
                  variable: request.env,
                })
              : t('mindroomUi.messages.secretRequestCard.title', { name: request.displayName })
          }
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          placeholder={
            temporary
              ? t('mindroomUi.messages.secretRequestCard.temporary.placeholder')
              : t('mindroomUi.messages.secretRequestCard.placeholder')
          }
          onChange={(event) => setHasKey(event.currentTarget.value.trim() !== '')}
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
              aria-label={visible ? hideLabel : showLabel}
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
            // Busy, not disabled, while the answer is on its way: a disabled button would drop its
            // keyboard focus to the page.
            className={css.Busy}
            disabled={!ready || !hasKey}
            aria-disabled={sending || undefined}
            onClick={notePress}
          >
            <Text size="B300">{saveLabel}</Text>
          </Button>
          <Button
            type="button"
            size="300"
            variant="Critical"
            fill="Soft"
            outlined
            radii="300"
            className={css.Busy}
            disabled={!ready}
            aria-disabled={sending || undefined}
            onClick={(event: { detail: number }) => {
              notePress(event);
              void send(true);
            }}
          >
            <Text size="B300">{t('mindroomUi.messages.secretRequestCard.decline')}</Text>
          </Button>
        </div>
      </form>
      {apiUrl && (
        <Text size="T200" className={sectionCss.SectionMeta}>
          {t('mindroomUi.messages.secretRequestCard.sentTo', { host: new URL(apiUrl).host })}
        </Text>
      )}
      {error && (
        <Text as="p" id={errorId} size="T200" role="alert">
          {error}
        </Text>
      )}
    </div>
  );
}

/**
 * An agent's request for a secret (`io.mindroom.secret_request`), with a field for the person
 * asked while it is pending: a service's key, with the agent's reason and the hosts the key may go
 * to, or a temporary secret, with the variable the agent's commands receive it as.
 * `agentUserId` is the card's sender, whose own MindRoom server takes the answer. A `readOnly`
 * card (another thread's view, such as a fork's prefix) shows the request without the field.
 */
export function SecretRequestCard({
  request,
  roomId,
  agentUserId,
  readOnly = false,
}: {
  request: SecretRequest;
  roomId: string;
  agentUserId: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const card = useRef<HTMLDivElement>(null);
  const glassRef = useGlassHighlight<HTMLDivElement>(card);
  const viewerId = useMatrixClient().getUserId();
  const room = useApprovalRoom(roomId);
  const [answer, setAnswer] = useState<Answer>();
  const [clockTick, setClockTick] = useState(0);
  const keyboardAnswer = useRef(false);
  const now = Date.now();
  // The person asked, where the card can take their answer.
  const isRequester = request.requesterId === viewerId && !readOnly;
  // The agent's edit decides; until it comes, an answer the server took holds whatever the clock says.
  const waitingForEdit = request.status === 'pending';
  const status: SecretRequestStatus =
    waitingForEdit && answer ? ANSWER_STATUSES[answer] : effectiveSecretRequestStatus(request, now);
  const open = status === 'pending';
  const chip: Chip = open && isRequester ? 'waitingForYou' : status;
  const timeLeft = open ? formatTimeUntil(request.expiresAt, now, language) : undefined;
  const temporary = request.kind === 'temporary' ? request : undefined;
  const hosts = request.kind === 'key' ? request.hosts : [];
  const keptSeconds = temporary?.kept ? temporary.keep[temporary.kept] : undefined;

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

  // The form went away, after the answer or with the agent's edit, whichever came first, while an
  // answer from the keyboard was on its way: the card, which stays through the edit, takes the
  // focus the page got. Focus moved elsewhere on purpose stays there. Without such an answer none
  // moves (the form gave up its focus): focus put in the row would show the row's toolbar as if it
  // came from the keyboard.
  const formShown = open && isRequester;
  useEffect(() => {
    if (formShown || !keyboardAnswer.current) return;
    keyboardAnswer.current = false;
    if (document.activeElement === document.body || document.activeElement === null) {
      card.current?.focus({ preventScroll: true });
    }
  }, [formShown]);

  return (
    <Box
      ref={glassRef}
      className={cardCss.Card}
      direction="Column"
      gap="200"
      role="group"
      tabIndex={-1}
      aria-label={t(
        temporary
          ? 'mindroomUi.messages.secretRequestCard.temporary.label'
          : 'mindroomUi.messages.secretRequestCard.label'
      )}
    >
      <div className={sectionCss.SectionHeader}>
        <span className={sectionCss.SectionIcon} aria-hidden>
          <Icon size="100" src={Icons.Lock} />
        </span>
        <span className={css.Title}>
          <IsolatedText
            text={
              request.kind === 'temporary'
                ? t('mindroomUi.messages.secretRequestCard.temporary.title', {
                    agent: userDisplayName(room, agentUserId),
                  })
                : t('mindroomUi.messages.secretRequestCard.title', {
                    name: isolateInSentence(request.displayName),
                  })
            }
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
          {temporary && chip === 'saved'
            ? t('mindroomUi.messages.secretRequestCard.temporary.sent')
            : t(CHIP_KEYS[chip])}
        </span>
      </div>
      <div className={sectionCss.SectionBody}>
        {request.reason && (
          <Text size="T300" className={css.Reason} {...ownDirectionBlock}>
            {request.reason}
          </Text>
        )}
        {temporary && (
          <Text size="T200">
            <IsolatedText
              text={t('mindroomUi.messages.secretRequestCard.temporary.givenAs', {
                agent: userDisplayName(room, agentUserId),
                variable: isolateInSentence(temporary.env),
              })}
            />
          </Text>
        )}
        {(hosts.length > 0 || timeLeft) && (
          <Text size="T200" className={sectionCss.SectionMeta}>
            {hosts.length > 0 && (
              <IsolatedText
                text={t('mindroomUi.messages.secretRequestCard.usedOnlyFor', {
                  hosts: isolateInSentence(hosts.join(', ')),
                })}
              />
            )}
            {hosts.length > 0 && timeLeft && ' · '}
            {timeLeft &&
              t('mindroomUi.messages.threadApprovalControls.expires', { time: timeLeft })}
          </Text>
        )}
        {open && request.kind === 'key' && request.replaces && (
          <Text size="T200">{t('mindroomUi.messages.secretRequestCard.replaces')}</Text>
        )}
        {temporary?.kept && status === 'saved' && keptSeconds !== undefined && (
          <Text size="T200" className={sectionCss.SectionMeta}>
            {t(KEPT_KEYS[temporary.kept], { duration: formatLifetime(keptSeconds, language) })}
          </Text>
        )}
        {isRequester && waitingForEdit && (open || answer) && (
          <div role="status" className={css.Status}>
            {answer && (
              <Text size="T200">
                {t(
                  temporary && answer === 'saved'
                    ? 'mindroomUi.messages.secretRequestCard.temporary.sentWaiting'
                    : ANSWER_KEYS[answer]
                )}
              </Text>
            )}
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
        {formShown && (
          <SecretRequestAnswer
            request={request}
            roomId={roomId}
            agentUserId={agentUserId}
            keyboardAnswer={keyboardAnswer}
            onAnswer={setAnswer}
          />
        )}
      </div>
    </Box>
  );
}
