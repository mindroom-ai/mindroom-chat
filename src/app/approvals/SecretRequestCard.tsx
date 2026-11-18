import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box, Button, Icon, IconButton, Icons, Input, Text, type IconSrc } from 'folds';
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
      {request.url && (
        // The agent chose the page, so the button names its host as the browser reads it.
        <Button
          as="a"
          href={request.url}
          target="_blank"
          rel="noreferrer noopener"
          className={css.Link}
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          after={<Icon size="100" src={Icons.External} />}
        >
          <Text size="B300" className={css.LinkText}>
            <IsolatedText
              text={t('mindroomUi.messages.secretRequestCard.openLink', {
                host: isolateInSentence(new URL(request.url).host),
              })}
            />
          </Text>
        </Button>
      )}
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
            request.placeholder ??
            (temporary
              ? t('mindroomUi.messages.secretRequestCard.temporary.placeholder')
              : t('mindroomUi.messages.secretRequestCard.placeholder'))
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

/** The request's status as a chip, a temporary secret's saved one as Sent. */
export function SecretRequestChip({ chip, temporary }: { chip: Chip; temporary: boolean }) {
  const { t } = useTranslation();
  return (
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
  );
}

function Fact({ icon, children }: { icon: IconSrc; children: ReactNode }) {
  return (
    <Text as="div" size="T200" className={css.Fact}>
      <Icon size="100" src={icon} className={css.FactIcon} aria-hidden />
      <span>{children}</span>
    </Text>
  );
}

/**
 * A done request, read-only, for its card's fold and its line in a reply (SecretRequestLine.tsx):
 * the agent's reason, then what became of the secret, one fact to a line.
 */
export function SecretRequestDetails({
  request,
  status,
  roomId,
  agentUserId,
}: {
  request: SecretRequest;
  status: SecretRequestStatus;
  roomId: string;
  agentUserId: string;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const room = useApprovalRoom(roomId);
  const { apiUrl } = useAgentMindroomServer(useMatrixClient(), roomId, agentUserId);
  const saved = status === 'saved';
  const temporary = request.kind === 'temporary' ? request : undefined;
  const hosts = request.kind === 'key' ? request.hosts : [];
  const keptSeconds = temporary?.kept ? temporary.keep[temporary.kept] : undefined;
  return (
    <>
      {request.reason && (
        <Text size="T300" className={css.Reason} {...ownDirectionBlock}>
          {request.reason}
        </Text>
      )}
      <div className={css.Facts}>
        {!saved && (
          <Fact icon={status === 'expired' ? Icons.Clock : Icons.Cross}>
            {t(
              status === 'expired'
                ? 'mindroomUi.messages.secretRequestCard.facts.noAnswer'
                : 'mindroomUi.messages.secretRequestCard.facts.nothingSent'
            )}
          </Fact>
        )}
        {temporary && (
          <Fact icon={Icons.Terminal}>
            <IsolatedText
              text={t(
                saved
                  ? 'mindroomUi.messages.secretRequestCard.temporary.givenAs'
                  : 'mindroomUi.messages.secretRequestCard.facts.askedAs',
                {
                  agent: userDisplayName(room, agentUserId),
                  variable: isolateInSentence(temporary.env),
                }
              )}
            />
          </Fact>
        )}
        {saved && temporary?.kept && keptSeconds !== undefined && (
          <Fact icon={Icons.Clock}>
            {t(KEPT_KEYS[temporary.kept], { duration: formatLifetime(keptSeconds, language) })}
          </Fact>
        )}
        {hosts.length > 0 && (
          <Fact icon={Icons.Globe}>
            <IsolatedText
              text={t('mindroomUi.messages.secretRequestCard.usedOnlyFor', {
                hosts: isolateInSentence(hosts.join(', ')),
              })}
            />
          </Fact>
        )}
        {saved && request.kind === 'key' && request.replaces && (
          <Fact icon={Icons.Reload}>
            {t('mindroomUi.messages.secretRequestCard.facts.replaced')}
          </Fact>
        )}
        {saved && apiUrl && (
          <Fact icon={Icons.Server}>
            {t('mindroomUi.messages.secretRequestCard.sentTo', { host: new URL(apiUrl).host })}
          </Fact>
        )}
      </div>
    </>
  );
}

const findByAttribute = (name: string, value: string) =>
  [...document.querySelectorAll<HTMLElement>(`[${name}]`)].find(
    (element) => element.getAttribute(name) === value
  );

/**
 * An agent's request for a secret (`io.mindroom.secret_request`), with a field for the person
 * asked while it is pending: a service's key, with the agent's reason and the hosts the key may go
 * to, or a temporary secret, with the variable the agent's commands receive it as. The agent may
 * also name the secret (a temporary one's title), hint at its form in the empty field, and name
 * the page that gives it, which the person asked opens with a button above the field.
 * `agentUserId` is the card's sender, whose own MindRoom server takes the answer. A `readOnly`
 * card (another thread's view, such as a fork's prefix) shows the request without the field.
 * Once done, a reply that names it may draw it at its tool call instead (SecretRequestLine.tsx).
 */
export function SecretRequestCard({
  request,
  roomId,
  agentUserId,
  eventId,
  readOnly = false,
}: {
  request: SecretRequest;
  roomId: string;
  agentUserId: string;
  /** The card's event, whose line in the reply takes the focus when its row goes. */
  eventId?: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const card = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLElement>(null);
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
  // answer from the keyboard was on its way: the folded card's row, which stays through the edit
  // and opens it again, takes the focus the page got. Focus moved elsewhere on purpose stays there.
  // Without such an answer none moves (the form gave up its focus): focus put in the row would
  // show the row's toolbar as if it came from the keyboard.
  const formShown = open && isRequester;
  useEffect(() => {
    if (formShown || !keyboardAnswer.current) return;
    keyboardAnswer.current = false;
    if (document.activeElement === document.body || document.activeElement === null) {
      (summary.current ?? card.current)?.focus({ preventScroll: true });
    }
  }, [formShown]);

  // Done, its row goes once its reply draws it (inlineSecretRequests.ts): focus in it moves to the
  // request's line there, else to the reply.
  const replyId = request.status === 'pending' ? undefined : request.anchor?.responseEventId;
  useLayoutEffect(() => {
    const node = card.current;
    if (!eventId || !replyId) return undefined;
    return () => {
      if (!node?.contains(document.activeElement)) return;
      // Once the commit that took the row is done, if the focus went with it.
      queueMicrotask(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        (
          findByAttribute('data-secret-request-for', eventId) ??
          findByAttribute('data-message-id', replyId)
        )?.focus({ preventScroll: true });
      });
    };
  }, [eventId, replyId]);

  const header = (
    <>
      <span className={sectionCss.SectionIcon} aria-hidden>
        <Icon size="100" src={Icons.Lock} />
      </span>
      <span className={css.Title}>
        <IsolatedText
          text={
            request.kind === 'temporary'
              ? // What the agent calls the secret, when it said.
                (request.label && isolateInSentence(request.label)) ||
                t('mindroomUi.messages.secretRequestCard.temporary.title', {
                  agent: userDisplayName(room, agentUserId),
                })
              : t('mindroomUi.messages.secretRequestCard.title', {
                  name: isolateInSentence(request.displayName),
                })
          }
        />
      </span>
      <SecretRequestChip chip={chip} temporary={!!temporary} />
    </>
  );
  // What `details` shows of a card that is done: its reason, a temporary secret's variable and
  // keep, or a key's hosts. A card with none of them has nothing to fold.
  const foldable = Boolean(request.reason) || temporary !== undefined || hosts.length > 0;
  const details = (
    <>
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
          {timeLeft && t('mindroomUi.messages.threadApprovalControls.expires', { time: timeLeft })}
        </Text>
      )}
      {open && request.kind === 'key' && request.replaces && (
        <Text size="T200">{t('mindroomUi.messages.secretRequestCard.replaces')}</Text>
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
    </>
  );

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
      {open || !foldable ? (
        <div className={sectionCss.SectionHeader}>{header}</div>
      ) : (
        // Done, the card folds to its row, which opens it again.
        <details className={css.Fold}>
          <summary ref={summary} className={css.FoldRow}>
            {header}
            <Icon
              src={Icons.ChevronBottom}
              size="100"
              className={sectionCss.ReceiptChevron}
              aria-hidden
            />
          </summary>
          <div className={classNames(sectionCss.SectionBody, css.FoldBody)}>
            <SecretRequestDetails
              request={request}
              status={status}
              roomId={roomId}
              agentUserId={agentUserId}
            />
          </div>
        </details>
      )}
      {/* Outside the fold and in the same place open or done, so that it stays mounted through
      the answer and a screen reader announces the text it gets. */}
      {isRequester && waitingForEdit && (open || answer) && (
        <div role="status" className={classNames(sectionCss.SectionBody, css.Status)}>
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
      {open && <div className={sectionCss.SectionBody}>{details}</div>}
    </Box>
  );
}
