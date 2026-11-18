import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Icon, Icons } from 'folds';
import type { SecretRequest, SecretRequestStatus } from '../matrix/protocol/secretRequest';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { formatLifetime } from '../lib/time';
import { ActivityIcon, type ActivityTone } from '../ui/ThreadActivity';
import * as activityCss from '../ui/ThreadActivity.css';
import { IsolatedText } from '../ui/directional';
import { SecretRequestChip, SecretRequestDetails } from './SecretRequestCard';
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

/** What the line says after the name: what became of the request. */
const useLineStatus = (request: SecretRequest): string => {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const { status } = request;
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
 * A done secret request drawn in the agent's reply, at the tool call that asked
 * (inlineSecretRequests.ts), as a line of the reply's tool calls: a lock in the status's colour,
 * the secret's name and what became of it. The line opens the request read-only, and folds it
 * again. When the card's row went with the focus in it, the line takes it.
 */
export function SecretRequestLine({
  eventId,
  request,
  roomId,
  agentUserId,
}: {
  /** The card's event, whose row hid. */
  eventId: string;
  request: SecretRequest;
  roomId: string;
  agentUserId: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const temporary = request.kind === 'temporary';
  const { status } = request;
  const detail = useLineStatus(request);
  return (
    // Keeps the interface's direction in a message that reads the other way (index.css).
    <div
      className={activityCss.Activity}
      data-message-disclosure=""
      data-secret-request-line={status}
      role="group"
      aria-label={t(
        temporary
          ? 'mindroomUi.messages.secretRequestCard.temporary.label'
          : 'mindroomUi.messages.secretRequestCard.label'
      )}
    >
      <button
        type="button"
        // Where the focus goes when the card's row goes with it (SecretRequestCard.tsx).
        data-secret-request-for={eventId}
        className={activityCss.Line}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        onClick={() => setExpanded((value) => !value)}
      >
        <ActivityIcon src={Icons.Lock} tone={STATUS_TONE[status]} />
        <SecretName request={request} className={activityCss.Title} />
        <span className={activityCss.Detail}>{detail}</span>
        <Icon size="50" className={activityCss.Chevron} src={Icons.ChevronRight} aria-hidden />
      </button>
      {expanded && (
        <div id={panelId} className={css.Card} data-secret-request-receipt="">
          <div className={css.Header}>
            <Icon size="100" src={Icons.Lock} aria-hidden />
            <SecretName request={request} className={css.HeaderName} />
            <SecretRequestChip chip={status} temporary={temporary} />
          </div>
          <SecretRequestDetails
            request={request}
            status={status}
            roomId={roomId}
            agentUserId={agentUserId}
          />
        </div>
      )}
    </div>
  );
}
