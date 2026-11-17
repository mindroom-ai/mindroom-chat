import { useId, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Icon, Icons } from 'folds';
import type { SecretRequest, SecretRequestStatus } from '../matrix/protocol/secretRequest';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { formatLifetime } from '../lib/time';
import { ActivityIcon, type ActivityTone } from '../ui/ThreadActivity';
import * as activityCss from '../ui/ThreadActivity.css';
import { IsolatedText } from '../ui/directional';
import {
  SecretRequestAnswerStatus,
  SecretRequestChip,
  SecretRequestDetails,
  useSecretRequestState,
  type SecretRequestState,
} from './SecretRequestCard';
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
        // Done, read-only: its name and status, then what the card's fold shows.
        <div id={panelId} className={css.Card} data-secret-request-receipt="">
          <div className={css.Header}>
            <Icon size="100" src={Icons.Lock} aria-hidden />
            <SecretName request={request} className={css.HeaderName} />
            <SecretRequestChip chip={state.chip} temporary={temporary} />
          </div>
          <SecretRequestDetails
            request={request}
            roomId={roomId}
            agentUserId={agentUserId}
            state={state}
          />
        </div>
      )}
    </div>
  );
}
