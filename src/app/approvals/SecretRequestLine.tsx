import { useId, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Icon, Icons, Text, type IconSrc } from 'folds';
import type { SecretRequest, SecretRequestStatus } from '../matrix/protocol/secretRequest';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useAgentMindroomServer } from '../computer/useAgentMindroomServer';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { formatLifetime } from '../lib/time';
import { ActivityIcon, type ActivityTone } from '../ui/ThreadActivity';
import * as activityCss from '../ui/ThreadActivity.css';
import { IsolatedText, isolateInSentence, ownDirectionBlock } from '../ui/directional';
import { useApprovalRoom, userDisplayName } from './approvalPeople';
import {
  KEPT_KEYS,
  SecretRequestAnswerStatus,
  SecretRequestChip,
  SecretRequestDetails,
  useSecretRequestState,
  type SecretRequestState,
} from './SecretRequestCard';
import * as cardCss from './SecretRequestCard.css';
import * as css from './SecretRequestLine.css';

const STATUS_TONE = {
  pending: 'warning',
  saved: 'success',
  declined: 'critical',
  expired: 'neutral',
} as const satisfies Record<SecretRequestStatus, ActivityTone>;

/** What a request is called on its line: a key's service, a temporary secret's label or variable. */
function SecretName({ request, className }: { request: SecretRequest; className: string }) {
  if (request.kind === 'key') {
    return (
      <span className={className}>
        <IsolatedText text={request.displayName} />
      </span>
    );
  }
  return (
    <span className={classNames(className, !request.label && css.Mono)} dir="auto">
      {request.label ?? request.env}
    </span>
  );
}

/** What the line says after the name: the time left while it waits, else what became of it. */
const useLineStatus = (request: SecretRequest, state: SecretRequestState): string => {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const { status, timeLeft } = state;
  if (status === 'pending') {
    return timeLeft
      ? t('mindroomUi.messages.secretRequestCard.line.expires', { time: timeLeft })
      : t('mindroomUi.messages.secretRequestCard.status.pending');
  }
  if (status !== 'saved') return t(`mindroomUi.messages.secretRequestCard.status.${status}`);
  if (request.kind === 'key') return t('mindroomUi.messages.secretRequestCard.status.saved');
  const kept = request.kept ? request.keep[request.kept] : undefined;
  return kept === undefined
    ? t('mindroomUi.messages.secretRequestCard.temporary.sent')
    : t('mindroomUi.messages.secretRequestCard.line.sentKept', {
        duration: formatLifetime(kept, language),
      });
};

function Fact({ icon, children }: { icon: IconSrc; children: ReactNode }) {
  return (
    <Text as="div" size="T200" className={css.Fact}>
      <Icon size="100" src={icon} className={css.FactIcon} aria-hidden />
      <span>{children}</span>
    </Text>
  );
}

/**
 * A request that is done, read-only: its name and status, the agent's whole reason, then what
 * became of the secret. No field and no buttons.
 */
function SecretRequestReceipt({
  id,
  request,
  roomId,
  agentUserId,
  state,
}: {
  id: string;
  request: SecretRequest;
  roomId: string;
  agentUserId: string;
  state: SecretRequestState;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const room = useApprovalRoom(roomId);
  const { apiUrl } = useAgentMindroomServer(useMatrixClient(), roomId, agentUserId);
  const { status, chip } = state;
  const agent = userDisplayName(room, agentUserId);
  const temporary = request.kind === 'temporary' ? request : undefined;
  const kept = temporary?.kept ? temporary.keep[temporary.kept] : undefined;
  const saved = status === 'saved';
  return (
    <div id={id} className={css.Card} data-secret-request-receipt="">
      <div className={css.Header}>
        <Icon size="100" src={Icons.Lock} aria-hidden />
        <SecretName request={request} className={css.HeaderName} />
        <SecretRequestChip chip={chip} temporary={!!temporary} />
      </div>
      {request.reason && (
        <Text size="T300" className={cardCss.Reason} {...ownDirectionBlock}>
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
                { agent, variable: isolateInSentence(temporary.env) }
              )}
            />
          </Fact>
        )}
        {saved && temporary?.kept && kept !== undefined && (
          <Fact icon={Icons.Clock}>
            {t(KEPT_KEYS[temporary.kept], { duration: formatLifetime(kept, language) })}
          </Fact>
        )}
        {request.kind === 'key' && request.hosts.length > 0 && (
          <Fact icon={Icons.Globe}>
            <IsolatedText
              text={t('mindroomUi.messages.secretRequestCard.usedOnlyFor', {
                hosts: isolateInSentence(request.hosts.join(', ')),
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
    </div>
  );
}

/**
 * A secret request drawn in the agent's reply, at the tool call that asked (inlineSecretRequests.ts),
 * as a line of the reply's tool calls: a lock in the status's colour, the secret's name and its
 * status. While it waits the line opens nothing and the form hangs under it, as on the request's
 * card (SecretRequestCard.tsx), which owns the answer; once done the line opens the request
 * read-only, and folds it again.
 */
export function SecretRequestLine({
  request,
  roomId,
  agentUserId,
}: {
  request: SecretRequest;
  roomId: string;
  agentUserId: string;
}) {
  const { t } = useTranslation();
  const state = useSecretRequestState(request, false);
  const { cardRef, summaryRef, status, open } = state;
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const temporary = request.kind === 'temporary';
  const detail = useLineStatus(request, state);
  const content = (
    <>
      <ActivityIcon src={Icons.Lock} tone={STATUS_TONE[status]} />
      <SecretName request={request} className={activityCss.Title} />
      <span className={activityCss.Detail}>{detail}</span>
    </>
  );
  return (
    // Keeps the interface's direction in a message that reads the other way (index.css).
    <div
      ref={cardRef}
      className={activityCss.Activity}
      data-message-disclosure=""
      data-secret-request-line={status}
      role="group"
      tabIndex={-1}
      aria-label={t(
        temporary
          ? 'mindroomUi.messages.secretRequestCard.temporary.label'
          : 'mindroomUi.messages.secretRequestCard.label'
      )}
    >
      {open ? (
        <div className={classNames(activityCss.Line, css.StaticLine)}>{content}</div>
      ) : (
        <button
          ref={summaryRef as RefObject<HTMLButtonElement>}
          type="button"
          className={activityCss.Line}
          aria-expanded={expanded}
          aria-controls={expanded ? panelId : undefined}
          onClick={() => setExpanded((value) => !value)}
        >
          {content}
          <Icon size="50" className={activityCss.Chevron} src={Icons.ChevronRight} aria-hidden />
        </button>
      )}
      <SecretRequestAnswerStatus state={state} temporary={temporary} />
      {open && (
        <div className={css.Card}>
          <SecretRequestDetails
            request={request}
            roomId={roomId}
            agentUserId={agentUserId}
            state={state}
            showExpiry={false}
          />
        </div>
      )}
      {!open && expanded && (
        <SecretRequestReceipt
          id={panelId}
          request={request}
          roomId={roomId}
          agentUserId={agentUserId}
          state={state}
        />
      )}
    </div>
  );
}
